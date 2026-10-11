PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_py_payroll_period` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`node_code` text NOT NULL,
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
INSERT INTO `__new_py_payroll_period`("id", "node_code", "year", "month", "pay_date", "status", "released_by", "released_at", "posted_at", "email_payslips") SELECT "id", "node_code", "year", "month", "pay_date", "status", "released_by", "released_at", "posted_at", "email_payslips" FROM `py_payroll_period`;--> statement-breakpoint
DROP TABLE `py_payroll_period`;--> statement-breakpoint
ALTER TABLE `__new_py_payroll_period` RENAME TO `py_payroll_period`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `ux_period` ON `py_payroll_period` (`node_code`,`year`,`month`);--> statement-breakpoint
CREATE TABLE `__new_om_org_unit` (
	`code` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`parent_code` text,
	`company_code` text,
	`level_type_code` text DEFAULT 'DEPARTMENT' NOT NULL,
	`calendar_code` text,
	`valid_from` text NOT NULL,
	`valid_to` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`parent_code`) REFERENCES `om_org_unit`(`code`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`company_code`) REFERENCES `om_company`(`code`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`level_type_code`) REFERENCES `om_level_type`(`code`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`calendar_code`) REFERENCES `pt_holiday_calendar`(`code`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_om_org_unit`("code", "name", "parent_code", "company_code", "level_type_code", "calendar_code", "valid_from", "valid_to", "is_active") SELECT "code", "name", "parent_code", "company_code", "level_type_code", "calendar_code", "valid_from", "valid_to", "is_active" FROM `om_org_unit`;--> statement-breakpoint
DROP TABLE `om_org_unit`;--> statement-breakpoint
ALTER TABLE `__new_om_org_unit` RENAME TO `om_org_unit`;--> statement-breakpoint
CREATE INDEX `ix_orgunit_parent` ON `om_org_unit` (`parent_code`);--> statement-breakpoint
CREATE INDEX `ix_orgunit_company` ON `om_org_unit` (`company_code`);--> statement-breakpoint
CREATE INDEX `ix_orgunit_level` ON `om_org_unit` (`level_type_code`);--> statement-breakpoint
ALTER TABLE `om_job` DROP COLUMN `job_group`;--> statement-breakpoint
ALTER TABLE `pa_it0001_org_assignment` DROP COLUMN `area_code`;--> statement-breakpoint
ALTER TABLE `pa_it0001_org_assignment` DROP COLUMN `sub_area_code`;--> statement-breakpoint
ALTER TABLE `pt_leave_policy` DROP COLUMN `applies_to_area_code`;--> statement-breakpoint
DROP TABLE `om_personnel_sub_area`;--> statement-breakpoint
DROP TABLE `om_personnel_area`;--> statement-breakpoint
DROP TABLE `om_cost_centre`;