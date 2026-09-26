CREATE TABLE `app_change_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`at` text NOT NULL,
	`actor_type` text NOT NULL,
	`actor_id` integer,
	`actor_name` text NOT NULL,
	`entity` text NOT NULL,
	`entity_id` text NOT NULL,
	`subject_employee_id` integer,
	`action` text NOT NULL,
	`before` text,
	`after` text,
	`reason` text
);
--> statement-breakpoint
CREATE INDEX `ix_change_subject` ON `app_change_log` (`subject_employee_id`,`at`);--> statement-breakpoint
CREATE INDEX `ix_change_entity` ON `app_change_log` (`entity`,`entity_id`);--> statement-breakpoint
CREATE INDEX `ix_change_at` ON `app_change_log` (`at`);--> statement-breakpoint
CREATE TABLE `app_job` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`payload` text,
	`dedupe_key` text,
	`status` text DEFAULT 'queued' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 5 NOT NULL,
	`run_after` text NOT NULL,
	`locked_at` text,
	`lock_token` text,
	`last_error` text,
	`created_at` text NOT NULL,
	`finished_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `app_job_dedupe_key_unique` ON `app_job` (`dedupe_key`);--> statement-breakpoint
CREATE INDEX `ix_job_due` ON `app_job` (`status`,`run_after`);--> statement-breakpoint
CREATE TABLE `app_job_run` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_id` integer,
	`kind` text NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`outcome` text,
	`detail` text
);
--> statement-breakpoint
CREATE INDEX `ix_job_run_kind` ON `app_job_run` (`kind`,`started_at`);--> statement-breakpoint
CREATE TABLE `app_notification` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`body` text,
	`link` text,
	`dedupe_key` text NOT NULL,
	`created_at` text NOT NULL,
	`read_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `app_notification_dedupe_key_unique` ON `app_notification` (`dedupe_key`);--> statement-breakpoint
CREATE INDEX `ix_notification_user` ON `app_notification` (`user_id`,`read_at`,`created_at`);--> statement-breakpoint
CREATE TABLE `app_notification_pref` (
	`user_id` integer NOT NULL,
	`kind` text NOT NULL,
	`in_app` integer DEFAULT true NOT NULL,
	`email` integer DEFAULT true NOT NULL,
	PRIMARY KEY(`user_id`, `kind`)
);
--> statement-breakpoint
CREATE TABLE `app_outbox` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`channel` text NOT NULL,
	`dedupe_key` text NOT NULL,
	`recipient` text NOT NULL,
	`subject` text,
	`body_text` text,
	`body_html` text,
	`payload` text,
	`status` text DEFAULT 'queued' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`created_at` text NOT NULL,
	`next_attempt_at` text,
	`sent_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `app_outbox_dedupe_key_unique` ON `app_outbox` (`dedupe_key`);--> statement-breakpoint
CREATE INDEX `ix_outbox_status` ON `app_outbox` (`status`,`next_attempt_at`);