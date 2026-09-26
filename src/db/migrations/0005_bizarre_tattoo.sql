CREATE TABLE `pm_appraisal` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`cycle_id` integer NOT NULL,
	`employee_id` integer NOT NULL,
	`self_rating` integer,
	`self_comments` text,
	`manager_rating` integer,
	`manager_comments` text,
	`status` text DEFAULT 'Pending self review' NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`cycle_id`) REFERENCES `pm_appraisal_cycle`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`employee_id`) REFERENCES `pa_employee`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_appraisal_cycle_employee` ON `pm_appraisal` (`cycle_id`,`employee_id`);--> statement-breakpoint
CREATE TABLE `pm_appraisal_cycle` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`period_label` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`template_code` text NOT NULL,
	`status` text DEFAULT 'Draft' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`template_code`) REFERENCES `pm_appraisal_template`(`code`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ix_cycle_status` ON `pm_appraisal_cycle` (`status`);--> statement-breakpoint
CREATE TABLE `pm_appraisal_template` (
	`code` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`is_active` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE `pm_calibration` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`appraisal_id` integer NOT NULL,
	`calibrated_rating` integer,
	`committee_comments` text,
	`status` text DEFAULT 'Pending' NOT NULL,
	`finalised_by` text,
	`finalised_at` text,
	FOREIGN KEY (`appraisal_id`) REFERENCES `pm_appraisal`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pm_calibration_appraisal_id_unique` ON `pm_calibration` (`appraisal_id`);--> statement-breakpoint
CREATE INDEX `ix_calibration_status` ON `pm_calibration` (`status`);--> statement-breakpoint
CREATE TABLE `pm_goal` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`cycle_id` integer NOT NULL,
	`employee_id` integer NOT NULL,
	`category` text NOT NULL,
	`description` text NOT NULL,
	`weightage_percent` integer DEFAULT 0 NOT NULL,
	`target_date` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`cycle_id`) REFERENCES `pm_appraisal_cycle`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`employee_id`) REFERENCES `pa_employee`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ix_goal_cycle_employee` ON `pm_goal` (`cycle_id`,`employee_id`);--> statement-breakpoint
CREATE TABLE `pm_increment_recommendation` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`cycle_id` integer NOT NULL,
	`employee_id` integer NOT NULL,
	`final_rating` integer NOT NULL,
	`current_salary_paise` integer NOT NULL,
	`increment_basis_points` integer DEFAULT 0 NOT NULL,
	`new_salary_paise` integer NOT NULL,
	`effective_date` text NOT NULL,
	`status` text DEFAULT 'Draft' NOT NULL,
	`basic_pay_id` integer,
	`approved_by` text,
	`approved_at` text,
	`pushed_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`cycle_id`) REFERENCES `pm_appraisal_cycle`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`employee_id`) REFERENCES `pa_employee`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`basic_pay_id`) REFERENCES `pa_it0008_basic_pay`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_increment_cycle_employee` ON `pm_increment_recommendation` (`cycle_id`,`employee_id`);