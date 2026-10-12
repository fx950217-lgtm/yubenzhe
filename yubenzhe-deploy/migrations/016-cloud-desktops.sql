CREATE TABLE cloud_desktops (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES accounts(id),
 provider TEXT NOT NULL CHECK(provider IN('aws-workspaces','other')),
 provider_desktop_id TEXT,
 plan TEXT NOT NULL CHECK(plan IN('basic','standard','power','graphics')),
 region TEXT NOT NULL,
 protocol TEXT NOT NULL DEFAULT 'DCV' CHECK(protocol='DCV'),
 state TEXT NOT NULL CHECK(state IN('creating','available','stopped','error','terminating','terminated')),
 created_at INTEGER NOT NULL,
 available_at INTEGER,
 terminated_at INTEGER,
 cost_cents INTEGER CHECK(cost_cents IS NULL OR cost_cents>=0),
 price_cents INTEGER CHECK(price_cents IS NULL OR price_cents>=0),
 auto_stop_minutes INTEGER NOT NULL DEFAULT 60 CHECK(auto_stop_minutes BETWEEN 15 AND 1440),
 version INTEGER NOT NULL DEFAULT 1,
 updated_at INTEGER NOT NULL
);
CREATE INDEX cloud_desktops_user ON cloud_desktops(user_id);
CREATE INDEX cloud_desktops_state ON cloud_desktops(state);
CREATE UNIQUE INDEX cloud_desktops_provider_id ON cloud_desktops(provider,provider_desktop_id) WHERE provider_desktop_id IS NOT NULL;
CREATE TABLE cloud_desktop_credentials (
 desktop_id TEXT PRIMARY KEY REFERENCES cloud_desktops(id),
 registration_code TEXT,
 username TEXT NOT NULL,
 password_ciphertext BLOB NOT NULL,
 password_iv BLOB NOT NULL CHECK(length(password_iv)=12),
 password_tag BLOB NOT NULL CHECK(length(password_tag)=16),
 realm TEXT,
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL
);
CREATE TABLE desktop_provision_jobs (
 id TEXT PRIMARY KEY,
 desktop_id TEXT NOT NULL REFERENCES cloud_desktops(id),
 request_id TEXT NOT NULL UNIQUE,
 payload_hash TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN('queued','running','succeeded','failed','unknown')),
 attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts>=0),
 last_error TEXT,
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL
);
CREATE INDEX desktop_jobs_status ON desktop_provision_jobs(status,created_at);
CREATE TABLE desktop_audit_events (
 id TEXT PRIMARY KEY,
 desktop_id TEXT NOT NULL REFERENCES cloud_desktops(id),
 user_id TEXT NOT NULL REFERENCES accounts(id),
 event TEXT NOT NULL,
 created_at INTEGER NOT NULL
);
CREATE INDEX desktop_audit_owner ON desktop_audit_events(user_id,created_at);
