CREATE TABLE `py_run_member` (
	`run_id` integer NOT NULL,
	`employee_id` integer NOT NULL,
	`done` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `py_payroll_run`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`employee_id`) REFERENCES `pa_employee`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_run_member` ON `py_run_member` (`run_id`,`employee_id`);--> statement-breakpoint
CREATE INDEX `ix_run_member_pending` ON `py_run_member` (`run_id`,`done`);--> statement-breakpoint
CREATE TABLE `app_access_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`at` text NOT NULL,
	`user_id` integer NOT NULL,
	`username` text NOT NULL,
	`subject_employee_id` integer,
	`resource` text NOT NULL,
	`resource_id` text
);
--> statement-breakpoint
CREATE INDEX `ix_access_subject` ON `app_access_log` (`subject_employee_id`,`at`);--> statement-breakpoint
CREATE INDEX `ix_access_user` ON `app_access_log` (`user_id`,`at`);--> statement-breakpoint
CREATE TABLE `app_document` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_type` text NOT NULL,
	`owner_id` integer NOT NULL,
	`kind` text NOT NULL,
	`file_name` text NOT NULL,
	`content_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`sha256` text NOT NULL,
	`storage` text NOT NULL,
	`storage_key` text NOT NULL,
	`uploaded_by` text NOT NULL,
	`uploaded_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `app_document_storage_key_unique` ON `app_document` (`storage_key`);--> statement-breakpoint
CREATE INDEX `ix_document_owner` ON `app_document` (`owner_type`,`owner_id`);--> statement-breakpoint
CREATE TABLE `app_document_content` (
	`document_id` integer PRIMARY KEY NOT NULL,
	`bytes` blob NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `app_document`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `py_it0015_additional_payment` ADD `paid_run_id` integer REFERENCES py_payroll_run(id) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `py_payroll_result` ADD `employed_days` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `py_payroll_result_line` ADD `for_period_id` integer;--> statement-breakpoint
CREATE INDEX `ix_line_for_period` ON `py_payroll_result_line` (`for_period_id`);--> statement-breakpoint
ALTER TABLE `py_payroll_run` ADD `run_type` text DEFAULT 'Regular' NOT NULL;--> statement-breakpoint
ALTER TABLE `py_payroll_run` ADD `status` text DEFAULT 'Completed' NOT NULL;--> statement-breakpoint
ALTER TABLE `py_payroll_run` ADD `reason` text;--> statement-breakpoint
ALTER TABLE `py_payroll_run` ADD `pay_date` text;--> statement-breakpoint
ALTER TABLE `py_payroll_run` ADD `planned_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `py_payroll_run` ADD `completed_at` text;--> statement-breakpoint
-- Hand-written below: backfill what existing rows already imply, and add the
-- arrears wage type retro calculation pays through.
UPDATE `py_payroll_result` SET `employed_days` = `working_days`;--> statement-breakpoint
UPDATE `py_payroll_run` SET `planned_count` = `employee_count`, `completed_at` = `run_at`;--> statement-breakpoint
INSERT OR IGNORE INTO `py_wage_type` (`code`, `name`, `kind`, `amount_type`, `percent_basis_points`, `fixed_amount_paise`, `formula_key`, `is_taxable`, `is_automatic`, `gl_account`, `sort_order`, `is_active`) VALUES ('RETRO', 'Arrears', 'Earning', 'Formula', NULL, NULL, 'RETRO', 1, 1, '5010', 45, 1);
