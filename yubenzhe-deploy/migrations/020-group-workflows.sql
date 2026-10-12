-- Additive collaboration records. Existing accounts, messages and task files stay intact.
CREATE TABLE group_workflows (
 id TEXT PRIMARY KEY,
 conversation_id TEXT NOT NULL REFERENCES conversations(id),
 owner_id TEXT NOT NULL REFERENCES accounts(id),
 create_request_id TEXT NOT NULL,
 create_signature TEXT NOT NULL,
 goal TEXT NOT NULL,
 source_json TEXT NOT NULL DEFAULT '[]',
 scope_json TEXT NOT NULL,
 status TEXT NOT NULL,
 version INTEGER NOT NULL DEFAULT 1,
 anchor_message_id INTEGER REFERENCES messages(id),
 ai_task_id TEXT,
 proposal_output TEXT NOT NULL DEFAULT '',
 proposal_digest TEXT NOT NULL DEFAULT '',
 error_code TEXT,
 approval_json TEXT,
 workbench_task_id TEXT REFERENCES workbench_tasks(id),
 artifacts_json TEXT NOT NULL DEFAULT '[]',
 artifact_digest TEXT NOT NULL DEFAULT '',
 accepted_at INTEGER,
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL,
 UNIQUE(owner_id,create_request_id)
);
CREATE INDEX group_workflows_conversation ON group_workflows(conversation_id,created_at);
CREATE TABLE group_workflow_events (
 id TEXT PRIMARY KEY,
 workflow_id TEXT NOT NULL REFERENCES group_workflows(id),
 event_key TEXT NOT NULL,
 event_type TEXT NOT NULL,
 message_id INTEGER NOT NULL REFERENCES messages(id),
 payload_json TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 UNIQUE(workflow_id,event_key)
);
CREATE TABLE group_workflow_commands (
 owner_id TEXT NOT NULL REFERENCES accounts(id),
 request_id TEXT NOT NULL,
 workflow_id TEXT NOT NULL REFERENCES group_workflows(id),
 operation TEXT NOT NULL,
 signature TEXT NOT NULL,
 response_json TEXT,
 created_at INTEGER NOT NULL,
 PRIMARY KEY(owner_id,request_id)
);
CREATE TABLE group_workflow_payments (
 id TEXT PRIMARY KEY,
 workflow_id TEXT NOT NULL UNIQUE REFERENCES group_workflows(id),
 chain_id INTEGER NOT NULL CHECK(chain_id=97),
 from_address TEXT NOT NULL,
 to_address TEXT NOT NULL,
 value_wei TEXT NOT NULL,
 data TEXT NOT NULL,
 acceptance_digest TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'awaiting-signature',
 tx_hash TEXT UNIQUE,
 receipt_json TEXT,
 verify_generation INTEGER NOT NULL DEFAULT 0,
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL
);
