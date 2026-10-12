-- Additive only: legacy pairing, owners, control leases and task history remain intact.
ALTER TABLE personal_devices ADD COLUMN source TEXT NOT NULL DEFAULT 'local' CHECK(source IN('local','cloud','server'));
ALTER TABLE personal_devices ADD COLUMN capabilities TEXT NOT NULL DEFAULT '{}';
ALTER TABLE personal_devices ADD COLUMN capabilities_at INTEGER;

-- Unowned machines cannot create product accounts or personal_devices rows.
-- Pair codes, polling credentials and delivered long-lived tokens are NEVER stored in plaintext.
CREATE TABLE device_pair_claims(
 id TEXT PRIMARY KEY,
 pair_hash TEXT UNIQUE,
 poll_hash TEXT NOT NULL,
 name TEXT NOT NULL,
 source TEXT NOT NULL CHECK(source IN('local','cloud','server')),
 capabilities TEXT NOT NULL DEFAULT '{}',
 created_at INTEGER NOT NULL,
 pair_expires INTEGER NOT NULL,
 delivery_expires INTEGER,
 device_id TEXT UNIQUE REFERENCES personal_devices(id) ON DELETE CASCADE,
 claimed_at INTEGER
);
CREATE INDEX device_pair_claims_expiry ON device_pair_claims(pair_expires,delivery_expires);

-- At most 2,048 active buckets, at most 1,000 pending claims; enforced by service.
-- Only SHA-256 bucket identifiers, counters and cooldown timestamps are retained.
CREATE TABLE device_pair_rates(
 bucket_hash TEXT PRIMARY KEY,
 started_at INTEGER NOT NULL,
 attempts INTEGER NOT NULL DEFAULT 0,
 failures INTEGER NOT NULL DEFAULT 0,
 blocked_until INTEGER NOT NULL DEFAULT 0
);
