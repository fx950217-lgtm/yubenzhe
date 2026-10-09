CREATE TABLE `admin_audit` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`fingerprint` text NOT NULL,
	`actor_id` text NOT NULL,
	`actor` text NOT NULL,
	`action` text NOT NULL,
	`kind` text NOT NULL,
	`target_id` text NOT NULL,
	`target` text NOT NULL,
	`reason` text NOT NULL,
	`from_status` text NOT NULL,
	`to_status` text NOT NULL,
	`created_at` integer NOT NULL,
	`item_json` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `admin_audit_request_idx` ON `admin_audit` (`request_id`);--> statement-breakpoint
CREATE INDEX `admin_audit_time_idx` ON `admin_audit` (`created_at`);--> statement-breakpoint
CREATE TABLE `admin_records` (
	`kind` text NOT NULL,
	`id` text NOT NULL,
	`title` text NOT NULL,
	`subtitle` text NOT NULL,
	`status` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`segment` text DEFAULT '' NOT NULL,
	`type` text DEFAULT '' NOT NULL,
	`amount` text,
	`currency` text,
	`detail_json` text NOT NULL,
	`last_request_id` text,
	PRIMARY KEY(`kind`, `id`),
	CONSTRAINT "admin_record_version" CHECK("admin_records"."version" >= 1),
	CONSTRAINT "admin_record_detail" CHECK(json_valid("admin_records"."detail_json")),
	CONSTRAINT "admin_record_state" CHECK(("admin_records"."kind" IN ('users','groups') AND "admin_records"."status" IN ('active','restricted')) OR ("admin_records"."kind" = 'reviews' AND "admin_records"."status" IN ('pending','approved','rejected')) OR ("admin_records"."kind" = 'tickets' AND "admin_records"."status" IN ('open','resolved')) OR ("admin_records"."kind" = 'ledger' AND "admin_records"."status" = 'recorded'))
);
--> statement-breakpoint
CREATE INDEX `admin_records_filter_idx` ON `admin_records` (`kind`,`status`,`segment`,`created_at`);--> statement-breakpoint
CREATE TABLE `admin_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`owner_name` text NOT NULL,
	`initialized` integer DEFAULT 0 NOT NULL,
	`seed_version` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT "admin_settings_singleton" CHECK("admin_settings"."id" = 1),
	CONSTRAINT "admin_settings_initialized" CHECK("admin_settings"."initialized" IN (0, 1))
);
