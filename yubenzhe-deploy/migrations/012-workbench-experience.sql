ALTER TABLE workbench_tasks ADD COLUMN goal TEXT NOT NULL DEFAULT '';
ALTER TABLE workbench_tasks ADD COLUMN locale TEXT NOT NULL DEFAULT 'zh-CN';
ALTER TABLE workbench_tasks ADD COLUMN plan_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE workbench_tasks ADD COLUMN plan_version INTEGER NOT NULL DEFAULT 0;
CREATE TABLE workbench_instructions (
 id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES workbench_tasks(id),
 instruction TEXT NOT NULL, plan_version INTEGER NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX workbench_instructions_task ON workbench_instructions(task_id,created_at);
