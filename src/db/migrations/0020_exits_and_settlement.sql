CREATE TABLE `pa_exit` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employee_id` integer NOT NULL,
	`exit_type` text NOT NULL,
	`reason` text,
	`requested_last_day` text NOT NULL,
	`notice_days` integer NOT NULL,
	`approved_last_day` text,
	`notice_waived` integer DEFAULT false NOT NULL,
	`rehire_eligible` integer,
	`status` text DEFAULT 'Pending' NOT NULL,
	`requested_by` text NOT NULL,
	`requested_at` text NOT NULL,
	`decided_at` text,
	`decision_note` text,
	`exited_at` text,
	FOREIGN KEY (`employee_id`) REFERENCES `pa_employee`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ix_exit_employee` ON `pa_exit` (`employee_id`);--> statement-breakpoint
CREATE INDEX `ix_exit_status` ON `pa_exit` (`status`);--> statement-breakpoint
CREATE TABLE `pa_exit_interview` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`exit_id` integer NOT NULL,
	`primary_reason` text,
	`would_recommend` integer,
	`comments` text,
	`submitted_by` text NOT NULL,
	`submitted_at` text NOT NULL,
	FOREIGN KEY (`exit_id`) REFERENCES `pa_exit`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_exit_interview_exit` ON `pa_exit_interview` (`exit_id`);--> statement-breakpoint
CREATE TABLE `py_settlement` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`exit_id` integer NOT NULL,
	`employee_id` integer NOT NULL,
	`status` text DEFAULT 'Draft' NOT NULL,
	`run_id` integer,
	`computed_at` text NOT NULL,
	`paid_at` text,
	FOREIGN KEY (`exit_id`) REFERENCES `pa_exit`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`employee_id`) REFERENCES `pa_employee`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`run_id`) REFERENCES `py_payroll_run`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_settlement_exit` ON `py_settlement` (`exit_id`);--> statement-breakpoint
CREATE INDEX `ix_settlement_employee` ON `py_settlement` (`employee_id`);--> statement-breakpoint
CREATE TABLE `py_settlement_line` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`settlement_id` integer NOT NULL,
	`component` text NOT NULL,
	`basis` text NOT NULL,
	`amount_paise` integer NOT NULL,
	`sort_order` integer DEFAULT 100 NOT NULL,
	FOREIGN KEY (`settlement_id`) REFERENCES `py_settlement`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ix_settlement_line_settlement` ON `py_settlement_line` (`settlement_id`);--> statement-breakpoint
INSERT OR IGNORE INTO `sec_permission` (`code`, `group_name`, `description`, `is_sensitive`) VALUES ('self.exit', 'Self-service', 'resign, and see their own exit, clearance and settlement', 0);--> statement-breakpoint
INSERT OR IGNORE INTO `sec_role_permission` (`role_code`, `permission_code`) VALUES ('HR_ADMIN', 'self.exit');--> statement-breakpoint
INSERT OR IGNORE INTO `sec_role_permission` (`role_code`, `permission_code`) VALUES ('MANAGER', 'self.exit');--> statement-breakpoint
INSERT OR IGNORE INTO `sec_role_permission` (`role_code`, `permission_code`) VALUES ('EMPLOYEE', 'self.exit');--> statement-breakpoint
INSERT OR IGNORE INTO `wf_flow` (`process`, `version`, `is_active`, `created_by`, `created_at`) VALUES ('exit', 1, 1, 'system', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));--> statement-breakpoint
INSERT OR IGNORE INTO `wf_step` (`flow_id`, `step_order`, `approver_type`) SELECT id, 1, 'reporting_manager' FROM wf_flow WHERE process = 'exit' AND version = 1;--> statement-breakpoint
INSERT OR IGNORE INTO `wf_step` (`flow_id`, `step_order`, `approver_type`, `approver_role`) SELECT id, 2, 'role', 'HR_ADMIN' FROM wf_flow WHERE process = 'exit' AND version = 1;