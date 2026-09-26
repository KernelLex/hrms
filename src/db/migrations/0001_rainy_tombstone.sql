CREATE TABLE `pa_it0000_action` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employee_id` integer NOT NULL,
	`action_type` text NOT NULL,
	`reason` text,
	`valid_from` text NOT NULL,
	`valid_to` text NOT NULL,
	`seq` integer DEFAULT 1 NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `pa_employee`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ix_action_employee` ON `pa_it0000_action` (`employee_id`,`valid_from`);--> statement-breakpoint
CREATE TABLE `pa_it0006_address` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employee_id` integer NOT NULL,
	`address_type` text NOT NULL,
	`line` text NOT NULL,
	`city` text,
	`state` text,
	`postal_code` text,
	`country` text,
	`valid_from` text NOT NULL,
	`valid_to` text NOT NULL,
	`seq` integer DEFAULT 1 NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `pa_employee`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ix_address_employee` ON `pa_it0006_address` (`employee_id`,`valid_from`);--> statement-breakpoint
CREATE TABLE `pa_it0009_bank_details` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employee_id` integer NOT NULL,
	`bank_name` text NOT NULL,
	`account_number` text NOT NULL,
	`ifsc` text,
	`holder_name` text,
	`valid_from` text NOT NULL,
	`valid_to` text NOT NULL,
	`seq` integer DEFAULT 1 NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `pa_employee`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_bank_slice` ON `pa_it0009_bank_details` (`employee_id`,`valid_from`,`seq`);--> statement-breakpoint
CREATE TABLE `pa_it0008_basic_pay` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employee_id` integer NOT NULL,
	`pay_scale_type` text,
	`pay_scale_area` text,
	`pay_scale_group` text,
	`amount_paise` integer NOT NULL,
	`currency` text DEFAULT 'INR' NOT NULL,
	`source_ref` text,
	`valid_from` text NOT NULL,
	`valid_to` text NOT NULL,
	`seq` integer DEFAULT 1 NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `pa_employee`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_basicpay_slice` ON `pa_it0008_basic_pay` (`employee_id`,`valid_from`,`seq`);--> statement-breakpoint
CREATE TABLE `pa_it0105_communication` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employee_id` integer NOT NULL,
	`comm_type` text NOT NULL,
	`value` text NOT NULL,
	`valid_from` text NOT NULL,
	`valid_to` text NOT NULL,
	`seq` integer DEFAULT 1 NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `pa_employee`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ix_comm_employee` ON `pa_it0105_communication` (`employee_id`);--> statement-breakpoint
CREATE TABLE `pa_employee` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employee_number` text NOT NULL,
	`hire_date` text NOT NULL,
	`employment_status` text DEFAULT 'Active' NOT NULL,
	`termination_date` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pa_employee_employee_number_unique` ON `pa_employee` (`employee_number`);--> statement-breakpoint
CREATE INDEX `ix_employee_status` ON `pa_employee` (`employment_status`);--> statement-breakpoint
CREATE TABLE `pa_it0021_family_member` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employee_id` integer NOT NULL,
	`relationship` text NOT NULL,
	`name` text NOT NULL,
	`date_of_birth` text,
	`valid_from` text NOT NULL,
	`valid_to` text NOT NULL,
	`seq` integer DEFAULT 1 NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `pa_employee`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ix_family_employee` ON `pa_it0021_family_member` (`employee_id`);--> statement-breakpoint
CREATE TABLE `pa_it0001_org_assignment` (
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
	FOREIGN KEY (`area_code`) REFERENCES `om_personnel_area`(`code`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sub_area_code`) REFERENCES `om_personnel_sub_area`(`code`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`org_unit_code`) REFERENCES `om_org_unit`(`code`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`position_code`) REFERENCES `om_position`(`code`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_orgassign_slice` ON `pa_it0001_org_assignment` (`employee_id`,`valid_from`,`seq`);--> statement-breakpoint
CREATE INDEX `ix_orgassign_position` ON `pa_it0001_org_assignment` (`position_code`);--> statement-breakpoint
CREATE TABLE `pa_it0002_personal_data` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employee_id` integer NOT NULL,
	`first_name` text NOT NULL,
	`last_name` text NOT NULL,
	`date_of_birth` text,
	`gender` text,
	`marital_status` text,
	`nationality` text,
	`valid_from` text NOT NULL,
	`valid_to` text NOT NULL,
	`seq` integer DEFAULT 1 NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `pa_employee`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_personal_slice` ON `pa_it0002_personal_data` (`employee_id`,`valid_from`,`seq`);--> statement-breakpoint
CREATE TABLE `pa_it0007_planned_working_time` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employee_id` integer NOT NULL,
	`work_schedule_code` text NOT NULL,
	`weekly_hours` integer DEFAULT 40 NOT NULL,
	`employment_percent` integer DEFAULT 100 NOT NULL,
	`valid_from` text NOT NULL,
	`valid_to` text NOT NULL,
	`seq` integer DEFAULT 1 NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `pa_employee`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_pwt_slice` ON `pa_it0007_planned_working_time` (`employee_id`,`valid_from`,`seq`);--> statement-breakpoint
CREATE TABLE `pt_work_schedule_rule` (
	`code` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`weekly_hours` integer DEFAULT 40 NOT NULL,
	`working_days` text,
	`is_active` integer DEFAULT true NOT NULL
);
