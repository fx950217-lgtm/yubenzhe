-- Opt-in discovery, bounded greetings, group permissions and visible-history replies.
CREATE TABLE social_discovery(account_id TEXT PRIMARY KEY REFERENCES accounts(id),enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN(0,1)),updated_at INTEGER NOT NULL);
CREATE TABLE social_discovery_dismissals(account_id TEXT NOT NULL REFERENCES accounts(id),target_id TEXT NOT NULL REFERENCES accounts(id),created_at INTEGER NOT NULL,PRIMARY KEY(account_id,target_id));
ALTER TABLE friend_requests ADD COLUMN greeting TEXT NOT NULL DEFAULT '';
CREATE TABLE social_greetings(account_id TEXT NOT NULL REFERENCES accounts(id),request_id TEXT NOT NULL,target_id TEXT NOT NULL REFERENCES accounts(id),digest TEXT NOT NULL,friend_request_id TEXT NOT NULL REFERENCES friend_requests(id) ON DELETE CASCADE,created_at INTEGER NOT NULL,PRIMARY KEY(account_id,request_id));
ALTER TABLE conversations ADD COLUMN join_approval INTEGER NOT NULL DEFAULT 1 CHECK(join_approval IN(0,1));
ALTER TABLE conversation_members ADD COLUMN role TEXT NOT NULL DEFAULT 'member' CHECK(role IN('member','admin'));
ALTER TABLE conversation_members ADD COLUMN silenced_until INTEGER NOT NULL DEFAULT 0;
CREATE TABLE group_join_requests(id TEXT PRIMARY KEY,conversation_id TEXT NOT NULL REFERENCES conversations(id),inviter_id TEXT NOT NULL REFERENCES accounts(id),target_id TEXT NOT NULL REFERENCES accounts(id),status TEXT NOT NULL CHECK(status IN('pending','accepted','rejected')),created_at INTEGER NOT NULL,reviewer_id TEXT REFERENCES accounts(id),reviewed_at INTEGER);
CREATE UNIQUE INDEX pending_group_join_request ON group_join_requests(conversation_id,target_id) WHERE status='pending';
CREATE TABLE social_group_audit(id TEXT PRIMARY KEY,conversation_id TEXT NOT NULL REFERENCES conversations(id),actor_id TEXT NOT NULL REFERENCES accounts(id),target_id TEXT REFERENCES accounts(id),action TEXT NOT NULL,created_at INTEGER NOT NULL);
ALTER TABLE messages ADD COLUMN reply_to_id INTEGER REFERENCES messages(id);
