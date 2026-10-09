CREATE TABLE push_subscriptions(id TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES accounts(id),session_hash TEXT NOT NULL,endpoint TEXT NOT NULL UNIQUE,subscription_json TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
CREATE INDEX push_subscriptions_account ON push_subscriptions(account_id);
CREATE TABLE push_jobs(id INTEGER PRIMARY KEY AUTOINCREMENT,subscription_id TEXT NOT NULL REFERENCES push_subscriptions(id) ON DELETE CASCADE,account_id TEXT NOT NULL REFERENCES accounts(id),message_id INTEGER NOT NULL,conversation_id TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,next_at INTEGER NOT NULL,created_at INTEGER NOT NULL,UNIQUE(subscription_id,message_id));
CREATE INDEX push_jobs_pending ON push_jobs(status,next_at);
CREATE TABLE push_cursor(id INTEGER PRIMARY KEY CHECK(id=1),message_id INTEGER NOT NULL);
INSERT INTO push_cursor SELECT 1,coalesce(max(id),0) FROM messages;
