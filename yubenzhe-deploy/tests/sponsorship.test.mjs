import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { AbiCoder, Interface, concat, keccak256, toBeHex } from 'ethers';
import { ENTRY_POINT_V07, createSponsorshipPolicy, normalizeUserOperationV07, sponsorshipDigest, userOperationHashV07 } from '../server/sponsorship-policy.mjs';
import { openSponsorshipJournal } from '../server/sponsorship-accounting.mjs';
import { createPaymasterService, getSponsorshipAvailability } from '../server/paymaster-service.mjs';

const ADDRESS = index => toBeHex(index, 20), HASH = index => toBeHex(index, 32);
const TARGET = ADDRESS(1001), FACTORY = ADDRESS(1002), PAYMASTER = ADDRESS(1003);
const CODE = { entryPointCode: '0x60016001', accountCode: '0x60026002', factoryCode: '0x60036003', paymasterCode: '0x60046004', targetCode: '0x60056005' };
const ACCOUNT_ABI = new Interface(['function execute(address dest,uint256 value,bytes func)', 'function executeBatch(address[] dest,uint256[] value,bytes[] func)']);
const FACTORY_ABI = new Interface(['function createAccount(address owner,uint256 salt)']);
const INNER_ABI = new Interface(['function enter(bytes32 context)']);
const INNER = INNER_ABI.encodeFunctionData('enter', [HASH(21)]);
const expected = code => error => error?.code === code;
const BASE_TIME = Date.UTC(2026, 9, 12, 12);
function config(overrides = {}) {
  return {
    id: 'onboarding-local-v1', mode: 'local-harness', chainId: 97, testnet: true, entryPoint: ENTRY_POINT_V07, entryPointVersion: '0.7',
    entryPointRuntimeHash: keccak256(CODE.entryPointCode), accountRuntimeHash: keccak256(CODE.accountCode),
    factory: { address: FACTORY, runtimeHash: keccak256(CODE.factoryCode) }, paymaster: { address: PAYMASTER, runtimeHash: keccak256(CODE.paymasterCode) },
    senders: Array.from({ length: 20 }, (_, index) => ({ sender: ADDRESS(index + 1), ownerId: `owner-${index + 1}`, ownerAddress: ADDRESS(index + 101), salt: '0' })),
    calls: ['create', 'first-entry'].map(action => ({ action, target: TARGET, selector: INNER.slice(0, 10), callDataHash: keccak256(INNER), runtimeHash: keccak256(CODE.targetCode) })),
    budget: { monthlyWei: '10000', dailyWei: '10000', userDailyWei: '1000', sessionWei: '10000', singleWei: '1000', userHourly: 3, globalHourly: 100 },
    ...overrides,
  };
}
function operation(index = 1) { return { sender: ADDRESS(index), nonce: '0x0', callData: ACCOUNT_ABI.encodeFunctionData('execute', [TARGET, 0n, INNER]), callGasLimit: '0x64', verificationGasLimit: '0xc8', preVerificationGas: '0x12c', maxFeePerGas: '0x1', maxPriorityFeePerGas: '0x1' }; }
function input(index = 1, extra = {}) { return { ownerId: `owner-${index}`, sessionId: `session-${index}`, requestId: `request-${index}`, chainId: 97, entryPoint: ENTRY_POINT_V07, operation: operation(index), ...extra }; }
function evidence(op, chainId = 97) { const index = Number(BigInt(op.sender)); return { ...CODE, chainId, entryPoint: ENTRY_POINT_V07, nonce: op.nonce, ownerAddress: ADDRESS(index + 100), ...(op.factory ? { accountCode: '0x', predictedSender: op.sender } : {}) }; }
const stub = () => ({ paymaster: PAYMASTER, paymasterData: '0x0102', paymasterVerificationGasLimit: '0x32', paymasterPostOpGasLimit: '0x32' });
const estimate = () => ({ callGasLimit: '0x64', verificationGasLimit: '0xc8', preVerificationGas: '0x12c', paymasterVerificationGasLimit: '0x32', paymasterPostOpGasLimit: '0x32' });
function receipt(record, changes = {}) { return { simulation: true, chainId: record.chainId, entryPoint: record.entryPoint, sender: record.sender, nonce: record.nonce, paymaster: PAYMASTER, userOpHash: record.userOpHash, actualGasCost: '600', success: true, transactionHash: HASH(501), blockHash: HASH(502), canonicalBlockHash: HASH(502), confirmations: 3, ...changes }; }
function fixture(t, overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ybz-sponsorship-')), filename = join(dir, 'journal.sqlite'), handles = new Set();
  let time = BASE_TIME;
  const now = () => time, cfg = config(overrides), policy = createSponsorshipPolicy(cfg);
  const open = create => { const journal = openSponsorshipJournal({ filename, create, mode: 'local-harness', now }); handles.add(journal); return journal; };
  const close = journal => { journal.close(); handles.delete(journal); };
  const journal = open(true), calls = [], behaviors = {};
  const defaults = { inspect: arg => evidence(arg.operation, arg.chainId), getStubData: stub, estimateGas: estimate, getFinalData: () => ({ data: { ...stub(), paymasterData: '0x0304' }, validUntil: now() + 600000 }), getReceipt: () => null };
  const fakeTransport = Object.fromEntries(Object.entries(defaults).map(([key, fn]) => [key, async arg => { calls.push(key); return (behaviors[key] || fn)(arg); }])); fakeTransport.kind = 'local-fake';
  const serviceFor = (ledger = journal, policyConfig = cfg) => createPaymasterService({ mode: 'local-harness', policy: policyConfig, journal: ledger, fakeTransport, now, timeoutMs: 40 });
  const decision = (index = 1, extra = {}) => { const request = input(index, extra); return policy.evaluate({ ...request, evidence: evidence(request.operation, request.chainId) }); };
  const reserve = (ledger = journal, index = 1, extra = {}) => { const request = input(index, extra); return ledger.reserve(decision(index, extra), { requestId: request.requestId, fingerprint: sponsorshipDigest(request) }); };
  t.after(() => { for (const ledger of handles) ledger.close(); assert.equal(dirname(dir), resolve(tmpdir())); assert.match(basename(dir), /^ybz-sponsorship-[A-Za-z0-9]+$/); rmSync(dir, { recursive: true, force: true }); });
  return { dir, filename, cfg, policy, journal, calls, behaviors, fakeTransport, now, open, close, decision, reserve, service: serviceFor(), serviceFor, advance: ms => { time += ms; }, setTime: value => { time = value; } };
}

test('real sponsorship stays disabled without opening any journal or calling a provider', async () => {
  const service = createPaymasterService({ enabled: true, fakeTransport: { inspect() { assert.fail('provider called'); } } });
  assert.equal(getSponsorshipAvailability().enabled, false);
  assert.equal(service.getAvailability().missing.includes('USER_OPERATION_WALLET_SIGNATURE'), true);
  const result = await service.request({});
  assert.equal(result.status, 'self-pay-required'); assert.equal(result.requiresUserApproval, true); assert.equal(result.broadcast, false);
  assert.throws(() => createPaymasterService({ mode: 'enabled' }), expected('SPONSORSHIP_CONFIG'));
  assert.throws(() => createPaymasterService({ mode: 'local-harness', fakeTransport: { kind: 'real' } }), expected('SPONSORSHIP_CONFIG'));
});

test('policy rejects every configured mainnet, mismatched EntryPoint version and missing verified codehash', () => {
  for (const chainId of [1, 56, 137, 42161]) assert.throws(() => createSponsorshipPolicy(config({ chainId })), expected('SPONSORSHIP_CHAIN'));
  assert.throws(() => createSponsorshipPolicy(config({ entryPointVersion: '0.6' })), expected('SPONSORSHIP_ENTRYPOINT'));
  assert.throws(() => createSponsorshipPolicy(config({ entryPointRuntimeHash: '' })), expected('SPONSORSHIP_INVALID'));
  const policy = createSponsorshipPolicy(config({ entryPoint: ENTRY_POINT_V07.toLowerCase() }));
  assert.equal(policy.getConfig().entryPoint, ENTRY_POINT_V07);
  assert.equal(policy.evaluate({ ...input(), evidence: evidence(operation()) }).action, 'first-entry');
});

test('v0.7 normalization rejects v0.6, signatures, negative numbers and mixed payload fields', () => {
  for (const fields of [{ initCode: '0x' }, { paymasterAndData: '0x' }, { signature: '0xabc0' }, { nonce: '-1' }, { callGasLimit: '0' }, { callGasLimit: 1 }, { sender: 'not-an-address' }, { factoryData: '0x' }]) assert.throws(() => normalizeUserOperationV07({ ...operation(), ...fields }));
});

test('EntryPoint, account, target and paymaster runtime must match trusted local codehash configuration', () => {
  const policy = createSponsorshipPolicy(config());
  for (const key of ['entryPointCode', 'accountCode', 'targetCode', 'paymasterCode']) assert.throws(() => policy.evaluate({ ...input(), evidence: { ...evidence(operation()), [key]: '0x6000' } }), expected('SPONSORSHIP_CODE_MISMATCH'));
});

test('sender ownership, chain, nonce and owner address are independently bound', () => {
  const policy = createSponsorshipPolicy(config());
  for (const [change, proof, code] of [[{ ownerId: 'other-owner' }, {}, 'SPONSORSHIP_SENDER'], [{ chainId: 31337 }, {}, 'SPONSORSHIP_CHAIN'], [{}, { nonce: '1' }, 'SPONSORSHIP_ACCOUNT_BINDING'], [{}, { ownerAddress: ADDRESS(200) }, 'SPONSORSHIP_ACCOUNT_BINDING']]) assert.throws(() => policy.evaluate({ ...input(), ...change, evidence: { ...evidence(operation()), ...proof } }), expected(code));
});

test('factory-based creation derives its action and binds factory calldata, owner, salt and predicted sender', () => {
  const policy = createSponsorshipPolicy(config()), op = { ...operation(), factory: FACTORY, factoryData: FACTORY_ABI.encodeFunctionData('createAccount', [ADDRESS(101), 0]) };
  assert.equal(policy.evaluate({ ...input(), action: 'anything-user-says', operation: op, evidence: evidence(op) }).action, 'create');
  for (const change of [{ predictedSender: ADDRESS(9) }, { factoryCode: '0x6000' }, { accountCode: CODE.accountCode }]) assert.throws(() => policy.evaluate({ ...input(), operation: op, evidence: { ...evidence(op), ...change } }));
  const bad = { ...op, factoryData: FACTORY_ABI.encodeFunctionData('createAccount', [ADDRESS(101), 1]) };
  assert.throws(() => policy.evaluate({ ...input(), operation: bad, evidence: evidence(bad) }), expected('SPONSORSHIP_FACTORY'));
});

test('an allowed execute selector cannot hide another target, selector, argument or native value', () => {
  const policy = createSponsorshipPolicy(config());
  for (const args of [[ADDRESS(999), 0, INNER], [TARGET, 0, '0xdeadbeef'], [TARGET, 0, INNER_ABI.encodeFunctionData('enter', [HASH(22)])], [TARGET, 1, INNER]]) {
    const op = { ...operation(), callData: ACCOUNT_ABI.encodeFunctionData('execute', args) };
    assert.throws(() => policy.evaluate({ ...input(), operation: op, evidence: evidence(op) }), error => ['SPONSORSHIP_VALUE', 'SPONSORSHIP_INNER_CALL'].includes(error.code));
  }
});

test('executeBatch and trailing ABI bytes are explicitly rejected', () => {
  const policy = createSponsorshipPolicy(config());
  for (const callData of [ACCOUNT_ABI.encodeFunctionData('executeBatch', [[TARGET], [0], [INNER]]), operation().callData + '00']) {
    const op = { ...operation(), callData }; assert.throws(() => policy.evaluate({ ...input(), operation: op, evidence: evidence(op) }), expected('SPONSORSHIP_CALL_BLOCKED'));
  }
});

test('gas aggregate, fee pair, fee ceiling and single-operation cap are enforced with BigInt', () => {
  const policy = createSponsorshipPolicy(config());
  for (const fields of [{ callGasLimit: '2000001' }, { maxFeePerGas: '1000000001' }, { maxPriorityFeePerGas: '2' }, { callGasLimit: '1001' }]) {
    const op = { ...operation(), ...fields }; assert.throws(() => policy.evaluate({ ...input(), operation: op, evidence: evidence(op) }), error => ['SPONSORSHIP_GAS_CAP', 'SPONSORSHIP_SINGLE_CAP'].includes(error.code));
  }
});

test('v0.7 hash matches explicit Solidity packing and changes with chain or nonce', () => {
  const op = { ...operation(), ...stub() }, abi = AbiCoder.defaultAbiCoder();
  const packedGas = toBeHex((200n << 128n) | 100n, 32), packedFees = toBeHex((1n << 128n) | 1n, 32);
  const pm = concat([PAYMASTER, toBeHex(50, 16), toBeHex(50, 16), '0x0102']);
  const inner = keccak256(abi.encode(['address', 'uint256', 'bytes32', 'bytes32', 'bytes32', 'uint256', 'bytes32', 'bytes32'], [op.sender, 0, keccak256('0x'), keccak256(op.callData), packedGas, 300, packedFees, keccak256(pm)]));
  const expectedHash = keccak256(abi.encode(['bytes32', 'address', 'uint256'], [inner, ENTRY_POINT_V07, 97]));
  assert.equal(userOperationHashV07(op, ENTRY_POINT_V07, 97), expectedHash);
  assert.notEqual(userOperationHashV07(op, ENTRY_POINT_V07, 31337), expectedHash);
  assert.notEqual(userOperationHashV07({ ...op, nonce: '1' }, ENTRY_POINT_V07, 97), expectedHash);
});

test('journal requires an explicit new durable file and refuses existing user databases without touching bytes', t => {
  const f = fixture(t), unrelated = join(f.dir, 'ordinary-user.sqlite');
  const db = new DatabaseSync(unrelated); db.exec('CREATE TABLE accounts(id TEXT);INSERT INTO accounts VALUES(\'preserve-me\')'); db.close();
  const before = readFileSync(unrelated);
  assert.throws(() => openSponsorshipJournal({ filename: unrelated, mode: 'local-harness' }), expected('SPONSORSHIP_JOURNAL_INVALID'));
  assert.deepEqual(readFileSync(unrelated), before);
  assert.throws(() => openSponsorshipJournal({ filename: unrelated, mode: 'local-harness', create: true }), { code: 'EEXIST' });
  assert.throws(() => openSponsorshipJournal({ filename: ':memory:', mode: 'local-harness' }), expected('SPONSORSHIP_JOURNAL_INVALID'));
});

test('reserve commits before fake provider calls and successful harness authorization never signs or broadcasts', async t => {
  const f = fixture(t);
  f.behaviors.getStubData = () => { assert.equal(f.journal.find('owner-1', 'request-1').state, 'requesting'); return stub(); };
  const result = await f.service.request(input());
  assert.equal(result.status, 'authorized-local-only');
  assert.deepEqual(f.calls, ['inspect', 'getStubData', 'estimateGas', 'getFinalData']);
  assert.equal(result.sponsored, false); assert.equal(result.signed, false); assert.equal(result.broadcast, false);
  assert.equal(f.journal.stats().heldWei, '1000'); assert.equal(f.journal.stats().actualCostWei, '0');
});

test('repeated identical request reuses durable record without any second provider call', async t => {
  const f = fixture(t), first = await f.service.request(input()), calls = f.calls.length;
  const again = await f.service.request(input()); assert.equal(again.record.id, first.record.id); assert.equal(again.status, 'verify-existing'); assert.equal(f.calls.length, calls);
  await assert.rejects(f.service.request(input(1, { operation: { ...operation(), nonce: '1' } })), expected('SPONSORSHIP_IDEMPOTENCY_CONFLICT'));
});

test('unknown authorization survives closing/reopening journal and cannot be resent under any new request id', async t => {
  const f = fixture(t); f.behaviors.getFinalData = () => { throw Error('simulated provider interruption'); };
  const unknown = await f.service.request(input()); assert.equal(unknown.status, 'verify-existing'); assert.equal(unknown.record.state, 'unknown');
  f.close(f.journal); const reopened = f.open(false), service = f.serviceFor(reopened), count = f.calls.length;
  for (const request of [input(), input(1, { requestId: 'another', operation: { ...operation(), nonce: '1' } }), input(1, { requestId: 'another-chain', chainId: 31337 })]) assert.equal((await service.request(request)).status, 'verify-existing');
  assert.equal(f.calls.length, count); assert.equal(reopened.stats().heldWei, '1000');
});

test('unknown held state never suggests self-pay even after pause, changed policy or sender reassignment', async t => {
  const f = fixture(t); f.behaviors.getStubData = () => { throw Error('unknown'); }; await f.service.request(input());
  f.journal.setPaused(true);
  assert.equal((await f.service.request(input(1, { requestId: 'paused-retry' }))).status, 'verify-existing');
  const otherPolicy = f.serviceFor(f.journal, config({ id: 'new-policy' }));
  assert.equal((await otherPolicy.request(input(1, { requestId: 'new-policy-retry' }))).status, 'verify-existing');
  const collision = await f.service.request(input(2, { operation: operation(1) }));
  assert.equal(collision.status, 'verify-existing'); assert.equal(collision.record, null);
});

test('crash after reserving but before provider start still blocks a restart from retrying', async t => {
  const f = fixture(t), requested = input(), fingerprint = sponsorshipDigest({ ownerId: requested.ownerId, sessionId: requested.sessionId, chainId: requested.chainId, entryPoint: requested.entryPoint, operation: normalizeUserOperationV07(requested.operation) });
  f.journal.reserve(f.decision(), { requestId: requested.requestId, fingerprint }); f.close(f.journal);
  const reopened = f.open(false), result = await f.serviceFor(reopened).request(requested);
  assert.equal(result.status, 'verify-existing'); assert.equal(result.record.state, 'reserved'); assert.deepEqual(f.calls, []);
});

test('two journal connections cannot oversubscribe one remaining budget slot', async t => {
  const f = fixture(t, { budget: { ...config().budget, monthlyWei: '1000', dailyWei: '1000' } }), second = f.open(false);
  const results = await Promise.all([Promise.resolve().then(() => f.reserve(f.journal, 1)), Promise.resolve().then(() => f.reserve(second, 2))]);
  assert.equal(results.filter(row => row.created).length, 1); assert.equal(results.find(row => !row.created).reason, 'SPONSORSHIP_BUDGET_EXHAUSTED');
  assert.equal(second.stats().heldWei, '1000');
});

test('simultaneous services reserve a single operation and call the fake provider only once', async t => {
  const f = fixture(t), second = f.open(false), another = f.serviceFor(second);
  const results = await Promise.all([f.service.request(input()), another.request(input())]);
  assert.equal(results.filter(row => row.status === 'authorized-local-only').length, 1);
  assert.equal(f.calls.filter(name => name === 'getFinalData').length, 1);
  assert.equal(f.journal.stats().reservations, 1);
});

test('monthly, daily, per-user and per-session hard caps each reject without any reservation', t => {
  for (const key of ['monthlyWei', 'dailyWei', 'userDailyWei', 'sessionWei']) {
    const f = fixture(t, { budget: { ...config().budget, [key]: '999' } });
    const result = f.reserve(); assert.equal(result.reason, 'SPONSORSHIP_BUDGET_EXHAUSTED', key); assert.equal(f.journal.stats().reservations, 0);
  }
});

test('70 and 90 percent budget alerts are emitted once and survive journal restart', t => {
  const f = fixture(t), events = [];
  for (let index = 1; index <= 9; index++) events.push(...f.reserve(f.journal, index).alerts);
  assert.deepEqual(events.map(row => `${row.scope}:${row.threshold}`), ['month:70', 'day:70', 'month:90', 'day:90']);
  f.close(f.journal); const reopened = f.open(false); assert.equal(f.reserve(reopened, 10).alerts.length, 0); assert.equal(reopened.stats().alerts.length, 4);
});

test('global hourly limit is durable and clock rollback cannot clear it', t => {
  const f = fixture(t, { budget: { ...config().budget, globalHourly: 1 } });
  f.reserve(); f.setTime(BASE_TIME - 7200000);
  assert.equal(f.reserve(f.journal, 2).reason, 'SPONSORSHIP_RATE_LIMIT');
  f.setTime(BASE_TIME + 3600000);
  assert.equal(f.reserve(f.journal, 2).created, true);
});

test('budget exhaustion produces an explicit self-pay review and never submits anything automatically', async t => {
  const f = fixture(t, { budget: { ...config().budget, monthlyWei: '1000' } });
  await f.service.request(input());
  const count = f.calls.filter(item => item === 'getFinalData').length, result = await f.service.request(input(2));
  assert.equal(result.status, 'self-pay-required'); assert.equal(result.reason, 'SPONSORSHIP_BUDGET_EXHAUSTED'); assert.equal(result.requiresUserApproval, true); assert.equal(result.broadcast, false);
  assert.equal(f.calls.filter(item => item === 'getFinalData').length, count);
});

test('provider cannot change transaction fields through stub, estimate or final response', async t => {
  for (const method of ['getStubData', 'estimateGas', 'getFinalData']) {
    const f = fixture(t); f.behaviors[method] = () => method === 'getFinalData' ? { data: { ...stub(), callData: '0xdeadbeef' }, validUntil: f.now() + 600000 } : { ...(method === 'estimateGas' ? estimate() : stub()), sender: ADDRESS(20) };
    const result = await f.service.request(input()); assert.equal(result.status, 'verify-existing'); assert.equal(result.record.state, 'unknown'); assert.equal(f.journal.stats().heldWei, '1000');
  }
});

test('an estimate exceeding gas or reserved cost cannot reach final authorization', async t => {
  const f = fixture(t); f.behaviors.estimateGas = () => ({ ...estimate(), callGasLimit: '2000001' });
  const result = await f.service.request(input()); assert.equal(result.reason, 'SPONSORSHIP_GAS_CAP'); assert.equal(f.calls.includes('getFinalData'), false); assert.equal(f.journal.stats().heldWei, '1000');
});

test('final authorization rejects altered gas, wrong paymaster and invalid lifetime', async t => {
  for (const changes of [{ data: { ...stub(), paymasterPostOpGasLimit: '51' } }, { data: { ...stub(), paymaster: ADDRESS(20) } }, { validUntil: BASE_TIME }, { validUntil: BASE_TIME + 600001 }]) {
    const f = fixture(t); f.behaviors.getFinalData = () => ({ data: stub(), validUntil: f.now() + 600000, ...changes });
    assert.equal((await f.service.request(input())).status, 'verify-existing'); assert.equal(f.journal.stats().heldWei, '1000');
  }
});

test('pause during final authorization keeps the durable hold and suppresses authorized result', async t => {
  const f = fixture(t); f.behaviors.getFinalData = () => { f.journal.setPaused(true); return { data: stub(), validUntil: f.now() + 600000 }; };
  const result = await f.service.request(input()); assert.equal(result.status, 'verify-existing'); assert.equal(result.reason, 'SPONSORSHIP_PAUSED'); assert.equal(result.record.state, 'unknown');
});

test('provider timeout becomes unknown and cannot retry after a late answer', async t => {
  const f = fixture(t); let finish;
  f.behaviors.getFinalData = () => new Promise(resolve => { finish = resolve; });
  const result = await f.service.request(input()); assert.equal(result.record.state, 'unknown'); assert.equal(result.reason, 'SPONSORSHIP_UNKNOWN');
  finish({ data: stub(), validUntil: f.now() + 600000 }); await Promise.resolve();
  const count = f.calls.length; assert.equal((await f.service.request(input())).status, 'verify-existing'); assert.equal(f.calls.length, count);
});

test('null, accepted or expired lifecycle results never become successful payment or release', async t => {
  const f = fixture(t), result = await f.service.request(input());
  for (const response of [null, { state: 'accepted' }, { state: 'expired' }]) {
    f.behaviors.getReceipt = () => response;
    const status = await f.service.reconcile({ reservationId: result.record.id, ownerId: 'owner-1' });
    assert.equal(status.status, 'verify-existing'); assert.equal(f.journal.stats().heldWei, '1000');
  }
});

test('canonical receipt binds chain, EntryPoint, sender, nonce, userOpHash, paymaster and cost', async t => {
  const f = fixture(t), result = await f.service.request(input());
  for (const change of [{ chainId: 31337 }, { entryPoint: ADDRESS(20) }, { sender: ADDRESS(20) }, { nonce: '1' }, { userOpHash: HASH(999) }, { paymaster: ADDRESS(20) }, { canonicalBlockHash: HASH(999) }, { confirmations: 2 }, { actualGasCost: '1001' }, { simulation: false }]) {
    f.behaviors.getReceipt = () => receipt(result.record, change);
    assert.equal((await f.service.reconcile({ reservationId: result.record.id, ownerId: 'owner-1' })).status, 'verify-existing'); assert.equal(f.journal.stats().heldWei, '1000');
  }
});

test('a verified local receipt settles actual platform cost once and failed execution still consumes gas', async t => {
  for (const success of [true, false]) {
    const f = fixture(t), result = await f.service.request(input());
    f.behaviors.getReceipt = () => receipt(result.record, { success });
    const status = await f.service.reconcile({ reservationId: result.record.id, ownerId: 'owner-1' });
    assert.equal(status.status, 'settled-local-only'); assert.equal(status.record.state, success ? 'confirmed' : 'failed');
    assert.equal(f.journal.stats().heldWei, '0'); assert.equal(f.journal.stats().actualCostWei, '600');
    await f.service.reconcile({ reservationId: result.record.id, ownerId: 'owner-1' }); assert.equal(f.journal.stats().actualCostWei, '600');
    assert.equal((await f.service.request(input(1, { requestId: 'another-attempt' }))).reason, 'SPONSORSHIP_ONCE_USED');
  }
});

test('unknown holds carry across days and months and late settlement charges the verification period', async t => {
  const f = fixture(t, { budget: { ...config().budget, monthlyWei: '1500', dailyWei: '1500' } });
  f.setTime(Date.UTC(2026, 9, 31, 23, 59)); const result = await f.service.request(input());
  await f.service.reconcile({ reservationId: result.record.id, ownerId: 'owner-1' });
  f.setTime(Date.UTC(2026, 10, 1, 0, 1));
  assert.equal(f.journal.stats().monthCommittedWei, '1000');
  assert.equal((await f.service.request(input(2))).reason, 'SPONSORSHIP_BUDGET_EXHAUSTED');
  f.behaviors.getReceipt = () => receipt(result.record);
  await f.service.reconcile({ reservationId: result.record.id, ownerId: 'owner-1' });
  assert.equal(f.journal.stats().monthCommittedWei, '600'); assert.equal(f.journal.stats().dayCommittedWei, '600');
  assert.equal((await f.service.request(input(2))).reason, 'SPONSORSHIP_BUDGET_EXHAUSTED');
});

test('pausing sponsorship still permits read-only reconciliation of an existing authorization', async t => {
  const f = fixture(t), result = await f.service.request(input()); f.journal.setPaused(true);
  f.behaviors.getReceipt = () => receipt(result.record);
  assert.equal((await f.service.reconcile({ reservationId: result.record.id, ownerId: 'owner-1' })).status, 'settled-local-only');
  assert.equal((await f.service.request(input(2))).reason, 'SPONSORSHIP_PAUSED');
});

test('concurrent receipt success and null response both return settled state without changing it to unknown', async t => {
  const f = fixture(t), result = await f.service.request(input()), waiters = [];
  f.behaviors.getReceipt = () => new Promise(resolve => waiters.push(resolve));
  const a = f.service.reconcile({ reservationId: result.record.id, ownerId: 'owner-1' }), b = f.service.reconcile({ reservationId: result.record.id, ownerId: 'owner-1' });
  await Promise.resolve(); await Promise.resolve();
  waiters[0](receipt(result.record)); await a; waiters[1](null);
  assert.equal((await b).status, 'settled-local-only'); assert.equal(f.journal.get(result.record.id).state, 'confirmed');
});

test('a competing journal writer settling before markUnknown preserves either terminal state atomically', async t => {
  for (const success of [true, false]) {
    const f = fixture(t), result = await f.service.request(input()), competing = f.open(false);
    let settled;
    const delayedJournal = { ...f.journal, markUnknown(reservationId) {
      settled = competing.settle(reservationId, receipt(result.record, { success }));
      f.advance(1);
      return f.journal.markUnknown(reservationId);
    } };
    const status = await f.serviceFor(delayedJournal).reconcile({ reservationId: result.record.id, ownerId: 'owner-1' });
    assert.equal(status.status, 'settled-local-only');
    assert.deepEqual(status.record, settled);
    assert.deepEqual(competing.get(result.record.id), settled);
    assert.equal(f.journal.stats().actualCostWei, '600');
    assert.equal(f.journal.stats().heldWei, '0');
  }
});

test('journal and service never expose another owner record through reconciliation', async t => {
  const f = fixture(t), result = await f.service.request(input());
  await assert.rejects(f.service.reconcile({ reservationId: result.record.id, ownerId: 'owner-2' }), expected('SPONSORSHIP_NOT_FOUND'));
});

test('the same policy encoding works on a synthetic second chain without contacting a real network', t => {
  const f = fixture(t, { chainId: 31337 }), requested = input(1, { chainId: 31337 });
  const decision = f.policy.evaluate({ ...requested, evidence: evidence(requested.operation, 31337) });
  assert.equal(decision.chainId, 31337); assert.equal(decision.sender, operation().sender);
});

test('source has no network, signing, main-key, broadcast or social-database integration', () => {
  for (const file of ['sponsorship-policy.mjs', 'sponsorship-accounting.mjs', 'paymaster-service.mjs']) {
    const source = readFileSync(new URL(`../server/${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /\bfetch\s*\(|\bWebSocket\s*\(|\.signTransaction\s*\(|\.signMessage\s*\(|privateKey|mnemonic|openSocialDatabase\s*\(/);
  }
  const service = createPaymasterService(); assert.equal(service.sendUserOperation, undefined); assert.equal(service.submit, undefined);
});
