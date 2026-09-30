CREATE TABLE `pt_comp_off` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employee_id` integer NOT NULL,
	`earned_on` text NOT NULL,
	`expires_on` text NOT NULL,
	`half_days` integer DEFAULT 2 NOT NULL,
	`status` text DEFAULT 'Available' NOT NULL,
	`source_attendance_id` integer,
	`note` text,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `pa_employee`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_attendance_id`) REFERENCES `pt_it2002_attendance`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ix_compoff_employee` ON `pt_comp_off` (`employee_id`,`status`);--> statement-breakpoint
CREATE TABLE `pt_holiday_calendar` (
	`code` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE `pt_leave_policy` (
	`code` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`quota_type_code` text NOT NULL,
	`applies_to_grade` text,
	`applies_to_area_code` text,
	`entitlement_half_days_per_year` integer NOT NULL,
	`accrual_frequency` text DEFAULT 'Yearly' NOT NULL,
	`pro_rata_for_joiners` integer DEFAULT true NOT NULL,
	`carry_forward_cap_half_days` integer DEFAULT 0 NOT NULL,
	`lapse_on` text DEFAULT '03-31' NOT NULL,
	`encashable_half_days_per_year` integer DEFAULT 0 NOT NULL,
	`max_request_half_days` integer,
	`sandwich_rule` integer DEFAULT false NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`quota_type_code`) REFERENCES `pt_quota_type`(`code`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ix_policy_quota_type` ON `pt_leave_policy` (`quota_type_code`,`is_active`);--> statement-breakpoint
CREATE TABLE `pt_quota_ledger` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employee_id` integer NOT NULL,
	`quota_type_code` text NOT NULL,
	`year` integer NOT NULL,
	`entry_type` text NOT NULL,
	`half_days` integer NOT NULL,
	`note` text,
	`ref_type` text,
	`ref_id` text,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `pa_employee`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`quota_type_code`) REFERENCES `pt_quota_type`(`code`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ix_ledger_employee` ON `pt_quota_ledger` (`employee_id`,`quota_type_code`,`year`);--> statement-breakpoint
INSERT OR IGNORE INTO `pt_holiday_calendar` (`code`, `name`, `is_active`) VALUES ('NATIONAL', 'National', 1);--> statement-breakpoint
DROP INDEX `ux_holiday_date_region`;--> statement-breakpoint
ALTER TABLE `pt_holiday` ADD `calendar_code` text DEFAULT 'NATIONAL' NOT NULL REFERENCES pt_holiday_calendar(code);--> statement-breakpoint
CREATE UNIQUE INDEX `ux_holiday_date_calendar` ON `pt_holiday` (`date`,`calendar_code`);--> statement-breakpoint
ALTER TABLE `om_personnel_area` ADD `calendar_code` text DEFAULT 'NATIONAL' NOT NULL REFERENCES pt_holiday_calendar(code);--> statement-breakpoint
ALTER TABLE `pt_absence_type` ADD `is_comp_off` integer DEFAULT false NOT NULL;