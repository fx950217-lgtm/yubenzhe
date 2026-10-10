-- V0.2 removes custody from the live schema. The migration runner archives
-- existing SIM rows with a verified checksum before applying these statements.
DROP TRIGGER IF EXISTS platform_account_created;
DROP TABLE asset_gift_messages;
DROP TABLE asset_outbox;
DROP TABLE asset_claims;
DROP TABLE asset_gift_eligibility;
DROP TABLE asset_gifts;
DROP TABLE asset_deposits;
DROP TABLE asset_withdrawals;
DROP TABLE asset_lines;
DROP TABLE asset_journals;
DROP TABLE asset_balances;
DROP TABLE asset_requests;
DROP TABLE wallet_challenges;
DROP TABLE wallet_deletions;
DROP TABLE wallet_binding_history;
DROP TABLE wallet_bindings;
DROP TABLE asset_risk;
DROP TABLE asset_incidents;
DROP TABLE asset_registry;
DROP TABLE platform_accounts;
ALTER TABLE community_preferences DROP COLUMN asset_public;
