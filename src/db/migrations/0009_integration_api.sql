CREATE TABLE `app_cursor` (
	`name` text PRIMARY KEY NOT NULL,
	`value` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `int_ack` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`entity` text NOT NULL,
	`entity_id` text NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`reference` text,
	`reason` text,
	`totals` text,
	`client_pk` integer,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_int_ack_entity` ON `int_ack` (`entity`,`entity_id`);--> statement-breakpoint
CREATE TABLE `int_client` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`client_id` text NOT NULL,
	`name` text NOT NULL,
	`system_key` text DEFAULT 'erp' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`scopes` text DEFAULT '' NOT NULL,
	`companies` text,
	`allowed_ips` text,
	`rate_limit` integer DEFAULT 600 NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`last_used_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `int_client_client_id_unique` ON `int_client` (`client_id`);--> statement-breakpoint
CREATE TABLE `int_client_secret` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`client_pk` integer NOT NULL,
	`secret_hash` text NOT NULL,
	`hint` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text,
	`revoked_at` text,
	FOREIGN KEY (`client_pk`) REFERENCES `int_client`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `int_client_secret_secret_hash_unique` ON `int_client_secret` (`secret_hash`);--> statement-breakpoint
CREATE INDEX `ix_int_secret_client` ON `int_client_secret` (`client_pk`);--> statement-breakpoint
CREATE TABLE `int_event` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_id` text NOT NULL,
	`type` text NOT NULL,
	`subject` text NOT NULL,
	`time` text NOT NULL,
	`data` text NOT NULL,
	`caused_by_client_pk` integer,
	`change_id` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `int_event_event_id_unique` ON `int_event` (`event_id`);--> statement-breakpoint
CREATE INDEX `ix_int_event_type` ON `int_event` (`type`,`id`);--> statement-breakpoint
CREATE TABLE `int_external_ref` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`system` text NOT NULL,
	`entity` text NOT NULL,
	`entity_id` text NOT NULL,
	`external_id` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_int_ref_ours` ON `int_external_ref` (`system`,`entity`,`entity_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `ux_int_ref_theirs` ON `int_external_ref` (`system`,`entity`,`external_id`);--> statement-breakpoint
CREATE TABLE `int_idempotency` (
	`client_pk` integer NOT NULL,
	`key` text NOT NULL,
	`method` text NOT NULL,
	`route` text NOT NULL,
	`request_hash` text NOT NULL,
	`status` integer DEFAULT 0 NOT NULL,
	`body` text,
	`created_at` text NOT NULL,
	PRIMARY KEY(`client_pk`, `key`)
);
--> statement-breakpoint
CREATE TABLE `int_ownership` (
	`record_type` text NOT NULL,
	`field` text DEFAULT '' NOT NULL,
	`owner` text NOT NULL,
	`updated_by` text,
	`updated_at` text,
	PRIMARY KEY(`record_type`, `field`)
);
--> statement-breakpoint
CREATE TABLE `int_request_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`client_pk` integer,
	`method` text NOT NULL,
	`route` text NOT NULL,
	`status` integer NOT NULL,
	`duration_ms` integer NOT NULL,
	`correlation_id` text NOT NULL,
	`at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ix_int_request_client` ON `int_request_log` (`client_pk`,`at`);--> statement-breakpoint
CREATE TABLE `int_sync_issue` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`client_pk` integer,
	`direction` text NOT NULL,
	`kind` text NOT NULL,
	`reference` text,
	`payload` text,
	`reason` text NOT NULL,
	`state` text DEFAULT 'open' NOT NULL,
	`created_at` text NOT NULL,
	`resolved_at` text,
	`resolved_by` text
);
--> statement-breakpoint
CREATE INDEX `ix_int_issue_state` ON `int_sync_issue` (`state`,`created_at`);--> statement-breakpoint
CREATE TABLE `int_webhook` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`client_pk` integer NOT NULL,
	`url` text NOT NULL,
	`secret` text NOT NULL,
	`event_types` text,
	`include_own` integer DEFAULT false NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`client_pk`) REFERENCES `int_client`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ix_int_webhook_client` ON `int_webhook` (`client_pk`);--> statement-breakpoint
CREATE TABLE `om_cost_centre` (
	`code` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`company_code` text,
	`is_active` integer DEFAULT true NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `py_gl_account` (
	`code` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `py_bank_transfer_line` ADD `payment_status` text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE `py_bank_transfer_line` ADD `paid_at` text;--> statement-breakpoint
ALTER TABLE `py_bank_transfer_line` ADD `bank_reference` text;--> statement-breakpoint
ALTER TABLE `py_bank_transfer_line` ADD `failure_reason` text;--> statement-breakpoint
ALTER TABLE `app_access_log` ADD `client_pk` integer;
--> statement-breakpoint
-- Hand-written from here: the integrations permission for HR, default record
-- ownership (src/lib/api/ownership-defaults.ts), and the event cursor.
INSERT OR IGNORE INTO `sec_permission` (`code`, `group_name`, `description`, `is_sensitive`) VALUES ('integrations.manage', 'Administration', 'connect other systems: API clients and their secrets, webhooks, record ownership, sync issues and the reconciliation report', 1);--> statement-breakpoint
INSERT OR IGNORE INTO `sec_role_permission` (`role_code`, `permission_code`) VALUES ('HR_ADMIN', 'integrations.manage');--> statement-breakpoint
INSERT OR IGNORE INTO `int_ownership` (`record_type`, `field`, `owner`) VALUES ('employee', '', 'hrms');--> statement-breakpoint
INSERT OR IGNORE INTO `int_ownership` (`record_type`, `field`, `owner`) VALUES ('org', '', 'hrms');--> statement-breakpoint
INSERT OR IGNORE INTO `int_ownership` (`record_type`, `field`, `owner`) VALUES ('absence', '', 'hrms');--> statement-breakpoint
INSERT OR IGNORE INTO `int_ownership` (`record_type`, `field`, `owner`) VALUES ('payroll', '', 'hrms');--> statement-breakpoint
INSERT OR IGNORE INTO `int_ownership` (`record_type`, `field`, `owner`) VALUES ('cost_centre', '', 'erp');--> statement-breakpoint
INSERT OR IGNORE INTO `int_ownership` (`record_type`, `field`, `owner`) VALUES ('gl_account', '', 'erp');--> statement-breakpoint
INSERT OR IGNORE INTO `int_ownership` (`record_type`, `field`, `owner`) VALUES ('payment', '', 'erp');--> statement-breakpoint
INSERT OR IGNORE INTO `app_cursor` (`name`, `value`) SELECT 'events', COALESCE(MAX(id), 0) FROM app_change_log;
