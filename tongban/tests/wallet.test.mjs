import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { Transaction, Wallet, keccak256, parseEther } from 'ethers';

const memory = new Map();
globalThis.localStorage = {
  getItem: key => memory.get(key) ?? null,
  setItem: (key, value) => memory.set(key, String(value)),
  removeItem: key => memory.delete(key),
};
if (!globalThis.crypto) globalThis.crypto = webcrypto;

const wallet = await import('../src/wallet.js');
const password = 'test-password-93814';
const to = '0x1111111111111111111111111111111111111111';
let chain = '0x61';
let balance = '0x8ac7230489e80000';
let code = '0x';
let gasPrice = '0x3b9aca00';
let receipt = null;
let rejectBroadcast = false;
const requests = [];
const signedTransactions = [];

// No request leaves this process, including eth_sendRawTransaction.
globalThis.fetch = async (_url, options) => {
  const request = JSON.parse(options.body);
  requests.push(request.method);
  let result;
  switch (request.method) {
    case 'eth_chainId': result = chain; break;
    case 'eth_getCode': result = code; break;
    case 'eth_getBalance': result = balance; break;
    case 'eth_gasPrice': result = gasPrice; break;
    case 'eth_getTransactionCount': result = '0x0'; break;
    case 'eth_estimateGas': result = '0x5208'; break;
    case 'eth_blockNumber': result = '0x64'; break;
    case 'eth_getTransactionReceipt': result = receipt; break;
    case 'eth_sendRawTransaction': {
      const signed = request.params[0];
      signedTransactions.push(Transaction.from(signed));
      if (rejectBroadcast) throw new Error('Simulated connection loss after acceptance');
      result = keccak256(signed);
      break;
    }
    default: throw new Error(`Unexpected RPC method: ${request.method}`);
  }
  return { ok: true, json: async () => ({ jsonrpc: '2.0', id: request.id, result }) };
};

test('self-custody wallet lifecycle and pinned testnet transfer safeguards', async t => {
  let created;
  let successfulTransfer;

  await t.test('rejects weak passwords before generating a wallet', async () => {
    await assert.rejects(wallet.createWallet('123456'), { code: 'PASSWORD_WEAK' });
    assert.deepEqual(wallet.getWalletState(), { exists: false, address: null, unlocked: false });
  });

  await t.test('keeps the new wallet in memory until backup is confirmed', async () => {
    created = await wallet.createWallet(password);
    assert.equal(created.phrase.split(' ').length, 12);
    assert.equal(Wallet.fromPhrase(created.phrase).address, created.address);
    assert.equal(memory.size, 0);
    assert.equal(wallet.getWalletState().exists, false);
    assert.equal(wallet.commitWallet().unlocked, true);
    assert.equal(memory.size, 1);
  });

  await t.test('persists and exports encrypted keystore only', async () => {
    const output = wallet.exportEncryptedKeystore();
    const encrypted = JSON.parse(output.content);
    assert.equal(encrypted.version, 3);
    assert.ok(encrypted.Crypto || encrypted.crypto);
    assert.ok(output.filename.endsWith('.json'));
    const persisted = [...memory.values()].join();
    assert.equal(persisted.includes(created.phrase), false);
    assert.equal(persisted.includes(Wallet.fromPhrase(created.phrase).privateKey), false);
    await assert.rejects(wallet.createWallet(password), { code: 'WALLET_EXISTS' });
    await assert.rejects(wallet.restoreWallet(created.phrase, password), { code: 'WALLET_EXISTS' });
  });

  await t.test('locks in-memory signing and requires the correct password', async () => {
    wallet.lock();
    assert.equal(wallet.getWalletState().unlocked, false);
    await assert.rejects(wallet.prepareTransfer(to, '1'), { code: 'WALLET_LOCKED' });
    await assert.rejects(wallet.unlock('wrong-password-999'), { code: 'UNLOCK_FAILED' });
    assert.equal(wallet.getWalletState().unlocked, false);
    assert.equal((await wallet.unlock(password)).unlocked, true);
  });

  await t.test('rejects invalid recipients and amounts without RPC calls', async () => {
    const count = requests.length;
    await assert.rejects(wallet.prepareTransfer('0x123', '1'), { code: 'ADDRESS_INVALID' });
    await assert.rejects(wallet.prepareTransfer('0x0000000000000000000000000000000000000000', '1'), { code: 'ADDRESS_ZERO' });
    await assert.rejects(wallet.prepareTransfer(created.address, '1'), { code: 'ADDRESS_SELF' });
    for (const amount of ['0', '-1', '1e3', '0.0000000000000000001', 'NaN']) {
      await assert.rejects(wallet.prepareTransfer(to, amount), { code: 'AMOUNT_INVALID' });
    }
    assert.equal(requests.length, count);
  });

  await t.test('rejects a mainnet RPC response', async () => {
    chain = '0x38';
    await assert.rejects(wallet.prepareTransfer(to, '1'), { code: 'CHAIN_MISMATCH' });
    chain = '0x61';
    assert.equal(signedTransactions.length, 0);
  });

  await t.test('rejects contract destinations and insufficient fee balance', async () => {
    code = '0x6000';
    await assert.rejects(wallet.prepareTransfer(to, '1'), { code: 'CONTRACT_UNSUPPORTED' });
    code = '0x';
    balance = '0xde0b6b3a7640000'; // Exactly 1 tBNB, so no gas remains.
    await assert.rejects(wallet.prepareTransfer(to, '1'), { code: 'BALANCE_INSUFFICIENT' });
    balance = '0x8ac7230489e80000';
    assert.equal(signedTransactions.length, 0);
  });

  await t.test('requires a new preview when network fees change', async () => {
    const preview = await wallet.prepareTransfer(to, '1');
    assert.equal(preview.chainId, 97);
    assert.equal(preview.total, '1.000021');
    gasPrice = '0x77359400';
    await assert.rejects(wallet.confirmTransfer(preview.id, password), { code: 'QUOTE_CHANGED' });
    await assert.rejects(wallet.confirmTransfer(preview.id, password), { code: 'PREVIEW_EXPIRED' });
    gasPrice = '0x3b9aca00';
    assert.equal(signedTransactions.length, 0);
  });

  await t.test('signs only the reviewed plain transfer with testnet chain ID', async () => {
    const preview = await wallet.prepareTransfer(to, '0.02');
    successfulTransfer = await wallet.confirmTransfer(preview.id, password);
    assert.equal(successfulTransfer.broadcastUncertain, false);
    assert.equal(successfulTransfer.status, 'pending');
    assert.equal(signedTransactions.length, 1);
    const signed = signedTransactions[0];
    assert.equal(signed.chainId, 97n);
    assert.equal(signed.from, created.address);
    assert.equal(signed.to, to);
    assert.equal(signed.value, parseEther('0.02'));
    assert.equal(signed.data, '0x');
    assert.equal(signed.gasLimit, 21000n);
    assert.equal(signed.nonce, 0);
    await assert.rejects(wallet.confirmTransfer(preview.id, password), { code: 'PREVIEW_EXPIRED' });
    assert.equal(signedTransactions.length, 1);
  });

  await t.test('tracks pending, confirmed and failed receipt states', async () => {
    assert.equal((await wallet.getTransactionStatus(successfulTransfer.hash)).status, 'pending');
    receipt = { transactionHash: successfulTransfer.hash, status: '0x1', blockNumber: '0x63' };
    const status = await wallet.getTransactionStatus(successfulTransfer.hash);
    assert.equal(status.status, 'confirmed');
    assert.equal(status.confirmations, 2);
    assert.equal(status.actualGasFee, undefined);
    assert.equal(wallet.getRecords()[0].status, 'confirmed');
    receipt.gasUsed = '0x5208';
    receipt.effectiveGasPrice = '0x77359400';
    const charged = await wallet.getTransactionStatus(successfulTransfer.hash);
    assert.equal(charged.actualGasFee, '0.000042');
    assert.equal(wallet.getRecords()[0].actualGasFee, '0.000042');
    assert.equal(wallet.getRecords()[0].gasFee, '0.000021');
    const beforeInvalid = JSON.stringify(wallet.getRecords());
    receipt.gasUsed = 'invalid';
    await assert.rejects(wallet.getTransactionStatus(successfulTransfer.hash));
    assert.equal(JSON.stringify(wallet.getRecords()), beforeInvalid);
    receipt.gasUsed = '0x5208';
    receipt.status = '0x0';
    assert.equal((await wallet.getTransactionStatus(successfulTransfer.hash)).status, 'failed');
    receipt = null;
  });

  await t.test('retains the hash after an ambiguous broadcast without resubmitting', async () => {
    const preview = await wallet.prepareTransfer(to, '0.03');
    rejectBroadcast = true;
    const transfer = await wallet.confirmTransfer(preview.id, password);
    rejectBroadcast = false;
    assert.equal(transfer.status, 'pending');
    assert.equal(transfer.broadcastUncertain, true);
    assert.match(transfer.hash, /^0x[0-9a-f]{64}$/);
    assert.equal(wallet.getRecords()[0].hash, transfer.hash);
    await assert.rejects(wallet.confirmTransfer(preview.id, password), { code: 'PREVIEW_EXPIRED' });
    assert.equal(signedTransactions.length, 2);
  });

  await t.test('locking during password verification prevents later signing', async () => {
    const preview = await wallet.prepareTransfer(to, '0.04');
    const confirmation = wallet.confirmTransfer(preview.id, password);
    wallet.lock();
    await assert.rejects(confirmation, { code: 'SESSION_CHANGED' });
    assert.equal(signedTransactions.length, 2);
    assert.equal(wallet.getWalletState().unlocked, false);
  });
});
