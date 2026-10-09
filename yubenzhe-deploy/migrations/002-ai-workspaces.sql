CREATE TABLE ai_workspaces (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, name TEXT NOT NULL, purpose TEXT NOT NULL,
 requirements TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('pending_review','awaiting_configuration','active','paused','closed','rejected','cancelled')),
 version INTEGER NOT NULL DEFAULT 1, review_note TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX ai_workspace_owner ON ai_workspaces(owner_id,created_at);
CREATE TABLE ai_tasks (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES ai_workspaces(id), owner_id TEXT NOT NULL,
 prompt TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('running','succeeded','failed','cancelled')),
 version INTEGER NOT NULL DEFAULT 1, output TEXT, error_code TEXT, error_message TEXT, usage_json TEXT,
 quota_date TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, finished_at INTEGER,
 lease_until INTEGER NOT NULL, config_fingerprint TEXT NOT NULL
);
CREATE INDEX ai_tasks_workspace ON ai_tasks(workspace_id,created_at);
CREATE INDEX ai_tasks_quota ON ai_tasks(quota_date,owner_id,workspace_id);
CREATE INDEX ai_tasks_running ON ai_tasks(status,lease_until);
CREATE TABLE ai_requests (
 actor_role TEXT NOT NULL, actor_id TEXT NOT NULL, request_id TEXT NOT NULL, fingerprint TEXT NOT NULL,
 response_json TEXT NOT NULL, created_at INTEGER NOT NULL,
 PRIMARY KEY(actor_role,actor_id,request_id)
);
CREATE TABLE ai_audit (
 id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, actor_role TEXT NOT NULL, action TEXT NOT NULL,
 workspace_id TEXT, task_id TEXT, from_status TEXT, to_status TEXT, reason TEXT NOT NULL,
 request_id TEXT, created_at INTEGER NOT NULL
);
CREATE INDEX ai_audit_workspace ON ai_audit(workspace_id,created_at);
CREATE TABLE ai_provider_health (
 id INTEGER PRIMARY KEY CHECK(id=1), fingerprint TEXT NOT NULL, ready INTEGER NOT NULL,
 checked_at INTEGER NOT NULL, message TEXT NOT NULL
);
