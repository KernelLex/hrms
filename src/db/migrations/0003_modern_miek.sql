CREATE TABLE `py_it0015_additional_payment` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employee_id` integer NOT NULL,
	`wage_type_code` text NOT NULL,
	`amount_paise` integer NOT NULL,
	`payment_date` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `pa_employee`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`wage_type_code`) REFERENCES `py_wage_type`(`code`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ix_additional_employee` ON `py_it0015_additional_payment` (`employee_id`,`payment_date`);--> statement-breakpoint
CREATE TABLE `py_bank_transfer_file` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` integer NOT NULL,
	`payment_date` text NOT NULL,
	`format` text DEFAULT 'NEFT bulk upload (CSV)' NOT NULL,
	`total_paise` integer DEFAULT 0 NOT NULL,
	`line_count` integer DEFAULT 0 NOT NULL,
	`generated_at` text NOT NULL,
	`generated_by` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `py_payroll_run`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `py_bank_transfer_line` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`file_id` integer NOT NULL,
	`employee_id` integer NOT NULL,
	`employee_name` text NOT NULL,
	`bank_name` text NOT NULL,
	`account_number` text NOT NULL,
	`ifsc` text,
	`amount_paise` integer NOT NULL,
	FOREIGN KEY (`file_id`) REFERENCES `py_bank_transfer_file`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ix_bankline_file` ON `py_bank_transfer_line` (`file_id`);--> statement-breakpoint
CREATE TABLE `py_gl_posting` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` integer NOT NULL,
	`posting_date` text NOT NULL,
	`posted_at` text NOT NULL,
	`posted_by` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `py_payroll_run`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `py_gl_posting_line` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`posting_id` integer NOT NULL,
	`gl_account` text NOT NULL,
	`description` text NOT NULL,
	`debit_paise` integer DEFAULT 0 NOT NULL,
	`credit_paise` integer DEFAULT 0 NOT NULL,
	`cost_center` text,
	FOREIGN KEY (`posting_id`) REFERENCES `py_gl_posting`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ix_glline_posting` ON `py_gl_posting_line` (`posting_id`);--> statement-breakpoint
CREATE TABLE `py_payroll_period` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`area_code` text NOT NULL,
	`year` integer NOT NULL,
	`month` integer NOT NULL,
	`pay_date` text,
	`status` text DEFAULT 'Open' NOT NULL,
	`released_by` text,
	`released_at` text,
	`posted_at` text,
	FOREIGN KEY (`area_code`) REFERENCES `om_personnel_area`(`code`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_period` ON `py_payroll_period` (`area_code`,`year`,`month`);--> statement-breakpoint
CREATE TABLE `py_payroll_result` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` integer NOT NULL,
	`employee_id` integer NOT NULL,
	`gross_paise` integer DEFAULT 0 NOT NULL,
	`deductions_paise` integer DEFAULT 0 NOT NULL,
	`net_paise` integer DEFAULT 0 NOT NULL,
	`unpaid_days` integer DEFAULT 0 NOT NULL,
	`working_days` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'Calculated' NOT NULL,
	`error_message` text,
	FOREIGN KEY (`run_id`) REFERENCES `py_payroll_run`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`employee_id`) REFERENCES `pa_employee`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_result_run_employee` ON `py_payroll_result` (`run_id`,`employee_id`);--> statement-breakpoint
CREATE TABLE `py_payroll_result_line` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`result_id` integer NOT NULL,
	`wage_type_code` text NOT NULL,
	`wage_type_name` text NOT NULL,
	`kind` text NOT NULL,
	`amount_paise` integer NOT NULL,
	`sort_order` integer DEFAULT 100 NOT NULL,
	FOREIGN KEY (`result_id`) REFERENCES `py_payroll_result`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ix_line_result` ON `py_payroll_result_line` (`result_id`);--> statement-breakpoint
CREATE TABLE `py_payroll_run` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`period_id` integer NOT NULL,
	`run_at` text NOT NULL,
	`run_by` text NOT NULL,
	`employee_count` integer DEFAULT 0 NOT NULL,
	`error_count` integer DEFAULT 0 NOT NULL,
	`gross_total_paise` integer DEFAULT 0 NOT NULL,
	`net_total_paise` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`period_id`) REFERENCES `py_payroll_period`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ix_run_period` ON `py_payroll_run` (`period_id`);--> statement-breakpoint
CREATE TABLE `py_it0014_recurring_payment` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employee_id` integer NOT NULL,
	`wage_type_code` text NOT NULL,
	`amount_paise` integer NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `pa_employee`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`wage_type_code`) REFERENCES `py_wage_type`(`code`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ix_recurring_employee` ON `py_it0014_recurring_payment` (`employee_id`);--> statement-breakpoint
CREATE TABLE `py_statutory_remittance` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` integer NOT NULL,
	`authority` text NOT NULL,
	`amount_paise` integer NOT NULL,
	`due_date` text NOT NULL,
	`status` text DEFAULT 'Due' NOT NULL,
	`remitted_at` text,
	`reference` text,
	FOREIGN KEY (`run_id`) REFERENCES `py_payroll_run`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ix_remittance_run` ON `py_statutory_remittance` (`run_id`);--> statement-breakpoint
CREATE TABLE `py_wage_type` (
	`code` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`amount_type` text NOT NULL,
	`percent_basis_points` integer,
	`fixed_amount_paise` integer,
	`formula_key` text,
	`is_taxable` integer DEFAULT true NOT NULL,
	`is_automatic` integer DEFAULT false NOT NULL,
	`gl_account` text,
	`sort_order` integer DEFAULT 100 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tds_deduction_register` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employee_id` integer NOT NULL,
	`financial_year` text NOT NULL,
	`quarter` integer NOT NULL,
	`gross_paid_paise` integer DEFAULT 0 NOT NULL,
	`tds_deducted_paise` integer DEFAULT 0 NOT NULL,
	`challan_bsr` text,
	`deposit_date` text,
	`receipt_24q` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `pa_employee`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_register_employee_quarter` ON `tds_deduction_register` (`employee_id`,`financial_year`,`quarter`);--> statement-breakpoint
CREATE TABLE `tds_employee_declaration` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employee_id` integer NOT NULL,
	`financial_year` text NOT NULL,
	`regime` text DEFAULT 'New' NOT NULL,
	`section_80c_paise` integer DEFAULT 0 NOT NULL,
	`section_80d_paise` integer DEFAULT 0 NOT NULL,
	`hra_exemption_paise` integer DEFAULT 0 NOT NULL,
	`other_income_paise` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'Declared' NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `pa_employee`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_declaration_employee_year` ON `tds_employee_declaration` (`employee_id`,`financial_year`);--> statement-breakpoint
CREATE TABLE `tds_form16` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employee_id` integer NOT NULL,
	`financial_year` text NOT NULL,
	`certificate_no` text NOT NULL,
	`employer_name` text NOT NULL,
	`employer_tan` text NOT NULL,
	`employer_pan` text NOT NULL,
	`employee_pan` text,
	`regime` text NOT NULL,
	`gross_salary_paise` integer DEFAULT 0 NOT NULL,
	`section_10_exempt_paise` integer DEFAULT 0 NOT NULL,
	`standard_deduction_paise` integer DEFAULT 0 NOT NULL,
	`chapter_via_paise` integer DEFAULT 0 NOT NULL,
	`taxable_income_paise` integer DEFAULT 0 NOT NULL,
	`tax_on_income_paise` integer DEFAULT 0 NOT NULL,
	`rebate_87a_paise` integer DEFAULT 0 NOT NULL,
	`cess_paise` integer DEFAULT 0 NOT NULL,
	`total_tax_paise` integer DEFAULT 0 NOT NULL,
	`tds_deducted_paise` integer DEFAULT 0 NOT NULL,
	`balance_paise` integer DEFAULT 0 NOT NULL,
	`generated_at` text NOT NULL,
	`generated_by` text NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `pa_employee`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_form16_employee_year` ON `tds_form16` (`employee_id`,`financial_year`);--> statement-breakpoint
CREATE TABLE `tds_section_master` (
	`code` text PRIMARY KEY NOT NULL,
	`description` text NOT NULL,
	`rate_basis_points` integer,
	`is_slab_based` integer DEFAULT false NOT NULL,
	`threshold_paise` integer,
	`applicable_to` text DEFAULT 'Employee' NOT NULL,
	`is_active` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tds_tax_slab` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`regime` text NOT NULL,
	`financial_year` text NOT NULL,
	`from_paise` integer NOT NULL,
	`to_paise` integer,
	`rate_basis_points` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ix_slab_regime_year` ON `tds_tax_slab` (`regime`,`financial_year`,`from_paise`);