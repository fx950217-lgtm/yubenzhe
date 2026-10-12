-- Device AI relay: no prompts, output text, credentials or file bytes are stored here.
CREATE TABLE ai_channel_devices (
 device_id TEXT PRIMARY KEY REFERENCES personal_devices(id) ON DELETE CASCADE,
 connector_id TEXT NOT NULL,
 status_code TEXT NOT NULL,
 workspace_label TEXT NOT NULL,
 provider TEXT NOT NULL CHECK(provider='Codex'),
 last_seen INTEGER NOT NULL
);
CREATE TABLE ai_channel_tasks (
 id TEXT PRIMARY KEY,
 device_id TEXT NOT NULL REFERENCES personal_devices(id) ON DELETE CASCADE,
 owner_id TEXT NOT NULL REFERENCES accounts(id),
 request_id TEXT NOT NULL,
 request_hash TEXT NOT NULL,
 prompt_length INTEGER NOT NULL,
 status TEXT NOT NULL CHECK(status IN('queued','running','succeeded','failed','cancelled')),
 connector_id TEXT,
 lease_id TEXT,
 lease_until INTEGER,
 hard_until INTEGER,
 last_seq INTEGER NOT NULL DEFAULT 0,
 event_count INTEGER NOT NULL DEFAULT 0,
 output_chars INTEGER NOT NULL DEFAULT 0,
 error_code TEXT,
 created_at INTEGER NOT NULL,
 started_at INTEGER,
 finished_at INTEGER,
 UNIQUE(owner_id,request_id)
);
CREATE UNIQUE INDEX ai_channel_one_running ON ai_channel_tasks(device_id) WHERE status='running';
CREATE INDEX ai_channel_queue ON ai_channel_tasks(device_id,status,created_at,id);
CREATE TABLE ai_channel_event_hashes (
 task_id TEXT NOT NULL REFERENCES ai_channel_tasks(id) ON DELETE CASCADE,
 seq INTEGER NOT NULL,
 digest TEXT NOT NULL,
 PRIMARY KEY(task_id,seq)
);
CREATE TABLE ai_channel_cancel_requests (
 owner_id TEXT NOT NULL REFERENCES accounts(id),
 request_id TEXT NOT NULL,
 task_id TEXT NOT NULL REFERENCES ai_channel_tasks(id) ON DELETE CASCADE,
 PRIMARY KEY(owner_id,request_id)
);
