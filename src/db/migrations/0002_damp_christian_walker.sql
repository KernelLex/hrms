CREATE TABLE `pt_it2001_absence` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employee_id` integer NOT NULL,
	`absence_type_code` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`payroll_days` integer NOT NULL,
	`calendar_days` integer NOT NULL,
	`is_half_day` integer DEFAULT false NOT NULL,
	`remarks` text,
	`source_request_id` integer,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `pa_employee`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`absence_type_code`) REFERENCES `pt_absence_type`(`code`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ix_absence_employee` ON `pt_it2001_absence` (`employee_id`,`start_date`);--> statement-breakpoint
CREATE INDEX `ix_absence_type` ON `pt_it2001_absence` (`absence_type_code`);--> statement-breakpoint
CREATE TABLE `pt_it2006_absence_quota` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employee_id` integer NOT NULL,
	`quota_type_code` text NOT NULL,
	`year` integer NOT NULL,
	`entitled_half_days` integer DEFAULT 0 NOT NULL,
	`used_half_days` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `pa_employee`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`quota_type_code`) REFERENCES `pt_quota_type`(`code`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_quota_employee_year` ON `pt_it2006_absence_quota` (`employee_id`,`quota_type_code`,`year`);--> statement-breakpoint
CREATE TABLE `pt_absence_type` (
	`code` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`is_paid` integer DEFAULT true NOT NULL,
	`counts_against_quota` integer DEFAULT true NOT NULL,
	`quota_type_code` text,
	`is_active` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE `pt_it2002_attendance` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employee_id` integer NOT NULL,
	`attendance_type_code` text NOT NULL,
	`date` text NOT NULL,
	`hours` integer NOT NULL,
	`remarks` text,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `pa_employee`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`attendance_type_code`) REFERENCES `pt_attendance_type`(`code`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ix_attendance_employee` ON `pt_it2002_attendance` (`employee_id`,`date`);--> statement-breakpoint
CREATE TABLE `pt_attendance_type` (
	`code` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`is_overtime` integer DEFAULT false NOT NULL,
	`is_active` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE `pt_holiday` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`date` text NOT NULL,
	`name` text NOT NULL,
	`region` text DEFAULT 'National' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_holiday_date_region` ON `pt_holiday` (`date`,`region`);--> statement-breakpoint
CREATE TABLE `pt_leave_request` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employee_id` integer NOT NULL,
	`absence_type_code` text NOT NULL,
	`from_date` text NOT NULL,
	`to_date` text NOT NULL,
	`is_half_day` integer DEFAULT false NOT NULL,
	`payroll_days` integer NOT NULL,
	`reason` text,
	`status` text DEFAULT 'Pending' NOT NULL,
	`submitted_at` text NOT NULL,
	`decided_by_employee_id` integer,
	`decided_at` text,
	`decision_note` text,
	FOREIGN KEY (`employee_id`) REFERENCES `pa_employee`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`absence_type_code`) REFERENCES `pt_absence_type`(`code`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ix_request_employee` ON `pt_leave_request` (`employee_id`,`status`);--> statement-breakpoint
CREATE INDEX `ix_request_status` ON `pt_leave_request` (`status`);--> statement-breakpoint
CREATE TABLE `pt_quota_type` (
	`code` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`default_entitlement_days` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE `pt_time_evaluation_result` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employee_id` integer NOT NULL,
	`period_year` integer NOT NULL,
	`period_month` integer NOT NULL,
	`working_days` integer NOT NULL,
	`present_days` integer NOT NULL,
	`absent_days` integer NOT NULL,
	`unpaid_days` integer DEFAULT 0 NOT NULL,
	`overtime_hours` integer DEFAULT 0 NOT NULL,
	`evaluated_at` text NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `pa_employee`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_timeeval_period` ON `pt_time_evaluation_result` (`employee_id`,`period_year`,`period_month`);