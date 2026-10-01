CREATE TABLE `py_cost_split` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employee_id` integer NOT NULL,
	`cost_centre` text NOT NULL,
	`percent_basis_points` integer NOT NULL,
	`valid_from` text NOT NULL,
	`valid_to` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `pa_employee`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ix_cost_split_employee` ON `py_cost_split` (`employee_id`,`valid_from`);--> statement-breakpoint
CREATE TABLE `py_employee_ctc` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employee_id` integer NOT NULL,
	`structure_code` text NOT NULL,
	`annual_ctc_paise` integer NOT NULL,
	`valid_from` text NOT NULL,
	`valid_to` text NOT NULL,
	`seq` integer DEFAULT 1 NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `pa_employee`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`structure_code`) REFERENCES `py_salary_structure`(`code`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_ctc_slice` ON `py_employee_ctc` (`employee_id`,`valid_from`,`seq`);--> statement-breakpoint
CREATE TABLE `py_gl_mapping` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company_code` text NOT NULL,
	`wage_type_code` text NOT NULL,
	`gl_account` text NOT NULL,
	FOREIGN KEY (`wage_type_code`) REFERENCES `py_wage_type`(`code`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_gl_mapping_company_wage` ON `py_gl_mapping` (`company_code`,`wage_type_code`);--> statement-breakpoint
CREATE TABLE `py_salary_structure` (
	`code` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE `py_salary_structure_component` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`structure_code` text NOT NULL,
	`wage_type_code` text NOT NULL,
	`component_type` text NOT NULL,
	`percent_basis_points` integer,
	`fixed_amount_paise` integer,
	`sort_order` integer DEFAULT 100 NOT NULL,
	FOREIGN KEY (`structure_code`) REFERENCES `py_salary_structure`(`code`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`wage_type_code`) REFERENCES `py_wage_type`(`code`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ix_structure_component` ON `py_salary_structure_component` (`structure_code`);--> statement-breakpoint
CREATE TABLE `pa_it0011_statutory_details` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employee_id` integer NOT NULL,
	`uan` text,
	`esi_number` text,
	`professional_tax_state` text,
	`valid_from` text NOT NULL,
	`valid_to` text NOT NULL,
	`seq` integer DEFAULT 1 NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `pa_employee`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_statutory_slice` ON `pa_it0011_statutory_details` (`employee_id`,`valid_from`,`seq`);--> statement-breakpoint
CREATE TABLE `py_esi_rate` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`valid_from` text NOT NULL,
	`valid_to` text NOT NULL,
	`employee_rate_basis_points` integer DEFAULT 75 NOT NULL,
	`employer_rate_basis_points` integer DEFAULT 325 NOT NULL,
	`wage_ceiling_paise` integer DEFAULT 2100000 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_esi_rate_valid_from` ON `py_esi_rate` (`valid_from`);--> statement-breakpoint
CREATE TABLE `py_lwf_rate` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`state` text NOT NULL,
	`valid_from` text NOT NULL,
	`valid_to` text NOT NULL,
	`frequency` text DEFAULT 'HalfYearly' NOT NULL,
	`employee_amount_paise` integer NOT NULL,
	`employer_amount_paise` integer NOT NULL,
	`due_month` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ix_lwf_rate_state` ON `py_lwf_rate` (`state`,`valid_from`);--> statement-breakpoint
CREATE TABLE `py_pf_rate` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`valid_from` text NOT NULL,
	`valid_to` text NOT NULL,
	`employee_rate_basis_points` integer DEFAULT 1200 NOT NULL,
	`employer_rate_basis_points` integer DEFAULT 1200 NOT NULL,
	`eps_rate_basis_points` integer DEFAULT 833 NOT NULL,
	`edli_rate_basis_points` integer DEFAULT 50 NOT NULL,
	`admin_charge_basis_points` integer DEFAULT 50 NOT NULL,
	`wage_ceiling_paise` integer DEFAULT 1500000 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_pf_rate_valid_from` ON `py_pf_rate` (`valid_from`);--> statement-breakpoint
CREATE TABLE `py_professional_tax_slab` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`state` text NOT NULL,
	`valid_from` text NOT NULL,
	`valid_to` text NOT NULL,
	`from_paise` integer NOT NULL,
	`to_paise` integer,
	`amount_paise` integer NOT NULL,
	`is_february` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ix_pt_slab_state` ON `py_professional_tax_slab` (`state`,`valid_from`);--> statement-breakpoint
CREATE TABLE `py_tax_constant` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`financial_year` text NOT NULL,
	`regime` text NOT NULL,
	`standard_deduction_paise` integer NOT NULL,
	`rebate_87a_limit_paise` integer NOT NULL,
	`rebate_87a_max_paise` integer NOT NULL,
	`cess_basis_points` integer DEFAULT 400 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_tax_constant_year_regime` ON `py_tax_constant` (`financial_year`,`regime`);--> statement-breakpoint
UPDATE sec_permission SET description = 'keep wage types, recurring payments, one-off payments, salary structures, CTC, statutory rates, cost splits and GL mapping' WHERE code = 'payroll.setup';--> statement-breakpoint
UPDATE sec_permission SET description = 'read their own payslips and CTC breakdown' WHERE code = 'self.pay';