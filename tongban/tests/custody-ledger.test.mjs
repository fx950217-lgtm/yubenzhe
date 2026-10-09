import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { Worker } from 'node:worker_threads';
import { CustodyLedger, PACKET_LIFETIME_MS, MAX_AMOUNT } from '../server/custody-ledger.mjs';

const BASE_TIME = Date.UTC(2026, 9, 6, 0, 0, 0);

// Test-only fake credit. Deliberately absent from the production service exports.
function seedFakeCredit(filename, accountId, value) {
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA foreign_keys=ON; BEGIN IMMEDIATE');
  try {
    db.prepare("INSERT OR IGNORE INTO accounts(account_id,kind,normal_side,balance) VALUES ('@fixture:cash','asset','debit','0')").run();
    const reserve = BigInt(db.prepare("SELECT balance FROM accounts WHERE account_id='@fixture:cash'").get().balance);
    const user = BigInt(db.prepare('SELECT balance FROM accounts WHERE account_id=?').get(accountId).balance);
    const tx = `test-funding:${randomUUID()}`;
    db.prepare('INSERT INTO ledger_transactions(transaction_id,operation,created_at) VALUES (?,?,?)').run(tx, 'TEST_ONLY_FAKE_CREDIT', BASE_TIME);
    db.prepare("UPDATE accounts SET balance=? WHERE account_id='@fixture:cash'").run((reserve + value).toString());
    db.prepare('UPDATE accounts SET balance=? WHERE account_id=?').run((user + value).toString(), accountId);
    db.prepare("INSERT INTO postings(transaction_id,account_id,side,amount) VALUES (?,'@fixture:cash','debit',?)").run(tx, value.toString());
    db.prepare("INSERT INTO postings(transaction_id,account_id,side,amount) VALUES (?,?,'credit',?)").run(tx, accountId, value.toString());
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  } finally { db.close(); }
}

function fixture(t, funding = 1000n) {
  const dir = mkdtempSync(join(tmpdir(), 'tongban-custody-test-'));
  const filename = join(dir, 'ledger.sqlite');
  let now = BASE_TIME;
  const ledger = new CustodyLedger({ filename, now: () => now });
  ['alice', 'bob', 'carol', 'dave', 'outsider'].forEach((id) => ledger.createAccount(id));
  if (funding > 0n) seedFakeCredit(filename, 'alice', funding);
  t.after(() => { ledger.close(); rmSync(dir, { recursive: true, force: true }); });
  return { ledger, filename, setTime(value) { now = value; } };
}

function sql(filename, fn) {
  const db = new DatabaseSync(filename);
  try { return fn(db); } finally { db.close(); }
}

function expectCode(fn, code) { assert.throws(fn, (error) => error.code === code, code); }
function ordinary(ledger, overrides = {}) {
  return ledger.createPacket({ senderId: 'alice', recipientIds: ['bob'], total: '100', idempotencyKey: randomUUID(), ...overrides });
}

function assertBalanced(filename) {
  sql(filename, (db) => {
    const totals = new Map();
    const accounts = new Map(db.prepare('SELECT * FROM accounts').all().map((a) => [a.account_id, { ...a, calculated: 0n }]));
    for (const p of db.prepare('SELECT * FROM postings').all()) {
      const value = BigInt(p.amount);
      assert.ok(value > 0n);
      totals.set(p.transaction_id, (totals.get(p.transaction_id) ?? 0n) + (p.side === 'debit' ? value : -value));
      const account = accounts.get(p.account_id);
      account.calculated += account.normal_side === p.side ? value : -value;
    }
    assert.equal(totals.size, db.prepare('SELECT count(*) AS n FROM ledger_transactions').get().n);
    for (const total of totals.values()) assert.equal(total, 0n, 'each ledger transaction balances');
    let assets = 0n;
    let liabilities = 0n;
    for (const a of accounts.values()) {
      assert.equal(BigInt(a.balance), a.calculated, `postings reconcile for ${a.account_id}`);
      assert.ok(a.calculated >= 0n, 'no negative account balances');
      if (a.kind === 'asset') assets += a.calculated;
      else liabilities += a.calculated;
    }
    assert.equal(assets, liabilities, 'asset fixture equals total available and frozen liabilities');
  });
}

async function simultaneousClaims(filename, requests) {
  const url = new URL('../server/custody-ledger.mjs', import.meta.url).href;
  const workers = [];
  let ready = 0;
  const tasks = requests.map((request) => new Promise((resolve, reject) => {
    const worker = new Worker(`
      const { parentPort, workerData } = require('node:worker_threads');
      (async () => {
        const { CustodyLedger } = await import(workerData.url);
        const ledger = new CustodyLedger({ filename: workerData.filename, now: () => workerData.now });
        parentPort.once('message', () => {
          try { parentPort.postMessage({ done:true, ok:true, result:ledger.claim(workerData.request) }); }
          catch (error) { parentPort.postMessage({ done:true, ok:false, code:error.code, message:error.message }); }
          finally { ledger.close(); parentPort.close(); }
        });
        parentPort.postMessage({ ready:true });
      })().catch(error => { parentPort.postMessage({ done:true, ok:false, code:error.code, message:error.message }); parentPort.close(); });
    `, { eval: true, workerData: { url, filename, request, now: BASE_TIME } });
    workers.push(worker);
    worker.on('error', reject);
    worker.on('message', (data) => {
      if (data.ready) {
        ready++;
        if (ready === requests.length) workers.forEach((w) => w.postMessage('start'));
      } else if (data.done) resolve(data);
    });
    worker.on('exit', (code) => { if (code !== 0) reject(new Error(`worker exited ${code}`)); });
  }));
  try { return await Promise.all(tasks); }
  finally { await Promise.all(workers.map((worker) => worker.terminate())); }
}

test('new accounts start empty; there is no public credit/deposit API', (t) => {
  const { ledger, filename } = fixture(t, 0n);
  assert.deepEqual(ledger.getBalance('alice'), { userId: 'alice', available: '0', frozen: '0' });
  for (const method of ['credit', 'deposit', 'seedBalance', 'addMoney']) assert.equal(ledger[method], undefined);
  expectCode(() => ordinary(ledger), 'INSUFFICIENT_BALANCE');
  sql(filename, (db) => {
    assert.equal(db.prepare('SELECT count(*) AS n FROM packets').get().n, 0);
    assert.equal(db.prepare("SELECT count(*) AS n FROM accounts WHERE kind='escrow'").get().n, 0);
  });
  assertBalanced(filename);
});

test('ordinary packet atomically freezes funds and credits only the selected friend', (t) => {
  const { ledger, filename } = fixture(t);
  const packet = ordinary(ledger);
  assert.equal(packet.expiresAt - packet.createdAt, PACKET_LIFETIME_MS);
  assert.deepEqual(ledger.getBalance('alice'), { userId: 'alice', available: '900', frozen: '100' });
  expectCode(() => ledger.claim({ packetId: packet.packetId, userId: 'outsider', idempotencyKey: 'outside' }), 'NOT_ELIGIBLE');
  const receipt = ledger.claim({ packetId: packet.packetId, userId: 'bob', idempotencyKey: 'claim' });
  assert.equal(receipt.amount, '100');
  assert.equal(ledger.getBalance('bob').available, '100');
  assert.equal(ledger.getBalance('alice').frozen, '0');
  assert.equal(ledger.getPacket(packet.packetId).status, 'fully_claimed');
  expectCode(() => ledger.claim({ packetId: packet.packetId, userId: 'bob', idempotencyKey: 'again' }), 'ALREADY_CLAIMED');
  assertBalanced(filename);
});

test('group equal has a fixed member snapshot and fixed claim limit', (t) => {
  const { ledger, filename } = fixture(t);
  const packet = ordinary(ledger, { type: 'group_equal', recipientIds: ['alice', 'bob', 'carol', 'dave'], maxClaims: 3, total: '300' });
  const receipts = ['bob', 'carol', 'alice'].map((id) => ledger.claim({ packetId: packet.packetId, userId: id, idempotencyKey: `claim-${id}` }));
  assert.deepEqual(receipts.map((r) => r.amount), ['100', '100', '100']);
  expectCode(() => ledger.claim({ packetId: packet.packetId, userId: 'alice', idempotencyKey: 'sender-again' }), 'ALREADY_CLAIMED');
  expectCode(() => ledger.claim({ packetId: packet.packetId, userId: 'dave', idempotencyKey: 'late' }), 'PACKET_EMPTY');
  ledger.createAccount('new_member');
  expectCode(() => ledger.claim({ packetId: packet.packetId, userId: 'new_member', idempotencyKey: 'joined-later' }), 'NOT_ELIGIBLE');
  assert.equal(ledger.getBalance('alice').available, '800');
  assertBalanced(filename);
});

test('random group allocations preserve huge integer totals and minimum unit without revealing future shares', (t) => {
  const total = 10n ** 24n + 7n;
  const { ledger, filename } = fixture(t, total);
  const recipients = Array.from({ length: 20 }, (_, i) => `member_${i}`);
  recipients.forEach((id) => ledger.createAccount(id));
  const packet = ordinary(ledger, { type: 'group_random', recipientIds: recipients, maxClaims: 20, total });
  assert.equal(packet.allocations, undefined);
  assert.equal(ledger.getPacket(packet.packetId).allocations, undefined);
  sql(filename, (db) => {
    const shares = db.prepare('SELECT amount FROM allocations WHERE packet_id=?').all(packet.packetId).map((r) => BigInt(r.amount));
    assert.equal(shares.length, 20);
    assert.ok(shares.every((a) => a >= 1n));
    assert.equal(shares.reduce((a, b) => a + b, 0n), total);
  });
  const received = recipients.map((id) => BigInt(ledger.claim({ packetId: packet.packetId, userId: id, idempotencyKey: id }).amount));
  assert.equal(received.reduce((a, b) => a + b, 0n), total);
  assert.equal(ledger.getPacket(packet.packetId).remaining, '0');
  assertBalanced(filename);
});

test('random packet with one unit per share cannot allocate zero or lose units', (t) => {
  const { ledger, filename } = fixture(t, 3n);
  const packet = ordinary(ledger, { type: 'group_random', recipientIds: ['bob', 'carol', 'dave'], maxClaims: 3, total: '3' });
  for (const id of ['bob', 'carol', 'dave']) {
    assert.equal(ledger.claim({ packetId: packet.packetId, userId: id, idempotencyKey: id }).amount, '1');
  }
  assertBalanced(filename);
});

test('24-hour expiry blocks claims and refunds only unclaimed funds exactly once', (t) => {
  const { ledger, filename, setTime } = fixture(t);
  const packet = ordinary(ledger, { type: 'group_equal', recipientIds: ['bob', 'carol', 'dave'], maxClaims: 3, total: '99' });
  ledger.claim({ packetId: packet.packetId, userId: 'bob', idempotencyKey: 'claim' });
  setTime(packet.expiresAt - 1);
  expectCode(() => ledger.refundExpired({ packetId: packet.packetId, idempotencyKey: 'early' }), 'NOT_EXPIRED');
  assert.deepEqual(ledger.refundDue(), []);
  setTime(packet.expiresAt);
  expectCode(() => ledger.claim({ packetId: packet.packetId, userId: 'carol', idempotencyKey: 'expired' }), 'PACKET_EXPIRED');
  const [receipt] = ledger.refundDue();
  assert.equal(receipt.amount, '66');
  assert.equal(receipt.senderId, 'alice');
  assert.equal(ledger.getBalance('alice').available, '967');
  assert.equal(ledger.getBalance('alice').frozen, '0');
  assert.equal(ledger.getBalance('bob').available, '33');
  assert.deepEqual(ledger.refundDue(), []);
  assert.deepEqual(ledger.refundExpired({ packetId: packet.packetId, idempotencyKey: 'new-refund-key' }), receipt);
  assertBalanced(filename);
});

test('fully claimed packets retain their status and never enter expiry refunds', (t) => {
  const { ledger, filename, setTime } = fixture(t);
  const packet = ordinary(ledger);
  ledger.claim({ packetId: packet.packetId, userId: 'bob', idempotencyKey: 'claim' });
  const before = sql(filename, (db) => db.prepare('SELECT count(*) AS n FROM ledger_transactions').get().n);
  setTime(packet.expiresAt);
  assert.deepEqual(ledger.refundDue(), []);
  expectCode(() => ledger.refundExpired({ packetId: packet.packetId, idempotencyKey: 'cannot-refund-completed' }), 'PACKET_FULLY_CLAIMED');
  assert.equal(ledger.getPacket(packet.packetId).status, 'fully_claimed');
  assert.equal(ledger.getPacket(packet.packetId).refundedAmount, '0');
  sql(filename, (db) => {
    const row = db.prepare('SELECT refunded_at,refund_transaction_id FROM packets WHERE packet_id=?').get(packet.packetId);
    assert.equal(row.refunded_at, null);
    assert.equal(row.refund_transaction_id, null);
  });
  assert.equal(sql(filename, (db) => db.prepare('SELECT count(*) AS n FROM ledger_transactions').get().n), before);
  assertBalanced(filename);
});

test('create, claim and refund replay safely; conflicting use of an idempotency key fails', (t) => {
  const { ledger, filename, setTime } = fixture(t);
  const input = { type: 'group_equal', recipientIds: ['bob', 'carol'], maxClaims: 2, total: '200', idempotencyKey: 'same-create' };
  const packet = ordinary(ledger, input);
  assert.deepEqual(ordinary(ledger, { ...input, recipientIds: ['carol', 'bob'] }), packet);
  expectCode(() => ordinary(ledger, { ...input, total: '400' }), 'IDEMPOTENCY_CONFLICT');
  const request = { packetId: packet.packetId, userId: 'bob', idempotencyKey: 'same-claim' };
  const claim = ledger.claim(request);
  assert.deepEqual(ledger.claim(request), claim);
  setTime(packet.expiresAt);
  const refundRequest = { packetId: packet.packetId, idempotencyKey: 'same-refund' };
  const refund = ledger.refundExpired(refundRequest);
  assert.deepEqual(ledger.refundExpired(refundRequest), refund);
  assert.equal(ledger.getBalance('alice').available, '900');
  assert.equal(ledger.getBalance('bob').available, '100');
  assertBalanced(filename);
});

test('injected database failure rolls back balances, packets, postings and idempotency together', (t) => {
  const { ledger, filename } = fixture(t);
  sql(filename, (db) => db.exec("CREATE TRIGGER test_failure BEFORE INSERT ON postings WHEN NEW.side='credit' BEGIN SELECT RAISE(ABORT,'injected test failure'); END"));
  assert.throws(() => ordinary(ledger, { idempotencyKey: 'retry' }), /injected test failure/);
  assert.equal(ledger.getBalance('alice').available, '1000');
  assert.equal(ledger.getBalance('alice').frozen, '0');
  sql(filename, (db) => {
    assert.equal(db.prepare('SELECT count(*) AS n FROM packets').get().n, 0);
    assert.equal(db.prepare('SELECT count(*) AS n FROM idempotency').get().n, 0);
    db.exec('DROP TRIGGER test_failure');
  });
  const packet = ordinary(ledger, { idempotencyKey: 'retry' });
  sql(filename, (db) => db.exec("CREATE TRIGGER test_claim_failure BEFORE UPDATE OF balance ON accounts WHEN NEW.account_id='bob' BEGIN SELECT RAISE(ABORT,'injected claim failure'); END"));
  assert.throws(() => ledger.claim({ packetId: packet.packetId, userId: 'bob', idempotencyKey: 'claim-retry' }), /injected claim failure/);
  assert.equal(ledger.getPacket(packet.packetId).claimedCount, 0);
  assert.equal(ledger.getPacket(packet.packetId).remaining, '100');
  assert.equal(ledger.getBalance('bob').available, '0');
  sql(filename, (db) => db.exec('DROP TRIGGER test_claim_failure'));
  ledger.claim({ packetId: packet.packetId, userId: 'bob', idempotencyKey: 'claim-retry' });
  assertBalanced(filename);
});

test('invalid recipient snapshots, counts, amounts and keys leave no financial state', (t) => {
  const { ledger, filename } = fixture(t);
  for (const total of [0n, -1n, '0', '01', '1.5', 100, MAX_AMOUNT + 1n]) {
    expectCode(() => ordinary(ledger, { total }), 'INVALID_AMOUNT');
  }
  expectCode(() => ordinary(ledger, { recipientIds: [] }), 'INVALID_RECIPIENTS');
  expectCode(() => ordinary(ledger, { type: 'group_equal', recipientIds: ['bob', 'bob'] }), 'DUPLICATE_RECIPIENT');
  expectCode(() => ordinary(ledger, { recipientIds: ['bob', 'carol'] }), 'ORDINARY_REQUIRES_ONE_RECIPIENT');
  expectCode(() => ordinary(ledger, { recipientIds: ['alice'] }), 'ORDINARY_SELF_RECIPIENT');
  expectCode(() => ordinary(ledger, { recipientIds: ['missing'] }), 'UNKNOWN_ACCOUNT');
  expectCode(() => ordinary(ledger, { type: 'group_equal', recipientIds: ['bob', 'carol'], maxClaims: 3 }), 'INVALID_CLAIM_COUNT');
  expectCode(() => ordinary(ledger, { type: 'group_equal', recipientIds: ['bob', 'carol'], maxClaims: 2, total: '101' }), 'EQUAL_AMOUNT_NOT_DIVISIBLE');
  expectCode(() => ordinary(ledger, { type: 'group_random', recipientIds: ['bob', 'carol'], maxClaims: 2, total: '1' }), 'AMOUNT_BELOW_MINIMUM');
  expectCode(() => ordinary(ledger, { idempotencyKey: '' }), 'INVALID_IDEMPOTENCY_KEY');
  expectCode(() => ledger.createAccount('@packet:collision'), 'INVALID_USER_ID');
  assert.equal(ledger.getBalance('alice').available, '1000');
  assert.equal(sql(filename, (db) => db.prepare('SELECT count(*) AS n FROM packets').get().n), 0);
  assertBalanced(filename);
});

test('recipient snapshots accept 100 members and reject 101', (t) => {
  const { ledger, filename } = fixture(t);
  const members = Array.from({ length: 101 }, (_, i) => `member${i}`);
  members.forEach((id) => ledger.createAccount(id));
  expectCode(() => ordinary(ledger, { type: 'group_equal', recipientIds: members, maxClaims: 100 }), 'INVALID_RECIPIENTS');
  const packet = ordinary(ledger, { type: 'group_equal', recipientIds: members.slice(0, 100), maxClaims: 100 });
  assert.equal(packet.maxClaims, 100);
  assert.equal(packet.remaining, '100');
  assertBalanced(filename);
});

test('parallel workers racing the final share produce one credit and no overdraft', async (t) => {
  const { ledger, filename } = fixture(t);
  const members = ['bob', 'carol', 'dave', 'outsider'];
  const packet = ordinary(ledger, { type: 'group_random', recipientIds: members, maxClaims: 1 });
  const results = await simultaneousClaims(filename, members.map((userId) => ({ packetId: packet.packetId, userId, idempotencyKey: userId })));
  assert.equal(results.filter((r) => r.ok).length, 1);
  assert.ok(results.filter((r) => !r.ok).every((r) => r.code === 'PACKET_EMPTY'), JSON.stringify(results));
  assert.equal(members.reduce((sum, id) => sum + BigInt(ledger.getBalance(id).available), 0n), 100n);
  assert.equal(ledger.getPacket(packet.packetId).claimedCount, 1);
  assertBalanced(filename);
});

test('parallel retries of the same claim return one shared receipt and one credit', async (t) => {
  const { ledger, filename } = fixture(t);
  const packet = ordinary(ledger);
  const request = { packetId: packet.packetId, userId: 'bob', idempotencyKey: 'same-concurrent-key' };
  const results = await simultaneousClaims(filename, [request, request]);
  assert.ok(results.every((r) => r.ok), JSON.stringify(results));
  assert.deepEqual(results[0].result, results[1].result);
  assert.equal(ledger.getBalance('bob').available, '100');
  assert.equal(ledger.getPacket(packet.packetId).claimedCount, 1);
  assertBalanced(filename);
});

test('database state survives reopening and different packets remain isolated', (t) => {
  const { ledger, filename, setTime } = fixture(t);
  const first = ordinary(ledger, { total: '100' });
  const second = ordinary(ledger, { recipientIds: ['carol'], total: '200' });
  const other = new CustodyLedger({ filename, now: () => BASE_TIME });
  try {
    assert.equal(other.getBalance('alice').frozen, '300');
    other.claim({ packetId: first.packetId, userId: 'bob', idempotencyKey: 'other-connection' });
  } finally { other.close(); }
  assert.equal(ledger.getPacket(second.packetId).remaining, '200');
  setTime(second.expiresAt);
  ledger.refundDue();
  assert.equal(ledger.getBalance('alice').available, '900');
  assert.equal(ledger.getBalance('bob').available, '100');
  assertBalanced(filename);
});
