CREATE TABLE `py_claim` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employee_id` integer NOT NULL,
	`category_code` text NOT NULL,
	`claim_date` text NOT NULL,
	`total_amount_paise` integer NOT NULL,
	`status` text DEFAULT 'Pending' NOT NULL,
	`decision_note` text,
	`additional_payment_id` integer,
	`requested_at` text NOT NULL,
	`decided_at` text,
	FOREIGN KEY (`employee_id`) REFERENCES `pa_employee`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_code`) REFERENCES `py_claim_category`(`code`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`additional_payment_id`) REFERENCES `py_it0015_additional_payment`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `ix_claim_employee` ON `py_claim` (`employee_id`);--> statement-breakpoint
CREATE TABLE `py_claim_category` (
	`code` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`is_taxable` integer DEFAULT true NOT NULL,
	`default_annual_limit_paise` integer NOT NULL,
	`is_active` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE `py_claim_category_limit` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`category_code` text NOT NULL,
	`grade` text NOT NULL,
	`annual_limit_paise` integer NOT NULL,
	FOREIGN KEY (`category_code`) REFERENCES `py_claim_category`(`code`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_claim_limit_category_grade` ON `py_claim_category_limit` (`category_code`,`grade`);--> statement-breakpoint
CREATE TABLE `py_claim_line` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`claim_id` integer NOT NULL,
	`line_date` text NOT NULL,
	`description` text NOT NULL,
	`amount_paise` integer NOT NULL,
	FOREIGN KEY (`claim_id`) REFERENCES `py_claim`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ix_claimline_claim` ON `py_claim_line` (`claim_id`);--> statement-breakpoint
CREATE TABLE `py_loan` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employee_id` integer NOT NULL,
	`loan_type` text NOT NULL,
	`principal_paise` integer NOT NULL,
	`annual_rate_basis_points` integer DEFAULT 0 NOT NULL,
	`tenure_months` integer NOT NULL,
	`emi_paise` integer NOT NULL,
	`start_date` text NOT NULL,
	`status` text DEFAULT 'Pending' NOT NULL,
	`reason` text,
	`requested_by` text NOT NULL,
	`requested_at` text NOT NULL,
	`decided_at` text,
	FOREIGN KEY (`employee_id`) REFERENCES `pa_employee`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ix_loan_employee` ON `py_loan` (`employee_id`);--> statement-breakpoint
CREATE TABLE `py_loan_benchmark_rate` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`valid_from` text NOT NULL,
	`valid_to` text NOT NULL,
	`rate_basis_points` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_loan_benchmark_valid_from` ON `py_loan_benchmark_rate` (`valid_from`);--> statement-breakpoint
CREATE TABLE `py_loan_prepayment` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`loan_id` integer NOT NULL,
	`payment_date` text NOT NULL,
	`amount_paise` integer NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`loan_id`) REFERENCES `py_loan`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ix_prepayment_loan` ON `py_loan_prepayment` (`loan_id`);--> statement-breakpoint
CREATE TABLE `py_loan_schedule` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`loan_id` integer NOT NULL,
	`installment_no` integer NOT NULL,
	`due_date` text NOT NULL,
	`opening_balance_paise` integer NOT NULL,
	`principal_paise` integer NOT NULL,
	`interest_paise` integer NOT NULL,
	`closing_balance_paise` integer NOT NULL,
	`perquisite_value_paise` integer DEFAULT 0 NOT NULL,
	`additional_payment_id` integer,
	FOREIGN KEY (`loan_id`) REFERENCES `py_loan`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`additional_payment_id`) REFERENCES `py_it0015_additional_payment`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_loan_schedule_installment` ON `py_loan_schedule` (`loan_id`,`installment_no`);--> statement-breakpoint
INSERT OR IGNORE INTO `sec_permission` (`code`, `group_name`, `description`, `is_sensitive`) VALUES ('self.loans', 'Self-service', 'ask for a loan and see their own schedule and balance', 0);--> statement-breakpoint
INSERT OR IGNORE INTO `sec_permission` (`code`, `group_name`, `description`, `is_sensitive`) VALUES ('self.claims', 'Self-service', 'submit reimbursement claims with bills and see their own', 0);--> statement-breakpoint
UPDATE sec_permission SET description = 'keep wage types, recurring payments, one-off payments, salary structures, CTC, statutory rates, cost splits, GL mapping, loans and claim categories' WHERE code = 'payroll.setup';--> statement-breakpoint
INSERT OR IGNORE INTO `sec_role_permission` (`role_code`, `permission_code`) VALUES ('HR_ADMIN', 'self.loans');--> statement-breakpoint
INSERT OR IGNORE INTO `sec_role_permission` (`role_code`, `permission_code`) VALUES ('MANAGER', 'self.loans');--> statement-breakpoint
INSERT OR IGNORE INTO `sec_role_permission` (`role_code`, `permission_code`) VALUES ('EMPLOYEE', 'self.loans');--> statement-breakpoint
INSERT OR IGNORE INTO `sec_role_permission` (`role_code`, `permission_code`) VALUES ('HR_ADMIN', 'self.claims');--> statement-breakpoint
INSERT OR IGNORE INTO `sec_role_permission` (`role_code`, `permission_code`) VALUES ('MANAGER', 'self.claims');--> statement-breakpoint
INSERT OR IGNORE INTO `sec_role_permission` (`role_code`, `permission_code`) VALUES ('EMPLOYEE', 'self.claims');--> statement-breakpoint
INSERT OR IGNORE INTO `wf_flow` (`process`, `version`, `is_active`, `created_by`, `created_at`) VALUES ('loan', 1, 1, 'system', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));--> statement-breakpoint
INSERT OR IGNORE INTO `wf_step` (`flow_id`, `step_order`, `approver_type`) SELECT id, 1, 'reporting_manager' FROM wf_flow WHERE process = 'loan' AND version = 1;--> statement-breakpoint
INSERT OR IGNORE INTO `wf_flow` (`process`, `version`, `is_active`, `created_by`, `created_at`) VALUES ('claim', 1, 1, 'system', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));--> statement-breakpoint
INSERT OR IGNORE INTO `wf_step` (`flow_id`, `step_order`, `approver_type`) SELECT id, 1, 'reporting_manager' FROM wf_flow WHERE process = 'claim' AND version = 1;--> statement-breakpoint
INSERT OR IGNORE INTO `wf_step` (`flow_id`, `step_order`, `approver_type`, `approver_role`) SELECT id, 2, 'role', 'FINANCE' FROM wf_flow WHERE process = 'claim' AND version = 1;