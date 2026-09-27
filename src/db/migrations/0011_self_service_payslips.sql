CREATE TABLE `pa_change_request` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employee_id` integer NOT NULL,
	`section` text NOT NULL,
	`subtype` text,
	`proposed` text NOT NULL,
	`current` text,
	`effective_date` text NOT NULL,
	`note` text,
	`evidence_document_id` integer,
	`status` text DEFAULT 'Pending' NOT NULL,
	`channel` text DEFAULT 'self' NOT NULL,
	`requested_by_user_id` integer,
	`requested_by_name` text NOT NULL,
	`requested_at` text NOT NULL,
	`decided_at` text,
	`decision_note` text,
	FOREIGN KEY (`employee_id`) REFERENCES `pa_employee`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ix_change_request_employee` ON `pa_change_request` (`employee_id`,`status`);--> statement-breakpoint
ALTER TABLE `py_payroll_period` ADD `email_payslips` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `py_payroll_result` ADD `published_at` text;--> statement-breakpoint
ALTER TABLE `app_outbox` ADD `attachments` text;;--> statement-breakpoint
-- Data, written by hand.
-- A payslip already in a posted month was published when the month was posted.
UPDATE `py_payroll_result` SET `published_at` = (SELECT p.`posted_at` FROM `py_payroll_run` r JOIN `py_payroll_period` p ON p.`id` = r.`period_id` WHERE r.`id` = `py_payroll_result`.`run_id` AND p.`status` = 'Posted') WHERE `published_at` IS NULL;--> statement-breakpoint
-- Corrections: HR checks every request; a bank change needs a second person, the employee's manager.
INSERT OR IGNORE INTO `wf_flow` (`process`, `version`, `is_active`, `created_by`, `created_at`) VALUES ('correction', 1, 1, 'system', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));--> statement-breakpoint
INSERT OR IGNORE INTO `wf_step` (`flow_id`, `step_order`, `approver_type`, `approver_role`, `escalate_after_days`) SELECT id, 1, 'role', 'HR_ADMIN', 3 FROM wf_flow WHERE process = 'correction' AND version = 1;--> statement-breakpoint
INSERT OR IGNORE INTO `wf_step` (`flow_id`, `step_order`, `approver_type`, `condition_field`, `condition_min`) SELECT id, 2, 'reporting_manager', 'bank', 0 FROM wf_flow WHERE process = 'correction' AND version = 1;
