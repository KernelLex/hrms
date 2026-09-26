CREATE TABLE `rc_application` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`candidate_id` integer NOT NULL,
	`requisition_id` integer NOT NULL,
	`stage` text DEFAULT 'Applied' NOT NULL,
	`applied_date` text NOT NULL,
	`rejected_reason` text,
	`rejected_at` text,
	`offered_salary_paise` integer,
	FOREIGN KEY (`candidate_id`) REFERENCES `rc_candidate`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`requisition_id`) REFERENCES `rc_requisition`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_application_candidate_req` ON `rc_application` (`candidate_id`,`requisition_id`);--> statement-breakpoint
CREATE INDEX `ix_application_stage` ON `rc_application` (`stage`);--> statement-breakpoint
CREATE TABLE `rc_application_stage_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`application_id` integer NOT NULL,
	`from_stage` text,
	`to_stage` text NOT NULL,
	`changed_by` text NOT NULL,
	`changed_at` text NOT NULL,
	`note` text,
	FOREIGN KEY (`application_id`) REFERENCES `rc_application`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ix_stagehistory_application` ON `rc_application_stage_history` (`application_id`);--> statement-breakpoint
CREATE TABLE `rc_candidate` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`full_name` text NOT NULL,
	`email` text NOT NULL,
	`phone` text,
	`source` text DEFAULT 'Job portal' NOT NULL,
	`resume_link` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rc_candidate_code_unique` ON `rc_candidate` (`code`);--> statement-breakpoint
CREATE INDEX `ix_candidate_email` ON `rc_candidate` (`email`);--> statement-breakpoint
CREATE TABLE `rc_hire_conversion` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`application_id` integer NOT NULL,
	`employee_id` integer NOT NULL,
	`hire_date` text NOT NULL,
	`offered_salary_paise` integer NOT NULL,
	`converted_by` text NOT NULL,
	`converted_at` text NOT NULL,
	FOREIGN KEY (`application_id`) REFERENCES `rc_application`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`employee_id`) REFERENCES `pa_employee`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `rc_interview` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`application_id` integer NOT NULL,
	`round` text NOT NULL,
	`interviewer` text NOT NULL,
	`scheduled_date` text NOT NULL,
	`scheduled_time` text,
	`mode` text DEFAULT 'Video call' NOT NULL,
	`rating` integer,
	`feedback` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`application_id`) REFERENCES `rc_application`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ix_interview_application` ON `rc_interview` (`application_id`);--> statement-breakpoint
CREATE TABLE `rc_requisition` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`position_code` text NOT NULL,
	`org_unit_code` text NOT NULL,
	`job_code` text NOT NULL,
	`openings` integer DEFAULT 1 NOT NULL,
	`priority` text DEFAULT 'Medium' NOT NULL,
	`posted_date` text NOT NULL,
	`target_close_date` text,
	`status` text DEFAULT 'Open' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`position_code`) REFERENCES `om_position`(`code`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`org_unit_code`) REFERENCES `om_org_unit`(`code`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`job_code`) REFERENCES `om_job`(`code`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rc_requisition_code_unique` ON `rc_requisition` (`code`);--> statement-breakpoint
CREATE INDEX `ix_requisition_position` ON `rc_requisition` (`position_code`);