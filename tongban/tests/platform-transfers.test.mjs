import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto, randomUUID } from 'node:crypto';
import * as wallet from '../src/wallet.js';
import { createTransferDraft, getPlatformTransferDrafts } from '../src/platform-transfers.js';

const memory = new Map();
let failRead = false;
let failWrite = false;
let networkCalls = 0;
globalThis.localStorage = {
  getItem(key) { if (failRead) throw new Error('storage denied'); return memory.get(key) ?? null; },
  setItem(key, value) { if (failWrite) throw new Error('storage full'); memory.set(key, String(value)); },
  removeItem(key) { memory.delete(key); },
};
if (!globalThis.crypto) globalThis.crypto = webcrypto;
globalThis.fetch = async () => { networkCalls++; throw new Error('Platform drafts must not use the network'); };
const password = 'draft-test-password-3910';
const recipient = '0x1111111111111111111111111111111111111111';
const vaultKey = 'tongban.wallet.bsc-testnet.v1';
const draftPrefix = 'tongban.platform-transfer-drafts.bsc-testnet.v1.';
const request = (overrides = {}) => ({ direction: 'deposit', asset: 'tBNB', amount: '1', password, ...overrides });

test('password-verified platform drafts never represent or perform financial transfers', async t => {
  let created;
  let vault;
  let baseline;
  let draftKey;
  let deposit;

  await t.test('requires an existing readable wallet', async () => {
    assert.deepEqual(getPlatformTransferDrafts(), []);
    await assert.rejects(createTransferDraft(request()), { code: 'WALLET_MISSING' });
    await assert.rejects(wallet.verifyPassword(password), { code: 'WALLET_MISSING' });
    created = await wallet.createWallet(password);
    wallet.commitWallet();
    wallet.lock();
    vault = memory.get(vaultKey);
    memory.set('fixture:platform-balances', '{"available":"1000","frozen":"0"}');
    baseline = new Map(memory);
    draftKey = `${draftPrefix}${created.address.toLowerCase()}`;
  });

  await t.test('validates network assets, precise positive amounts and destination addresses before saving', async () => {
    await assert.rejects(createTransferDraft(request({ direction: 'other' })), { code: 'DIRECTION_INVALID' });
    await assert.rejects(createTransferDraft(request({ asset: 'ETH' })), { code: 'ASSET_UNSUPPORTED' });
    for (const amount of ['0', '-1', '1e3', 'NaN', '0.0000000000000000001', 1]) {
      await assert.rejects(createTransferDraft(request({ amount })), { code: 'AMOUNT_INVALID' });
    }
    await assert.rejects(createTransferDraft(request({ asset: 'USDT', amount: '1.0000001' })), { code: 'AMOUNT_INVALID' });
    await assert.rejects(createTransferDraft(request({ direction: 'withdraw', address: 'invalid' })), { code: 'ADDRESS_INVALID' });
    await assert.rejects(createTransferDraft(request({ direction: 'withdraw', address: '0x0000000000000000000000000000000000000000' })), { code: 'ADDRESS_ZERO' });
    await assert.rejects(createTransferDraft(request({ address: recipient })), { code: 'DEPOSIT_ADDRESS_UNAVAILABLE' });
    assert.equal(memory.has(draftKey), false);
  });

  await t.test('verifies a locked wallet without unlocking or returning secrets', async () => {
    const result = await wallet.verifyPassword(password);
    assert.deepEqual(result, { verified: true, address: created.address });
    assert.equal(wallet.getWalletState().unlocked, false);
    assert.deepEqual(memory, baseline);
  });

  await t.test('wrong password creates no draft or financial state', async () => {
    await assert.rejects(createTransferDraft(request({ password: 'incorrect-password-199' })), { code: 'UNLOCK_FAILED' });
    assert.equal(memory.has(draftKey), false);
    assert.equal(wallet.getWalletState().unlocked, false);
    assert.deepEqual(memory, baseline);
  });

  await t.test('a deposit draft records only the actual source wallet with no platform deposit address', async () => {
    deposit = await createTransferDraft(request({ amount: '0.100000000000000001' }));
    assert.equal(deposit.amount, '0.100000000000000001');
    assert.equal(deposit.address, created.address);
    assert.equal(deposit.addressRole, 'source');
    assert.equal(deposit.source, created.address);
    assert.equal(deposit.destination, '平台余额');
    assert.equal(deposit.walletAddress, created.address);
    assert.equal(deposit.network, 'BSC Testnet');
    assert.equal(deposit.chainId, 97);
    assert.equal(deposit.status, 'service_not_connected');
    assert.equal(Object.hasOwn(deposit, 'hash'), false);
    assert.equal(Object.hasOwn(deposit, 'fee'), false);
    assert.equal(wallet.getWalletState().unlocked, false);
  });

  await t.test('a withdrawal draft records the selected EVM destination and exact USDT decimals', async () => {
    const withdrawal = await createTransferDraft(request({ direction: 'withdraw', asset: 'USDT', amount: '1.000001', address: recipient }));
    assert.equal(withdrawal.amount, '1.000001');
    assert.equal(withdrawal.address, recipient);
    assert.equal(withdrawal.addressRole, 'destination');
    assert.equal(withdrawal.source, '平台余额');
    assert.equal(withdrawal.destination, recipient);
    assert.equal(withdrawal.status, 'service_not_connected');
    assert.equal(getPlatformTransferDrafts().length, 2);
  });

  await t.test('locking or cancelling during password verification prevents saving', async () => {
    const before = memory.get(draftKey);
    const pending = createTransferDraft(request());
    wallet.lock();
    await assert.rejects(pending, { code: 'SESSION_CHANGED' });
    const verification = wallet.verifyPassword(password);
    wallet.cancelCreation();
    await assert.rejects(verification, { code: 'SESSION_CHANGED' });
    assert.equal(memory.get(draftKey), before);
  });

  await t.test('wallet changes during password verification prevent saving', async () => {
    const before = memory.get(draftKey);
    const pending = createTransferDraft(request());
    memory.delete(vaultKey);
    await assert.rejects(pending, { code: 'SESSION_CHANGED' });
    memory.set(vaultKey, vault);
    assert.equal(memory.get(draftKey), before);
  });

  await t.test('a corrupt wallet is rejected without replacing any stored file', async () => {
    memory.set(vaultKey, '{broken');
    await assert.rejects(createTransferDraft(request()), { code: 'VAULT_INVALID' });
    assert.throws(() => getPlatformTransferDrafts(), { code: 'VAULT_INVALID' });
    assert.equal(memory.get(vaultKey), '{broken');
    memory.set(vaultKey, vault);
  });

  await t.test('storage failures report no saved draft and preserve existing records', async () => {
    const before = memory.get(draftKey);
    failWrite = true;
    await assert.rejects(createTransferDraft(request()), { code: 'STORAGE_UNAVAILABLE' });
    failWrite = false;
    assert.equal(memory.get(draftKey), before);
    failRead = true;
    assert.throws(() => getPlatformTransferDrafts(), { code: 'STORAGE_UNAVAILABLE' });
    failRead = false;
    memory.set(draftKey, '{broken');
    assert.throws(() => getPlatformTransferDrafts(), { code: 'DRAFTS_INVALID' });
    await assert.rejects(createTransferDraft(request()), { code: 'DRAFTS_INVALID' });
    assert.equal(memory.get(draftKey), '{broken');
    memory.set(draftKey, before);
  });

  await t.test('untrusted local records cannot be returned as completed transfers', () => {
    const before = memory.get(draftKey);
    const rows = JSON.parse(before);
    rows.push({ ...deposit, id: randomUUID(), status: 'completed' });
    rows[0].password = 'untrusted-extra-field';
    rows[0].privateKey = 'untrusted-extra-field';
    memory.set(draftKey, JSON.stringify(rows));
    const drafts = getPlatformTransferDrafts();
    assert.equal(drafts.length, 2);
    assert.ok(drafts.every(item => item.status === 'service_not_connected'));
    assert.ok(drafts.every(item => !Object.hasOwn(item, 'password') && !Object.hasOwn(item, 'privateKey')));
    memory.set(draftKey, before);
  });

  await t.test('limits local history to 50 drafts without changing unrelated storage', async () => {
    const rows = Array.from({ length: 60 }, (_, index) => ({ ...deposit, id: randomUUID(), createdAt: index }));
    memory.set(draftKey, JSON.stringify(rows));
    assert.equal(getPlatformTransferDrafts().length, 50);
    const newest = await createTransferDraft(request());
    assert.equal(getPlatformTransferDrafts()[0].id, newest.id);
    assert.equal(getPlatformTransferDrafts().length, 50);
    assert.equal(JSON.parse(memory.get(draftKey)).length, 50);
    for (const [key, value] of baseline) assert.equal(memory.get(key), value);
    assert.equal(wallet.getRecords().length, 0);
    assert.equal(networkCalls, 0);
    const persisted = [...memory.values()].join();
    assert.equal(persisted.includes(password), false);
    assert.equal(persisted.includes(created.phrase), false);
  });

  await t.test('scopes draft history to the actual wallet address', async () => {
    const firstHistory = memory.get(draftKey);
    wallet.lock();
    memory.delete(vaultKey);
    await wallet.createWallet(password);
    wallet.commitWallet();
    assert.notEqual(wallet.getWalletState().address, created.address);
    assert.deepEqual(getPlatformTransferDrafts(), []);
    wallet.lock();
    memory.set(vaultKey, vault);
    assert.equal(getPlatformTransferDrafts().length, 50);
    assert.equal(memory.get(draftKey), firstHistory);
    assert.equal(networkCalls, 0);
  });
});
