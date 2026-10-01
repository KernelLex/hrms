CREATE TABLE `ld_certification` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employee_id` integer NOT NULL,
	`name` text NOT NULL,
	`issuer` text,
	`issued_date` text NOT NULL,
	`expiry_date` text,
	`document_id` integer,
	`reminded_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `pa_employee`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`document_id`) REFERENCES `app_document`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ix_certification_employee` ON `ld_certification` (`employee_id`);--> statement-breakpoint
CREATE INDEX `ix_certification_expiry` ON `ld_certification` (`expiry_date`);--> statement-breakpoint
CREATE TABLE `ld_certification_requirement` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_code` text NOT NULL,
	`name` text NOT NULL,
	FOREIGN KEY (`job_code`) REFERENCES `om_job`(`code`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_requirement_job_name` ON `ld_certification_requirement` (`job_code`,`name`);--> statement-breakpoint
CREATE TABLE `ld_course` (
	`code` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`cost_paise` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ld_department_budget` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`org_unit_code` text NOT NULL,
	`year` integer NOT NULL,
	`allocated_paise` integer NOT NULL,
	FOREIGN KEY (`org_unit_code`) REFERENCES `om_org_unit`(`code`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_budget_unit_year` ON `ld_department_budget` (`org_unit_code`,`year`);--> statement-breakpoint
CREATE TABLE `ld_nomination` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` integer NOT NULL,
	`employee_id` integer NOT NULL,
	`status` text DEFAULT 'Requested' NOT NULL,
	`attended` integer,
	`feedback` text,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`decided_by` text,
	`decided_at` text,
	FOREIGN KEY (`session_id`) REFERENCES `ld_session`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`employee_id`) REFERENCES `pa_employee`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_nomination_session_employee` ON `ld_nomination` (`session_id`,`employee_id`);--> statement-breakpoint
CREATE TABLE `ld_session` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`course_code` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`capacity` integer NOT NULL,
	`place` text,
	`cost_paise` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`course_code`) REFERENCES `ld_course`(`code`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ix_session_course` ON `ld_session` (`course_code`);--> statement-breakpoint
CREATE TABLE `pm_feedback` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`request_id` integer NOT NULL,
	`competency` text NOT NULL,
	`rating` integer,
	`comments` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`request_id`) REFERENCES `pm_feedback_request`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_feedback_request_competency` ON `pm_feedback` (`request_id`,`competency`);--> statement-breakpoint
CREATE TABLE `pm_feedback_request` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`cycle_id` integer NOT NULL,
	`reviewee_employee_id` integer NOT NULL,
	`reviewer_employee_id` integer NOT NULL,
	`relationship` text NOT NULL,
	`status` text DEFAULT 'Requested' NOT NULL,
	`requested_by` text NOT NULL,
	`requested_at` text NOT NULL,
	FOREIGN KEY (`cycle_id`) REFERENCES `pm_appraisal_cycle`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reviewee_employee_id`) REFERENCES `pa_employee`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reviewer_employee_id`) REFERENCES `pa_employee`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_feedback_request` ON `pm_feedback_request` (`cycle_id`,`reviewee_employee_id`,`reviewer_employee_id`);--> statement-breakpoint
CREATE TABLE `pm_goal_checkin` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`goal_id` integer NOT NULL,
	`checkin_date` text NOT NULL,
	`status` text NOT NULL,
	`comment` text NOT NULL,
	`author_type` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`goal_id`) REFERENCES `pm_goal`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ix_checkin_goal` ON `pm_goal_checkin` (`goal_id`,`checkin_date`);--> statement-breakpoint
CREATE TABLE `pm_pip` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employee_id` integer NOT NULL,
	`reason` text NOT NULL,
	`goals` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`outcome` text DEFAULT 'Ongoing' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`closed_by` text,
	`closed_at` text,
	FOREIGN KEY (`employee_id`) REFERENCES `pa_employee`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ix_pip_employee` ON `pm_pip` (`employee_id`);--> statement-breakpoint
CREATE TABLE `pm_pip_checkin` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`pip_id` integer NOT NULL,
	`note` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`pip_id`) REFERENCES `pm_pip`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ix_pip_checkin_pip` ON `pm_pip_checkin` (`pip_id`);--> statement-breakpoint
INSERT OR IGNORE INTO `sec_permission` (`code`, `group_name`, `description`, `is_sensitive`) VALUES ('training.manage', 'Performance', 'keep the training catalogue, decide nominations and budgets, and see the certification compliance report', 0);--> statement-breakpoint
INSERT OR IGNORE INTO `sec_permission` (`code`, `group_name`, `description`, `is_sensitive`) VALUES ('self.training', 'Self-service', 'nominate themselves for training, see their own training and certifications', 0);--> statement-breakpoint
INSERT OR IGNORE INTO `sec_role_permission` (`role_code`, `permission_code`) VALUES ('HR_ADMIN', 'training.manage');--> statement-breakpoint
INSERT OR IGNORE INTO `sec_role_permission` (`role_code`, `permission_code`) VALUES ('HR_ADMIN', 'self.training');--> statement-breakpoint
INSERT OR IGNORE INTO `sec_role_permission` (`role_code`, `permission_code`) VALUES ('MANAGER', 'self.training');--> statement-breakpoint
INSERT OR IGNORE INTO `sec_role_permission` (`role_code`, `permission_code`) VALUES ('EMPLOYEE', 'self.training');