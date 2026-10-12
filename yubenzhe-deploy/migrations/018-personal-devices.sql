
CREATE TABLE personal_devices(
 id TEXT PRIMARY KEY,
 owner_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
 name TEXT NOT NULL,
 pair_hash TEXT UNIQUE,
 pair_expires INTEGER NOT NULL,
 token_hash TEXT UNIQUE,
 created_at INTEGER NOT NULL,
 last_seen INTEGER,
 revoked_at INTEGER,
 session_id TEXT,
 session_until INTEGER,
 agent_status TEXT NOT NULL DEFAULT ''
);
CREATE INDEX personal_devices_owner ON personal_devices(owner_id);
CREATE TABLE personal_device_commands(
 id TEXT PRIMARY KEY,
 device_id TEXT NOT NULL REFERENCES personal_devices(id) ON DELETE CASCADE,
 session_id TEXT NOT NULL,
 request_id TEXT NOT NULL,
 -- SHA-256 only. Typed text and pointer payloads stay in process memory.
 payload TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN('queued','sent','done','failed','expired')),
 created_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL,
 UNIQUE(device_id,request_id)
);
