import { DatabaseSync } from 'node:sqlite';
import { openSync, closeSync, chmodSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { sponsorshipAddress, sponsorshipInteger, sponsorshipError } from './sponsorship-policy.mjs';

const APP_ID = 0x59425a53;
const HOLD = new Set(['reserved', 'requesting', 'authorized', 'unknown']);
const TABLES = ['sponsorship_journal_meta', 'sponsorship_policies', 'sponsorship_reservations', 'sponsorship_alerts'];
function check(ok, code = 'SPONSORSHIP_JOURNAL_INVALID') { if (!ok) throw sponsorshipError(code, '本地赞助记录校验失败，未授权任何链上操作。'); }
const hash = value => typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value);
const id = value => typeof value === 'string' && /^[A-Za-z0-9:_-]{1,128}$/.test(value);
function period(time) { const iso = new Date(time).toISOString(); return { day: iso.slice(0, 10), month: iso.slice(0, 7) }; }
function publicRow(row) {
  if (!row) return null;
  return Object.freeze({ id: row.id, ownerId: row.owner_id, requestId: row.request_id, fingerprint: row.fingerprint, policyId: row.policy_id, chainId: row.chain_id, entryPoint: row.entry_point, sender: row.sender, nonce: row.nonce, action: row.action, sessionId: row.session_id, state: row.state, reservedWei: row.reserved_wei, actualCostWei: row.actual_cost_wei, userOpHash: row.user_op_hash, transactionHash: row.transaction_hash, blockHash: row.block_hash, paymaster: row.paymaster, createdAt: row.created_at, updatedAt: row.updated_at, simulation: true });
}

/** Independent platform-cost journal. This is never attached to a social DB.
 * Creation uses exclusive wx; reopening refuses foreign SQLite files BEFORE
 * enabling WAL or running any writes. No table migration number is consumed.
 */
export function openSponsorshipJournal({ filename, create = false, mode, now = Date.now } = {}) {
  check(mode === 'local-harness' && typeof filename === 'string' && filename && filename !== ':memory:' && typeof now === 'function');
  const path = resolve(filename);
  if (create) { const descriptor = openSync(path, 'wx', 0o600); closeSync(descriptor); }
  else {
    const reader = new DatabaseSync(path, { readOnly: true });
    try {
      check(reader.prepare('PRAGMA application_id').get().application_id === APP_ID);
      const names = reader.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(row => row.name);
      check(names.length === TABLES.length && names.every(name => TABLES.includes(name)));
      check(reader.prepare('SELECT schema_version FROM sponsorship_journal_meta WHERE id=1').get()?.schema_version === 1);
    } finally { reader.close(); }
  }
  const raw = new DatabaseSync(path, { timeout: 5000 });
  try {
    raw.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    if (create) raw.exec(`BEGIN IMMEDIATE;
      PRAGMA application_id=${APP_ID};
      CREATE TABLE sponsorship_journal_meta(id INTEGER PRIMARY KEY CHECK(id=1),schema_version INTEGER NOT NULL,clock_ms INTEGER NOT NULL,paused INTEGER NOT NULL CHECK(paused IN(0,1)));
      INSERT INTO sponsorship_journal_meta VALUES(1,1,0,0);
      CREATE TABLE sponsorship_policies(id TEXT PRIMARY KEY,policy_hash TEXT NOT NULL);
      CREATE TABLE sponsorship_reservations(
        id TEXT PRIMARY KEY, owner_id TEXT NOT NULL UNIQUE, request_id TEXT NOT NULL, fingerprint TEXT NOT NULL,
        policy_id TEXT NOT NULL REFERENCES sponsorship_policies(id), chain_id INTEGER NOT NULL,entry_point TEXT NOT NULL,
        sender TEXT NOT NULL UNIQUE,nonce TEXT NOT NULL,action TEXT NOT NULL CHECK(action IN('create','first-entry')),
        session_id TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN('reserved','requesting','authorized','unknown','confirmed','failed')),
        reserved_wei TEXT NOT NULL,actual_cost_wei TEXT,user_op_hash TEXT UNIQUE,transaction_hash TEXT,block_hash TEXT,paymaster TEXT NOT NULL,
        created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,day TEXT NOT NULL,month TEXT NOT NULL,
        UNIQUE(owner_id,request_id),UNIQUE(chain_id,entry_point,sender,nonce)
      );
      CREATE TABLE sponsorship_alerts(scope TEXT NOT NULL,period TEXT NOT NULL,threshold INTEGER NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(scope,period,threshold));
      COMMIT;`);
    chmodSync(path, 0o600);
  } catch (error) { raw.close(); throw error; }
  function time() { const value = now(); check(Number.isSafeInteger(value) && value >= 0 && value <= 8640000000000000); return Math.max(value, raw.prepare('SELECT clock_ms FROM sponsorship_journal_meta WHERE id=1').get().clock_ms); }
  function transaction(callback) {
    raw.exec('BEGIN IMMEDIATE');
    try { const timestamp = time(); raw.prepare('UPDATE sponsorship_journal_meta SET clock_ms=? WHERE id=1').run(timestamp); const result = callback(timestamp); raw.exec('COMMIT'); return result; }
    catch (error) { raw.exec('ROLLBACK'); throw error; }
  }
  const byId = value => raw.prepare('SELECT * FROM sponsorship_reservations WHERE id=?').get(value);
  function used(rows, scope, currentPeriod) { return rows.reduce((sum, row) => sum + (HOLD.has(row.state) ? BigInt(row.reserved_wei) : row[scope] === currentPeriod ? BigInt(row.actual_cost_wei || '0') : 0n), 0n); }
  function budgetView(rows, at, ownerId, sessionId) {
    const p = period(at);
    return { month: used(rows, 'month', p.month), day: used(rows, 'day', p.day), user: used(rows.filter(row => row.owner_id === ownerId), 'day', p.day), session: rows.filter(row => row.session_id === sessionId).reduce((sum, row) => sum + BigInt(HOLD.has(row.state) ? row.reserved_wei : row.actual_cost_wei || '0'), 0n) };
  }
  function alerts(budget, at) {
    const rows = raw.prepare('SELECT * FROM sponsorship_reservations').all(), p = period(at), usage = budgetView(rows, at, '', '');
    const result = [];
    for (const [scope, key, cap] of [['month', p.month, budget.monthlyWei], ['day', p.day, budget.dailyWei]]) for (const threshold of [70, 90]) {
      if (usage[scope] * 100n < BigInt(cap) * BigInt(threshold)) continue;
      const inserted = raw.prepare('INSERT OR IGNORE INTO sponsorship_alerts VALUES(?,?,?,?)').run(scope, key, threshold, at);
      if (inserted.changes) result.push({ scope, period: key, threshold, usedWei: usage[scope].toString(), capWei: cap });
    }
    return result;
  }
  function reserve(decision, { requestId, fingerprint }) {
    check(id(decision.ownerId) && id(decision.sessionId) && id(requestId) && hash(fingerprint) && hash(decision.policyHash));
    check(id(decision.policyId) && Number.isSafeInteger(decision.chainId) && ['create', 'first-entry'].includes(decision.action));
    const sender = sponsorshipAddress(decision.sender), entryPoint = sponsorshipAddress(decision.entryPoint), paymaster = sponsorshipAddress(decision.paymaster);
    const amount = sponsorshipInteger(decision.reserveWei, { positive: true }), nonce = sponsorshipInteger(decision.nonce).toString(), budget = decision.budget;
    for (const key of ['monthlyWei', 'dailyWei', 'userDailyWei', 'sessionWei', 'singleWei']) sponsorshipInteger(budget[key], { positive: true });
    check(amount <= BigInt(budget.singleWei) && Number.isSafeInteger(budget.userHourly) && budget.userHourly > 0 && Number.isSafeInteger(budget.globalHourly) && budget.globalHourly > 0);
    return transaction(at => {
      const existing = raw.prepare('SELECT * FROM sponsorship_reservations WHERE owner_id=? AND request_id=?').get(decision.ownerId, requestId);
      if (existing) { check(existing.fingerprint === fingerprint, 'SPONSORSHIP_IDEMPOTENCY_CONFLICT'); return { created: false, record: publicRow(existing), alerts: [] }; }
      if (raw.prepare('SELECT paused FROM sponsorship_journal_meta WHERE id=1').get().paused) return { created: false, reason: 'SPONSORSHIP_PAUSED', alerts: [] };
      const policy = raw.prepare('SELECT policy_hash FROM sponsorship_policies WHERE id=?').get(decision.policyId);
      if (policy) check(policy.policy_hash === decision.policyHash, 'SPONSORSHIP_POLICY_CHANGED');
      // One onboarding cost per person OR sender across policy revisions/chains.
      // An unknown outcome never frees this entitlement, even after restart.
      const prior = raw.prepare('SELECT * FROM sponsorship_reservations WHERE owner_id=? OR sender=? OR (chain_id=? AND entry_point=? AND sender=? AND nonce=?) ORDER BY CASE WHEN state IN(\'reserved\',\'requesting\',\'authorized\',\'unknown\') THEN 0 ELSE 1 END LIMIT 1').get(decision.ownerId, sender, decision.chainId, entryPoint, sender, nonce);
      if (prior) return HOLD.has(prior.state) ? { created: false, hold: true, record: prior.owner_id === decision.ownerId ? publicRow(prior) : null, reason: 'SPONSORSHIP_PRIOR_UNKNOWN', alerts: [] } : { created: false, reason: 'SPONSORSHIP_ONCE_USED', alerts: [] };
      const rows = raw.prepare('SELECT * FROM sponsorship_reservations').all(), recent = rows.filter(row => row.created_at > at - 3600000);
      if (recent.length >= budget.globalHourly || recent.filter(row => row.owner_id === decision.ownerId).length >= budget.userHourly) return { created: false, reason: 'SPONSORSHIP_RATE_LIMIT', alerts: [] };
      const usage = budgetView(rows, at, decision.ownerId, decision.sessionId);
      if ([['month', 'monthlyWei'], ['day', 'dailyWei'], ['user', 'userDailyWei'], ['session', 'sessionWei']].some(([scope, key]) => usage[scope] + amount > BigInt(budget[key]))) return { created: false, reason: 'SPONSORSHIP_BUDGET_EXHAUSTED', alerts: [] };
      if (!policy) raw.prepare('INSERT INTO sponsorship_policies VALUES(?,?)').run(decision.policyId, decision.policyHash);
      const reservationId = randomUUID(), p = period(at);
      raw.prepare('INSERT INTO sponsorship_reservations(id,owner_id,request_id,fingerprint,policy_id,chain_id,entry_point,sender,nonce,action,session_id,state,reserved_wei,paymaster,created_at,updated_at,day,month) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(reservationId, decision.ownerId, requestId, fingerprint, decision.policyId, decision.chainId, entryPoint, sender, nonce, decision.action, decision.sessionId, 'reserved', amount.toString(), paymaster, at, at, p.day, p.month);
      return { created: true, record: publicRow(byId(reservationId)), alerts: alerts(budget, at) };
    });
  }
  function beginRequest(reservationId) {
    return transaction(at => { const row = byId(reservationId); check(row?.state === 'reserved', 'SPONSORSHIP_STATE_CONFLICT'); check(!raw.prepare('SELECT paused FROM sponsorship_journal_meta WHERE id=1').get().paused, 'SPONSORSHIP_PAUSED'); raw.prepare("UPDATE sponsorship_reservations SET state='requesting',updated_at=? WHERE id=?").run(at, reservationId); return publicRow(byId(reservationId)); });
  }
  function authorized(reservationId, userOpHash) {
    check(hash(userOpHash));
    return transaction(at => { check(byId(reservationId)?.state === 'requesting', 'SPONSORSHIP_STATE_CONFLICT'); check(!raw.prepare('SELECT paused FROM sponsorship_journal_meta WHERE id=1').get().paused, 'SPONSORSHIP_PAUSED'); raw.prepare("UPDATE sponsorship_reservations SET state='authorized',user_op_hash=?,updated_at=? WHERE id=?").run(userOpHash, at, reservationId); return publicRow(byId(reservationId)); });
  }
  function markUnknown(reservationId) {
    return transaction(at => {
      const row = byId(reservationId); check(row, 'SPONSORSHIP_STATE_CONFLICT');
      // A competing process may settle after our receipt read. Inspect the
      // terminal state under the same writer lock as this transition.
      if (['confirmed', 'failed'].includes(row.state)) return publicRow(row);
      check(HOLD.has(row.state), 'SPONSORSHIP_STATE_CONFLICT');
      raw.prepare("UPDATE sponsorship_reservations SET state='unknown',updated_at=? WHERE id=?").run(at, reservationId);
      return publicRow(byId(reservationId));
    });
  }
  function settle(reservationId, receipt) {
    return transaction(at => {
      const row = byId(reservationId); check(row && row.user_op_hash, 'SPONSORSHIP_STATE_CONFLICT');
      const cost = sponsorshipInteger(receipt.actualGasCost), state = receipt.success === true ? 'confirmed' : 'failed';
      check(receipt.simulation === true && typeof receipt.success === 'boolean' && receipt.chainId === row.chain_id && sponsorshipAddress(receipt.entryPoint) === row.entry_point && sponsorshipAddress(receipt.sender) === row.sender && sponsorshipAddress(receipt.paymaster) === row.paymaster && sponsorshipInteger(receipt.nonce).toString() === row.nonce && receipt.userOpHash === row.user_op_hash && hash(receipt.transactionHash) && hash(receipt.blockHash) && receipt.blockHash === receipt.canonicalBlockHash && Number.isSafeInteger(receipt.confirmations) && receipt.confirmations >= 3, 'SPONSORSHIP_RECEIPT_MISMATCH');
      check(cost <= BigInt(row.reserved_wei), 'SPONSORSHIP_COST_EXCEEDED');
      if (!HOLD.has(row.state)) { check(row.state === state && row.actual_cost_wei === cost.toString() && row.transaction_hash === receipt.transactionHash && row.block_hash === receipt.blockHash, 'SPONSORSHIP_RECEIPT_CONFLICT'); return publicRow(row); }
      const p = period(at);
      raw.prepare('UPDATE sponsorship_reservations SET state=?,actual_cost_wei=?,transaction_hash=?,block_hash=?,updated_at=?,day=?,month=? WHERE id=?').run(state, cost.toString(), receipt.transactionHash, receipt.blockHash, at, p.day, p.month, reservationId);
      return publicRow(byId(reservationId));
    });
  }
  return Object.freeze({
    reserve, beginRequest, authorized, markUnknown, settle,
    get: reservationId => publicRow(byId(reservationId)),
    find: (ownerId, requestId) => publicRow(raw.prepare('SELECT * FROM sponsorship_reservations WHERE owner_id=? AND request_id=?').get(ownerId, requestId)),
    findOpen: (ownerId, sender) => publicRow(raw.prepare("SELECT * FROM sponsorship_reservations WHERE (owner_id=? OR sender=?) AND state IN('reserved','requesting','authorized','unknown') LIMIT 1").get(ownerId, sponsorshipAddress(sender))),
    isPaused: () => Boolean(raw.prepare('SELECT paused FROM sponsorship_journal_meta WHERE id=1').get().paused),
    setPaused(value) { check(typeof value === 'boolean'); return transaction(() => { raw.prepare('UPDATE sponsorship_journal_meta SET paused=? WHERE id=1').run(value ? 1 : 0); return { paused: value }; }); },
    stats() { const rows = raw.prepare('SELECT * FROM sponsorship_reservations').all(), usage = budgetView(rows, time(), '', ''); return { monthCommittedWei: usage.month.toString(), dayCommittedWei: usage.day.toString(), heldWei: rows.filter(row => HOLD.has(row.state)).reduce((sum, row) => sum + BigInt(row.reserved_wei), 0n).toString(), actualCostWei: rows.reduce((sum, row) => sum + BigInt(row.actual_cost_wei || '0'), 0n).toString(), reservations: rows.length, alerts: raw.prepare('SELECT * FROM sponsorship_alerts ORDER BY created_at,threshold').all().map(row => ({ ...row })), simulation: true }; },
    close() { raw.close(); },
  });
}
