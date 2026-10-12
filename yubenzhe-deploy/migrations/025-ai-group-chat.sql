-- Add attribution only. AI prompt/reply text stays in bounded relay memory.
ALTER TABLE messages ADD COLUMN provider TEXT NOT NULL DEFAULT '';
ALTER TABLE messages ADD COLUMN device_id TEXT;
ALTER TABLE conversations ADD COLUMN allow_device_ai INTEGER NOT NULL DEFAULT 0 CHECK(allow_device_ai IN(0,1));
DROP INDEX ai_channel_one_running;
CREATE INDEX ai_channel_running ON ai_channel_tasks(device_id,connector_id) WHERE status='running';
CREATE TABLE device_ai_sessions (
 id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id),
 owner_id TEXT NOT NULL REFERENCES accounts(id), device_id TEXT REFERENCES personal_devices(id) ON DELETE SET NULL,
 providers TEXT NOT NULL, status TEXT NOT NULL, round INTEGER NOT NULL DEFAULT 0,
 max_rounds INTEGER NOT NULL DEFAULT 10, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
 viewer_until INTEGER NOT NULL, anchor_id INTEGER NOT NULL DEFAULT 0,
 request_id TEXT NOT NULL, request_hash TEXT NOT NULL,
 UNIQUE(owner_id,request_id)
);
CREATE TABLE device_ai_rounds (
 session_id TEXT NOT NULL REFERENCES device_ai_sessions(id), round INTEGER NOT NULL,
 provider TEXT NOT NULL, task_id TEXT NOT NULL UNIQUE REFERENCES ai_channel_tasks(id) ON DELETE CASCADE,
 message_id INTEGER REFERENCES messages(id),
 PRIMARY KEY(session_id,round,provider)
);
CREATE TABLE device_ai_commands (
 owner_id TEXT NOT NULL REFERENCES accounts(id), request_id TEXT NOT NULL,
 session_id TEXT NOT NULL REFERENCES device_ai_sessions(id), digest TEXT NOT NULL,
 PRIMARY KEY(owner_id,request_id)
);
