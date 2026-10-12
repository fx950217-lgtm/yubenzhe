-- Key task notifications replace the retired ordinary-chat delivery queue.
-- No conversation, prompt, task title, decision text or file content is stored here.
CREATE TABLE critical_notification_state (
 id INTEGER PRIMARY KEY CHECK(id=1), started_at INTEGER NOT NULL
);
CREATE TABLE critical_notification_events (
 id TEXT PRIMARY KEY,
 owner_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
 source_kind TEXT NOT NULL CHECK(source_kind IN('ai-task','workbench-task','group-session','decision')),
 source_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN('task-completed','decision-required','task-failed')),
 occurred_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
 UNIQUE(source_kind,source_id,kind)
);
CREATE INDEX critical_notification_events_owner ON critical_notification_events(owner_id,occurred_at);
CREATE TABLE critical_notification_deliveries (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 event_id TEXT NOT NULL REFERENCES critical_notification_events(id) ON DELETE CASCADE,
 subscription_id TEXT NOT NULL REFERENCES push_subscriptions(id) ON DELETE CASCADE,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN('pending','sending','sent','suppressed','failed')),
 attempts INTEGER NOT NULL DEFAULT 0,
 next_at INTEGER NOT NULL,
 claim_token TEXT,
 UNIQUE(event_id,subscription_id)
);
CREATE INDEX critical_notification_deliveries_pending ON critical_notification_deliveries(status,next_at);
-- The new policy intentionally stops pending ordinary-chat pushes, preserving all messages and unread state.
DELETE FROM push_jobs;
