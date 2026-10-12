-- Retire the service entitlement subsystem. The runner verifies an offline archive first.
-- Keep 014 and historical task columns unchanged to preserve the applied checksum chain.
DROP TABLE IF EXISTS points_entries;
DROP TABLE IF EXISTS points_transactions;
DROP TABLE IF EXISTS points_reservations;
DROP TABLE IF EXISTS points_accounts;
DROP INDEX IF EXISTS points_ledger_owner;
