CREATE TABLE `om_headcount_request` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`org_unit_code` text NOT NULL,
	`job_code` text NOT NULL,
	`title` text NOT NULL,
	`grade` text,
	`budget_paise` integer NOT NULL,
	`reason` text,
	`requested_by_employee_id` integer,
	`requested_by_name` text NOT NULL,
	`status` text DEFAULT 'Pending' NOT NULL,
	`position_code` text,
	`requested_at` text NOT NULL,
	`decided_at` text,
	`decision_note` text,
	FOREIGN KEY (`org_unit_code`) REFERENCES `om_org_unit`(`code`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`job_code`) REFERENCES `om_job`(`code`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`position_code`) REFERENCES `om_position`(`code`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `py_opening_balance` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employee_id` integer NOT NULL,
	`financial_year` text NOT NULL,
	`as_of_ym` integer NOT NULL,
	`gross_paid_paise` integer DEFAULT 0 NOT NULL,
	`tds_deducted_paise` integer DEFAULT 0 NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `pa_employee`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_opening_balance_employee_year` ON `py_opening_balance` (`employee_id`,`financial_year`);--> statement-breakpoint
CREATE TABLE `app_import` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`file_name` text,
	`status` text DEFAULT 'Validating' NOT NULL,
	`total_rows` integer DEFAULT 0 NOT NULL,
	`ok_rows` integer DEFAULT 0 NOT NULL,
	`error_rows` integer DEFAULT 0 NOT NULL,
	`skipped_rows` integer DEFAULT 0 NOT NULL,
	`written_rows` integer DEFAULT 0 NOT NULL,
	`uploaded_by` text NOT NULL,
	`uploaded_at` text NOT NULL,
	`confirmed_at` text,
	`finished_at` text
);
--> statement-breakpoint
CREATE INDEX `ix_import_status` ON `app_import` (`status`);--> statement-breakpoint
CREATE TABLE `app_import_row` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`import_id` integer NOT NULL,
	`row_number` integer NOT NULL,
	`key` text,
	`data` text NOT NULL,
	`outcome` text NOT NULL,
	`messages` text,
	FOREIGN KEY (`import_id`) REFERENCES `app_import`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ix_import_row_import` ON `app_import_row` (`import_id`,`row_number`);--> statement-breakpoint
ALTER TABLE `om_position` ADD `budget_paise` integer;--> statement-breakpoint
INSERT OR IGNORE INTO `wf_flow` (`process`, `version`, `is_active`, `created_by`, `created_at`) VALUES ('headcount', 1, 1, 'system', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));--> statement-breakpoint
INSERT OR IGNORE INTO `wf_step` (`flow_id`, `step_order`, `approver_type`) SELECT id, 1, 'reporting_manager' FROM wf_flow WHERE process = 'headcount' AND version = 1;--> statement-breakpoint
INSERT OR IGNORE INTO `wf_step` (`flow_id`, `step_order`, `approver_type`, `approver_role`) SELECT id, 2, 'role', 'HR_ADMIN' FROM wf_flow WHERE process = 'headcount' AND version = 1;--> statement-breakpoint
INSERT OR IGNORE INTO `wf_step` (`flow_id`, `step_order`, `approver_type`, `approver_role`) SELECT id, 3, 'role', 'FINANCE' FROM wf_flow WHERE process = 'headcount' AND version = 1;--> statement-breakpoint
INSERT OR IGNORE INTO `sec_role` (`code`, `name`, `description`, `is_built_in`) VALUES ('FINANCE', 'Finance', 'Approves the budget on a new position, at the last step of a headcount request. Give it to whoever signs off cost before a role is opened.', 0);--> statement-breakpoint
INSERT OR IGNORE INTO `sec_role_permission` (`role_code`, `permission_code`) VALUES ('FINANCE', 'org.view');