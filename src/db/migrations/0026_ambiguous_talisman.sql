CREATE TABLE `om_job_family` (
	`code` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE `om_level_type` (
	`code` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`parent_level_type_code` text,
	`rank` integer DEFAULT 0 NOT NULL,
	`is_payroll_group` integer DEFAULT false NOT NULL,
	`is_calendar_level` integer DEFAULT false NOT NULL,
	`is_cost_centre` integer DEFAULT false NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`parent_level_type_code`) REFERENCES `om_level_type`(`code`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_pa_it0001_org_assignment` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employee_id` integer NOT NULL,
	`company_code` text NOT NULL,
	`area_code` text,
	`sub_area_code` text,
	`org_unit_code` text NOT NULL,
	`position_code` text NOT NULL,
	`cost_center` text,
	`valid_from` text NOT NULL,
	`valid_to` text NOT NULL,
	`seq` integer DEFAULT 1 NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `pa_employee`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`company_code`) REFERENCES `om_company`(`code`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`org_unit_code`) REFERENCES `om_org_unit`(`code`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`position_code`) REFERENCES `om_position`(`code`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_pa_it0001_org_assignment`("id", "employee_id", "company_code", "area_code", "sub_area_code", "org_unit_code", "position_code", "cost_center", "valid_from", "valid_to", "seq", "created_by", "created_at") SELECT "id", "employee_id", "company_code", "area_code", "sub_area_code", "org_unit_code", "position_code", "cost_center", "valid_from", "valid_to", "seq", "created_by", "created_at" FROM `pa_it0001_org_assignment`;--> statement-breakpoint
DROP TABLE `pa_it0001_org_assignment`;--> statement-breakpoint
ALTER TABLE `__new_pa_it0001_org_assignment` RENAME TO `pa_it0001_org_assignment`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `ux_orgassign_slice` ON `pa_it0001_org_assignment` (`employee_id`,`valid_from`,`seq`);--> statement-breakpoint
CREATE INDEX `ix_orgassign_position` ON `pa_it0001_org_assignment` (`position_code`);--> statement-breakpoint
CREATE TABLE `__new_py_payroll_period` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`area_code` text NOT NULL,
	`node_code` text,
	`year` integer NOT NULL,
	`month` integer NOT NULL,
	`pay_date` text,
	`status` text DEFAULT 'Open' NOT NULL,
	`released_by` text,
	`released_at` text,
	`posted_at` text,
	`email_payslips` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`node_code`) REFERENCES `om_org_unit`(`code`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_py_payroll_period`("id", "area_code", "node_code", "year", "month", "pay_date", "status", "released_by", "released_at", "posted_at", "email_payslips") SELECT "id", "area_code", NULL, "year", "month", "pay_date", "status", "released_by", "released_at", "posted_at", "email_payslips" FROM `py_payroll_period`;--> statement-breakpoint
DROP TABLE `py_payroll_period`;--> statement-breakpoint
ALTER TABLE `__new_py_payroll_period` RENAME TO `py_payroll_period`;--> statement-breakpoint
CREATE UNIQUE INDEX `ux_period` ON `py_payroll_period` (`area_code`,`year`,`month`);--> statement-breakpoint
ALTER TABLE `om_company` ADD `parent_node_code` text REFERENCES om_org_unit(code);--> statement-breakpoint
ALTER TABLE `om_job` ADD `job_family_code` text REFERENCES om_job_family(code);--> statement-breakpoint
ALTER TABLE `om_org_unit` ADD `level_type_code` text REFERENCES om_level_type(code);--> statement-breakpoint
ALTER TABLE `om_org_unit` ADD `calendar_code` text REFERENCES pt_holiday_calendar(code);--> statement-breakpoint
CREATE INDEX `ix_orgunit_level` ON `om_org_unit` (`level_type_code`);--> statement-breakpoint
ALTER TABLE `pt_leave_policy` ADD `applies_to_node_code` text;