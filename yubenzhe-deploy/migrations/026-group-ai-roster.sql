-- AI roster metadata is separate from real accounts and group membership.
ALTER TABLE conversations ADD COLUMN ai_roster_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE conversations ADD COLUMN ai_owner_revision INTEGER NOT NULL DEFAULT 0;
CREATE TABLE conversation_ai_roster (
 id TEXT PRIMARY KEY,
 conversation_id TEXT NOT NULL REFERENCES conversations(id),
 owner_id TEXT NOT NULL REFERENCES accounts(id),
 device_id TEXT REFERENCES personal_devices(id) ON DELETE SET NULL,
 provider TEXT NOT NULL,
 alias TEXT NOT NULL CHECK(length(alias) BETWEEN 1 AND 40),
 position INTEGER NOT NULL DEFAULT 0,
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, removed_at INTEGER,
 UNIQUE(conversation_id,device_id,provider)
);
CREATE TABLE conversation_ai_roster_commands (
 owner_id TEXT NOT NULL REFERENCES accounts(id), request_id TEXT NOT NULL,
 conversation_id TEXT NOT NULL REFERENCES conversations(id), digest TEXT NOT NULL,
 created_at INTEGER NOT NULL, PRIMARY KEY(owner_id,request_id)
);
ALTER TABLE device_ai_sessions ADD COLUMN roster_ids TEXT NOT NULL DEFAULT '[]';
ALTER TABLE device_ai_sessions ADD COLUMN owner_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE device_ai_rounds ADD COLUMN roster_id TEXT REFERENCES conversation_ai_roster(id);
ALTER TABLE device_ai_rounds ADD COLUMN alias_snapshot TEXT NOT NULL DEFAULT '';
-- A revoked/deleted device may cascade execution rows, so immutable reply
-- attribution belongs to the social message as well. Never store AI body here.
ALTER TABLE messages ADD COLUMN ai_alias TEXT NOT NULL DEFAULT '';
ALTER TABLE messages ADD COLUMN ai_session_id TEXT REFERENCES device_ai_sessions(id) ON DELETE SET NULL;
UPDATE messages SET ai_session_id=(SELECT session_id FROM device_ai_rounds WHERE message_id=messages.id)
 WHERE provider<>'';
