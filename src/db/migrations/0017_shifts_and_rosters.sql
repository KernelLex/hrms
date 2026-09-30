CREATE TABLE `pt_attendance_day` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employee_id` integer NOT NULL,
	`date` text NOT NULL,
	`shift_code` text,
	`first_in` text,
	`last_out` text,
	`worked_minutes` integer DEFAULT 0 NOT NULL,
	`late_minutes` integer DEFAULT 0 NOT NULL,
	`overtime_minutes` integer DEFAULT 0 NOT NULL,
	`status` text NOT NULL,
	`finalised_at` text NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `pa_employee`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`shift_code`) REFERENCES `pt_shift`(`code`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_attendanceday_employee_date` ON `pt_attendance_day` (`employee_id`,`date`);--> statement-breakpoint
CREATE INDEX `ix_attendanceday_date` ON `pt_attendance_day` (`date`);--> statement-breakpoint
CREATE TABLE `pt_device` (
	`code` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`location` text,
	`client_pk` integer,
	`is_active` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`client_pk`) REFERENCES `int_client`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `pt_punch` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employee_id` integer NOT NULL,
	`device_code` text NOT NULL,
	`at` text NOT NULL,
	`direction` text NOT NULL,
	`source` text DEFAULT 'Device' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `pa_employee`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`device_code`) REFERENCES `pt_device`(`code`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_punch_device_at_employee` ON `pt_punch` (`device_code`,`at`,`employee_id`);--> statement-breakpoint
CREATE INDEX `ix_punch_employee` ON `pt_punch` (`employee_id`,`at`);--> statement-breakpoint
CREATE TABLE `pt_regularisation` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employee_id` integer NOT NULL,
	`date` text NOT NULL,
	`claimed_in` text,
	`claimed_out` text,
	`reason` text NOT NULL,
	`status` text DEFAULT 'Pending' NOT NULL,
	`submitted_at` text NOT NULL,
	`decided_by_employee_id` integer,
	`decided_at` text,
	`decision_note` text,
	FOREIGN KEY (`employee_id`) REFERENCES `pa_employee`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ix_regularisation_employee` ON `pt_regularisation` (`employee_id`,`status`);--> statement-breakpoint
CREATE INDEX `ix_regularisation_status` ON `pt_regularisation` (`status`);--> statement-breakpoint
CREATE TABLE `pt_roster` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employee_id` integer NOT NULL,
	`date` text NOT NULL,
	`shift_code` text,
	`pattern_code` text,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `pa_employee`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`shift_code`) REFERENCES `pt_shift`(`code`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`pattern_code`) REFERENCES `pt_roster_pattern`(`code`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_roster_employee_date` ON `pt_roster` (`employee_id`,`date`);--> statement-breakpoint
CREATE INDEX `ix_roster_date` ON `pt_roster` (`date`);--> statement-breakpoint
CREATE TABLE `pt_roster_pattern` (
	`code` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`cycle_length_days` integer NOT NULL,
	`is_active` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE `pt_roster_pattern_day` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`pattern_code` text NOT NULL,
	`day_index` integer NOT NULL,
	`shift_code` text,
	FOREIGN KEY (`pattern_code`) REFERENCES `pt_roster_pattern`(`code`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`shift_code`) REFERENCES `pt_shift`(`code`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_pattern_day` ON `pt_roster_pattern_day` (`pattern_code`,`day_index`);--> statement-breakpoint
CREATE TABLE `pt_shift` (
	`code` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`start_time` text NOT NULL,
	`end_time` text NOT NULL,
	`break_minutes` integer DEFAULT 0 NOT NULL,
	`is_night` integer DEFAULT false NOT NULL,
	`grace_minutes` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
INSERT OR IGNORE INTO `wf_flow` (`process`, `version`, `is_active`, `created_by`, `created_at`) VALUES ('regularisation', 1, 1, 'system', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));--> statement-breakpoint
INSERT OR IGNORE INTO `wf_step` (`flow_id`, `step_order`, `approver_type`) SELECT id, 1, 'reporting_manager' FROM wf_flow WHERE process = 'regularisation' AND version = 1;--> statement-breakpoint
INSERT OR IGNORE INTO `sec_permission` (`code`, `group_name`, `description`, `is_sensitive`) VALUES ('self.attendance', 'Self-service', 'see their own roster and attendance, and ask for a day to be corrected', 0);--> statement-breakpoint
UPDATE `sec_permission` SET `description` = 'record absences and attendance, generate quotas, run time evaluation, and keep schedules, holidays, shifts, rosters and devices' WHERE `code` = 'time.manage';--> statement-breakpoint
INSERT OR IGNORE INTO `sec_role_permission` (`role_code`, `permission_code`) VALUES ('HR_ADMIN', 'self.attendance');--> statement-breakpoint
INSERT OR IGNORE INTO `sec_role_permission` (`role_code`, `permission_code`) VALUES ('MANAGER', 'self.attendance');--> statement-breakpoint
INSERT OR IGNORE INTO `sec_role_permission` (`role_code`, `permission_code`) VALUES ('EMPLOYEE', 'self.attendance');--> statement-breakpoint
INSERT OR IGNORE INTO `pt_device` (`code`, `name`, `location`, `is_active`) VALUES ('CSV', 'CSV upload', NULL, 1);--> statement-breakpoint
INSERT OR IGNORE INTO `pt_device` (`code`, `name`, `location`, `is_active`) VALUES ('REGULARISED', 'Regularised entry', NULL, 1);
