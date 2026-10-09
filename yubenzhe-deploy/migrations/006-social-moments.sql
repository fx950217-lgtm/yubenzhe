CREATE TABLE moments (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 author_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
 text TEXT NOT NULL,
 audience TEXT NOT NULL CHECK(audience IN('friends','self')),
 created_at INTEGER NOT NULL
);
CREATE INDEX moments_author ON moments(author_id,id);
CREATE TABLE moment_media (
 id TEXT PRIMARY KEY,
 post_id INTEGER NOT NULL REFERENCES moments(id) ON DELETE CASCADE,
 owner_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
 name TEXT NOT NULL,
 mime TEXT NOT NULL,
 bytes BLOB NOT NULL,
 width INTEGER NOT NULL,
 height INTEGER NOT NULL
);
CREATE INDEX moment_media_post ON moment_media(post_id);
CREATE TABLE moment_comments (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 post_id INTEGER NOT NULL REFERENCES moments(id) ON DELETE CASCADE,
 author_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
 text TEXT NOT NULL,
 created_at INTEGER NOT NULL
);
CREATE INDEX moment_comments_post ON moment_comments(post_id,id);
CREATE TABLE moment_likes (
 post_id INTEGER NOT NULL REFERENCES moments(id) ON DELETE CASCADE,
 account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
 created_at INTEGER NOT NULL,
 PRIMARY KEY(post_id,account_id)
);
-- Retain deletion tombstones so retrying a lost response cannot republish content.
CREATE TABLE moment_requests (
 account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
 client_id TEXT NOT NULL,
 operation TEXT NOT NULL CHECK(operation IN('post','comment')),
 digest TEXT NOT NULL,
 post_id INTEGER NOT NULL,
 resource_id INTEGER NOT NULL,
 removed INTEGER NOT NULL DEFAULT 0 CHECK(removed IN(0,1)),
 PRIMARY KEY(account_id,client_id)
);
