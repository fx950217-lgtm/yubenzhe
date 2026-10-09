import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes, randomUUID } from 'node:crypto';

// Transactional development foundation. No deposits, withdrawals, HTTP or real funds.
export const PACKET_LIFETIME_MS = 24 * 60 * 60 * 1000;
export const MAX_RECIPIENTS = 100;
export const MAX_AMOUNT = 10n ** 30n;

export class LedgerError extends Error {
  constructor(code, message = code) { super(message); this.name = 'LedgerError'; this.code = code; }
}
const fail = (code) => { throw new LedgerError(code); };
const userId = (value) => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value)) fail('INVALID_USER_ID');
  return value;
};
const amount = (value) => {
  if (typeof value !== 'bigint' && (typeof value !== 'string' || value.length > 31 || !/^[1-9][0-9]*$/.test(value))) fail('INVALID_AMOUNT');
  const parsed = BigInt(value);
  if (parsed <= 0n || parsed > MAX_AMOUNT) fail('INVALID_AMOUNT');
  return parsed;
};
const randomBelow = (limit) => {
  const bytes = Math.ceil(limit.toString(2).length / 8);
  const space = 1n << BigInt(bytes * 8);
  const cutoff = space - (space % limit);
  let draw;
  do { draw = BigInt(`0x${randomBytes(bytes).toString('hex')}`); } while (draw >= cutoff);
  return draw % limit;
};
const allocate = (total, count, type) => {
  if (type !== 'group_random') return Array(count).fill(total / BigInt(count));
  const shares = [];
  let remaining = total;
  for (let left = count; left > 1; left--) {
    const reserveBound = remaining - BigInt(left - 1);
    const doubleMean = remaining * 2n / BigInt(left);
    const upper = reserveBound < doubleMean ? reserveBound : doubleMean;
    const share = 1n + randomBelow(upper);
    shares.push(share);
    remaining -= share;
  }
  shares.push(remaining);
  return shares;
};

const schema = `
  CREATE TABLE IF NOT EXISTS accounts (
    account_id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK(kind IN ('user','escrow','asset')),
    normal_side TEXT NOT NULL CHECK(normal_side IN ('debit','credit')),
    balance TEXT NOT NULL CHECK(length(balance)>0 AND balance NOT GLOB '*[^0-9]*'
      AND (balance='0' OR substr(balance,1,1)<>'0')),
    CHECK((kind='asset' AND normal_side='debit') OR (kind IN ('user','escrow') AND normal_side='credit'))
  );
  CREATE TABLE IF NOT EXISTS ledger_transactions (
    transaction_id TEXT PRIMARY KEY, operation TEXT NOT NULL,
    packet_id TEXT, created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS postings (
    transaction_id TEXT NOT NULL REFERENCES ledger_transactions(transaction_id),
    account_id TEXT NOT NULL REFERENCES accounts(account_id),
    side TEXT NOT NULL CHECK(side IN ('debit','credit')),
    amount TEXT NOT NULL CHECK(length(amount)>0 AND amount NOT GLOB '*[^0-9]*' AND substr(amount,1,1)<>'0'),
    PRIMARY KEY(transaction_id, account_id, side)
  );
  CREATE TABLE IF NOT EXISTS packets (
    packet_id TEXT PRIMARY KEY, sender_id TEXT NOT NULL REFERENCES accounts(account_id),
    escrow_id TEXT NOT NULL UNIQUE REFERENCES accounts(account_id),
    type TEXT NOT NULL CHECK(type IN ('ordinary','group_equal','group_random')),
    total TEXT NOT NULL, max_claims INTEGER NOT NULL CHECK(max_claims BETWEEN 1 AND 100),
    claimed_count INTEGER NOT NULL DEFAULT 0 CHECK(claimed_count BETWEEN 0 AND max_claims),
    created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','fully_claimed','refunded')),
    refunded_amount TEXT NOT NULL DEFAULT '0', refund_transaction_id TEXT,
    refunded_at INTEGER, CHECK(expires_at=created_at+86400000)
  );
  CREATE TABLE IF NOT EXISTS packet_recipients (
    packet_id TEXT NOT NULL REFERENCES packets(packet_id),
    user_id TEXT NOT NULL REFERENCES accounts(account_id), PRIMARY KEY(packet_id,user_id)
  );
  CREATE TABLE IF NOT EXISTS allocations (
    packet_id TEXT NOT NULL REFERENCES packets(packet_id),
    claim_index INTEGER NOT NULL, amount TEXT NOT NULL, PRIMARY KEY(packet_id,claim_index)
  );
  CREATE TABLE IF NOT EXISTS claims (
    packet_id TEXT NOT NULL REFERENCES packets(packet_id), user_id TEXT NOT NULL REFERENCES accounts(account_id),
    claim_index INTEGER NOT NULL, amount TEXT NOT NULL,
    transaction_id TEXT NOT NULL UNIQUE REFERENCES ledger_transactions(transaction_id), claimed_at INTEGER NOT NULL,
    PRIMARY KEY(packet_id,user_id), UNIQUE(packet_id,claim_index)
  );
  CREATE TABLE IF NOT EXISTS idempotency (
    actor_id TEXT NOT NULL, idempotency_key TEXT NOT NULL,
    operation TEXT NOT NULL, fingerprint TEXT NOT NULL, response_json TEXT NOT NULL,
    PRIMARY KEY(actor_id,idempotency_key)
  );
  CREATE INDEX IF NOT EXISTS packets_due ON packets(expires_at,status);
  CREATE INDEX IF NOT EXISTS packets_by_sender ON packets(sender_id);
`;

export class CustodyLedger {
  #db;
  #clock;

  constructor({ filename, now = Date.now } = {}) {
    if (typeof filename !== 'string' || !filename) fail('DATABASE_PATH_REQUIRED');
    if (typeof now !== 'function') fail('INVALID_CLOCK');
    this.#clock = now;
    this.#db = new DatabaseSync(filename);
    this.#db.exec('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
    this.#db.exec(schema);
  }

  close() { this.#db.close(); }

  createAccount(id) {
    userId(id);
    this.#db.prepare("INSERT OR IGNORE INTO accounts(account_id,kind,normal_side,balance) VALUES (?,'user','credit','0')").run(id);
    return this.getBalance(id);
  }

  getBalance(id) {
    userId(id);
    const rows = this.#db.prepare(`
      SELECT a.balance AS available, e.balance AS frozen FROM accounts a
      LEFT JOIN packets p ON p.sender_id=a.account_id
      LEFT JOIN accounts e ON e.account_id=p.escrow_id
      WHERE a.account_id=? AND a.kind='user'
    `).all(id);
    if (!rows.length) fail('UNKNOWN_ACCOUNT');
    return { userId: id, available: rows[0].available,
      frozen: rows.reduce((sum, row) => sum + BigInt(row.frozen ?? '0'), 0n).toString() };
  }

  getPacket(packetId) {
    const packet = this.#packet(packetId);
    return {
      packetId: packet.packet_id, senderId: packet.sender_id, type: packet.type,
      total: packet.total, maxClaims: packet.max_claims, claimedCount: packet.claimed_count,
      remaining: packet.remaining, createdAt: packet.created_at, expiresAt: packet.expires_at,
      status: packet.status, refundedAmount: packet.refunded_amount,
    };
  }

  createPacket({ senderId, type = 'ordinary', recipientIds, total, maxClaims = 1, idempotencyKey }) {
    userId(senderId);
    const value = amount(total);
    if (!['ordinary', 'group_equal', 'group_random'].includes(type)) fail('INVALID_PACKET_TYPE');
    if (!Array.isArray(recipientIds) || recipientIds.length < 1 || recipientIds.length > MAX_RECIPIENTS) fail('INVALID_RECIPIENTS');
    const recipients = recipientIds.map(userId).sort();
    if (new Set(recipients).size !== recipients.length) fail('DUPLICATE_RECIPIENT');
    if (!Number.isInteger(maxClaims) || maxClaims < 1 || maxClaims > recipients.length) fail('INVALID_CLAIM_COUNT');
    if (type === 'ordinary' && (recipients.length !== 1 || maxClaims !== 1)) fail('ORDINARY_REQUIRES_ONE_RECIPIENT');
    if (type === 'ordinary' && recipients[0] === senderId) fail('ORDINARY_SELF_RECIPIENT');
    if (value < BigInt(maxClaims)) fail('AMOUNT_BELOW_MINIMUM');
    if (type !== 'group_random' && value % BigInt(maxClaims) !== 0n) fail('EQUAL_AMOUNT_NOT_DIVISIBLE');
    return this.#mutate(senderId, idempotencyKey, 'create', {
      senderId, type, recipients, total: value.toString(), maxClaims,
    }, (now) => {
      this.#user(senderId);
      for (const recipient of recipients) this.#user(recipient);
      const packetId = randomUUID();
      const escrowId = `@packet:${packetId}`;
      this.#db.prepare("INSERT INTO accounts(account_id,kind,normal_side,balance) VALUES (?,'escrow','credit','0')").run(escrowId);
      this.#db.prepare(`INSERT INTO packets(packet_id,sender_id,escrow_id,type,total,max_claims,created_at,expires_at)
        VALUES (?,?,?,?,?,?,?,?)`).run(packetId, senderId, escrowId, type, value.toString(), maxClaims, now, now + PACKET_LIFETIME_MS);
      for (const recipient of recipients) {
        this.#db.prepare('INSERT INTO packet_recipients(packet_id,user_id) VALUES (?,?)').run(packetId, recipient);
      }
      allocate(value, maxClaims, type).forEach((share, i) => {
        this.#db.prepare('INSERT INTO allocations(packet_id,claim_index,amount) VALUES (?,?,?)').run(packetId, i, share.toString());
      });
      const transactionId = this.#transfer(senderId, escrowId, value, 'packet_freeze', packetId, now);
      return { ...this.getPacket(packetId), transactionId };
    });
  }

  claim({ packetId, userId: claimant, idempotencyKey }) {
    userId(claimant);
    return this.#mutate(claimant, idempotencyKey, 'claim', { packetId, userId: claimant }, (now) => {
      const packet = this.#packet(packetId);
      if (!this.#db.prepare('SELECT 1 FROM packet_recipients WHERE packet_id=? AND user_id=?').get(packetId, claimant)) fail('NOT_ELIGIBLE');
      if (this.#db.prepare('SELECT 1 FROM claims WHERE packet_id=? AND user_id=?').get(packetId, claimant)) fail('ALREADY_CLAIMED');
      if (now >= packet.expires_at || packet.status === 'refunded') fail('PACKET_EXPIRED');
      if (packet.claimed_count >= packet.max_claims) fail('PACKET_EMPTY');
      const index = packet.claimed_count;
      const share = BigInt(this.#db.prepare('SELECT amount FROM allocations WHERE packet_id=? AND claim_index=?').get(packetId, index).amount);
      const transactionId = this.#transfer(packet.escrow_id, claimant, share, 'packet_claim', packetId, now);
      this.#db.prepare('INSERT INTO claims(packet_id,user_id,claim_index,amount,transaction_id,claimed_at) VALUES (?,?,?,?,?,?)')
        .run(packetId, claimant, index, share.toString(), transactionId, now);
      const status = index + 1 === packet.max_claims ? 'fully_claimed' : 'open';
      this.#db.prepare('UPDATE packets SET claimed_count=claimed_count+1,status=? WHERE packet_id=?').run(status, packetId);
      return { packetId, userId: claimant, amount: share.toString(), transactionId, claimedAt: now };
    });
  }

  // Trusted background worker API. Destination is always the original sender.
  refundExpired({ packetId, idempotencyKey }) {
    return this.#mutate('@expiry-worker', idempotencyKey, 'refund', { packetId }, (now) => {
      const packet = this.#packet(packetId);
      if (packet.status === 'fully_claimed') fail('PACKET_FULLY_CLAIMED');
      if (now < packet.expires_at) fail('NOT_EXPIRED');
      if (packet.status === 'refunded') return this.#refundReceipt(packet);
      const value = BigInt(packet.remaining);
      const transactionId = value > 0n
        ? this.#transfer(packet.escrow_id, packet.sender_id, value, 'packet_refund', packetId, now) : null;
      this.#db.prepare("UPDATE packets SET status='refunded',refunded_amount=?,refund_transaction_id=?,refunded_at=? WHERE packet_id=?")
        .run(value.toString(), transactionId, now, packetId);
      return this.#refundReceipt(this.#packet(packetId));
    });
  }

  // A production scheduler must call this. No daemon or scheduling is installed here.
  refundDue({ limit = 100 } = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) fail('INVALID_BATCH_LIMIT');
    const due = this.#db.prepare("SELECT packet_id FROM packets WHERE expires_at<=? AND status='open' ORDER BY expires_at,packet_id LIMIT ?")
      .all(this.#now(), limit);
    return due.map(({ packet_id }) => this.refundExpired({ packetId: packet_id, idempotencyKey: `expiry:${packet_id}` }));
  }

  #now() {
    const now = this.#clock();
    if (!Number.isSafeInteger(now) || now < 0 || now > Number.MAX_SAFE_INTEGER - PACKET_LIFETIME_MS) fail('INVALID_CLOCK');
    return now;
  }

  #user(id) {
    const row = this.#db.prepare("SELECT * FROM accounts WHERE account_id=? AND kind='user'").get(id);
    if (!row) fail('UNKNOWN_ACCOUNT');
    return row;
  }

  #packet(id) {
    if (typeof id !== 'string' || !id || id.length > 100) fail('INVALID_PACKET_ID');
    const row = this.#db.prepare('SELECT p.*, a.balance AS remaining FROM packets p JOIN accounts a ON p.escrow_id=a.account_id WHERE p.packet_id=?').get(id);
    if (!row) fail('UNKNOWN_PACKET');
    return row;
  }

  #refundReceipt(packet) {
    return { packetId: packet.packet_id, senderId: packet.sender_id, amount: packet.refunded_amount,
      transactionId: packet.refund_transaction_id, refundedAt: packet.refunded_at };
  }

  #mutate(actor, key, operation, payload, fn) {
    if (typeof key !== 'string' || !/^[\x21-\x7E]{1,128}$/.test(key)) fail('INVALID_IDEMPOTENCY_KEY');
    const fingerprint = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    this.#db.exec('BEGIN IMMEDIATE');
    try {
      const existing = this.#db.prepare('SELECT * FROM idempotency WHERE actor_id=? AND idempotency_key=?').get(actor, key);
      if (existing) {
        if (existing.operation !== operation || existing.fingerprint !== fingerprint) fail('IDEMPOTENCY_CONFLICT');
        this.#db.exec('COMMIT');
        return JSON.parse(existing.response_json);
      }
      const result = fn(this.#now());
      this.#db.prepare('INSERT INTO idempotency(actor_id,idempotency_key,operation,fingerprint,response_json) VALUES (?,?,?,?,?)')
        .run(actor, key, operation, fingerprint, JSON.stringify(result));
      this.#db.exec('COMMIT');
      return result;
    } catch (error) {
      this.#db.exec('ROLLBACK');
      throw error;
    }
  }

  #transfer(from, to, value, operation, packetId, now) {
    if (from === to || value <= 0n) fail('INVALID_TRANSFER');
    const debit = this.#db.prepare("SELECT balance FROM accounts WHERE account_id=? AND normal_side='credit'").get(from);
    const credit = this.#db.prepare("SELECT balance FROM accounts WHERE account_id=? AND normal_side='credit'").get(to);
    if (!debit || !credit) fail('UNKNOWN_ACCOUNT');
    const fromBalance = BigInt(debit.balance);
    const toBalance = BigInt(credit.balance);
    if (fromBalance < value) fail('INSUFFICIENT_BALANCE');
    const transactionId = randomUUID();
    this.#db.prepare('INSERT INTO ledger_transactions(transaction_id,operation,packet_id,created_at) VALUES (?,?,?,?)')
      .run(transactionId, operation, packetId, now);
    this.#db.prepare('UPDATE accounts SET balance=? WHERE account_id=?').run((fromBalance - value).toString(), from);
    this.#db.prepare('UPDATE accounts SET balance=? WHERE account_id=?').run((toBalance + value).toString(), to);
    this.#db.prepare("INSERT INTO postings(transaction_id,account_id,side,amount) VALUES (?,?,'debit',?)")
      .run(transactionId, from, value.toString());
    this.#db.prepare("INSERT INTO postings(transaction_id,account_id,side,amount) VALUES (?,?,'credit',?)")
      .run(transactionId, to, value.toString());
    return transactionId;
  }
}
