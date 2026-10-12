-- Decisions persist authorization metadata only; proposal text stays in RAM.
CREATE TABLE ai_task_decisions (
 id TEXT PRIMARY KEY, task_id TEXT NOT NULL UNIQUE,
 owner_id TEXT NOT NULL REFERENCES accounts(id), device_id TEXT NOT NULL,
 provider TEXT NOT NULL, proposal_digest TEXT NOT NULL,
 version INTEGER NOT NULL DEFAULT 1,
 state TEXT NOT NULL CHECK(state IN('pending','continued','suspended','cancelled')),
 option_count INTEGER NOT NULL CHECK(option_count BETWEEN 2 AND 4),
 selected_option_id TEXT, selected_by TEXT REFERENCES accounts(id),
 continuation_task_id TEXT UNIQUE, workspace_task_id TEXT NOT NULL,
 created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, resolved_at INTEGER,
 command_request_id TEXT, command_digest TEXT
);
CREATE UNIQUE INDEX ai_decision_command ON ai_task_decisions(owner_id,command_request_id)
 WHERE command_request_id IS NOT NULL;
ALTER TABLE ai_channel_tasks ADD COLUMN parent_task_id TEXT;
ALTER TABLE ai_channel_tasks ADD COLUMN workspace_task_id TEXT;
ALTER TABLE ai_channel_tasks ADD COLUMN parent_decision_id TEXT REFERENCES ai_task_decisions(id);
CREATE UNIQUE INDEX ai_task_continuation_once ON ai_channel_tasks(parent_decision_id)
 WHERE parent_decision_id IS NOT NULL;
ALTER TABLE ai_channel_devices ADD COLUMN decision_protocol_version INTEGER NOT NULL DEFAULT 0 CHECK(decision_protocol_version IN(0,1));
