CREATE TABLE workbench_workspaces (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL UNIQUE REFERENCES accounts(id),
 state TEXT NOT NULL, controller TEXT NOT NULL DEFAULT 'ai', controller_task_id TEXT, version INTEGER NOT NULL DEFAULT 1,
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE workbench_files (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES accounts(id), task_id TEXT,
 name TEXT NOT NULL, mime TEXT NOT NULL, content BLOB NOT NULL, sha256 TEXT NOT NULL,
 size INTEGER NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('input','output')),
 created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
);
CREATE INDEX workbench_files_owner ON workbench_files(owner_id,expires_at);
CREATE TABLE workbench_tasks (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES accounts(id), workspace_id TEXT NOT NULL REFERENCES workbench_workspaces(id),
 title TEXT NOT NULL, operation TEXT NOT NULL, input_ids TEXT NOT NULL, status TEXT NOT NULL,
 step INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 1,
 quote_expires_at INTEGER NOT NULL, estimated_micro TEXT NOT NULL, budget_micro TEXT NOT NULL,
 cost_micro TEXT NOT NULL DEFAULT '0', authorized_micro TEXT NOT NULL DEFAULT '0',
 reserved_micro TEXT NOT NULL DEFAULT '0', settled_micro TEXT NOT NULL DEFAULT '0',
 released_micro TEXT NOT NULL DEFAULT '0', billing_state TEXT NOT NULL DEFAULT 'quoted',
 price_version TEXT NOT NULL, error_code TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX workbench_tasks_owner ON workbench_tasks(owner_id,created_at);
CREATE UNIQUE INDEX workbench_one_running ON workbench_tasks(owner_id) WHERE status='running';
CREATE TABLE workbench_usage (
 id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES workbench_tasks(id), event_key TEXT NOT NULL,
 cost_micro TEXT NOT NULL, step INTEGER NOT NULL, created_at INTEGER NOT NULL,
 UNIQUE(task_id,event_key)
);
CREATE TABLE workbench_invoices (
 id TEXT PRIMARY KEY, task_id TEXT NOT NULL UNIQUE REFERENCES workbench_tasks(id), owner_id TEXT NOT NULL,
 cost_micro TEXT NOT NULL, total_micro TEXT NOT NULL, user_charge_micro TEXT NOT NULL DEFAULT '0',
 payer TEXT NOT NULL, state TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE workbench_approvals (
 id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES workbench_tasks(id), owner_id TEXT NOT NULL,
 action TEXT NOT NULL, parameters TEXT NOT NULL, status TEXT NOT NULL, version INTEGER NOT NULL,
 created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
);
CREATE TABLE workbench_commands (
 owner_id TEXT NOT NULL, request_id TEXT NOT NULL, signature TEXT NOT NULL, response TEXT NOT NULL,
 created_at INTEGER NOT NULL, PRIMARY KEY(owner_id,request_id)
);
CREATE TABLE workbench_events (
 id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES workbench_tasks(id), event TEXT NOT NULL,
 payload TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL
);
