-- POINT is a nontransferable service entitlement, never an asset or Gas credit.
CREATE TABLE points_accounts (
 owner_id TEXT PRIMARY KEY REFERENCES accounts(id),
 available TEXT NOT NULL DEFAULT '0', reserved TEXT NOT NULL DEFAULT '0',
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, closed_at INTEGER
);
CREATE TABLE points_transactions (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES accounts(id),
 request_id TEXT NOT NULL, signature TEXT NOT NULL, reason TEXT NOT NULL,
 delta TEXT NOT NULL, status TEXT NOT NULL, resource_id TEXT,
 response TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL,
 UNIQUE(owner_id,request_id)
);
CREATE INDEX points_ledger_owner ON points_transactions(owner_id,created_at,id);
CREATE TABLE points_entries (
 id TEXT PRIMARY KEY, transaction_id TEXT NOT NULL REFERENCES points_transactions(id),
 account_key TEXT NOT NULL, delta TEXT NOT NULL
);
CREATE TABLE points_reservations (
 resource_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES accounts(id),
 amount TEXT NOT NULL, spent TEXT NOT NULL DEFAULT '0', released TEXT NOT NULL DEFAULT '0',
 status TEXT NOT NULL CHECK(status IN ('reserved','settled')), updated_at INTEGER NOT NULL
);
ALTER TABLE workbench_tasks ADD COLUMN billing_unit TEXT NOT NULL DEFAULT 'LEGACY_TRIAL';
ALTER TABLE workbench_tasks ADD COLUMN estimated_points TEXT NOT NULL DEFAULT '0';
ALTER TABLE workbench_tasks ADD COLUMN budget_points TEXT NOT NULL DEFAULT '0';
ALTER TABLE workbench_tasks ADD COLUMN reserved_points TEXT NOT NULL DEFAULT '0';
ALTER TABLE workbench_tasks ADD COLUMN spent_points TEXT NOT NULL DEFAULT '0';
ALTER TABLE workbench_tasks ADD COLUMN released_points TEXT NOT NULL DEFAULT '0';
ALTER TABLE workbench_tasks ADD COLUMN points_price_version TEXT;
