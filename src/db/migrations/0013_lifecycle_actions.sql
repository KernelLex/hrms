CREATE TABLE `pa_checklist` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employee_id` integer NOT NULL,
	`template_id` integer,
	`event` text DEFAULT 'onboarding' NOT NULL,
	`started_at` text NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`employee_id`) REFERENCES `pa_employee`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`template_id`) REFERENCES `pa_checklist_template`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_checklist_employee_event` ON `pa_checklist` (`employee_id`,`event`);--> statement-breakpoint
CREATE TABLE `pa_checklist_item` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`template_id` integer NOT NULL,
	`task` text NOT NULL,
	`owner_type` text NOT NULL,
	`due_days` integer DEFAULT 7 NOT NULL,
	`sort_order` integer DEFAULT 100 NOT NULL,
	FOREIGN KEY (`template_id`) REFERENCES `pa_checklist_template`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ix_checklist_item_template` ON `pa_checklist_item` (`template_id`);--> statement-breakpoint
CREATE TABLE `pa_checklist_template` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event` text DEFAULT 'onboarding' NOT NULL,
	`name` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ix_checklist_template_event` ON `pa_checklist_template` (`event`,`is_active`);--> statement-breakpoint
CREATE TABLE `pa_letter` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employee_id` integer NOT NULL,
	`template_id` integer NOT NULL,
	`kind` text NOT NULL,
	`issue_date` text NOT NULL,
	`merged_text` text NOT NULL,
	`document_id` integer,
	`issued_by` text NOT NULL,
	`issued_at` text NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `pa_employee`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`template_id`) REFERENCES `pa_letter_template`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`document_id`) REFERENCES `app_document`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ix_letter_employee` ON `pa_letter` (`employee_id`);--> statement-breakpoint
CREATE TABLE `pa_letter_template` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`version` integer NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`body` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_letter_template_version` ON `pa_letter_template` (`kind`,`version`);--> statement-breakpoint
CREATE TABLE `pa_it0019_monitoring` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employee_id` integer NOT NULL,
	`monitoring_type` text NOT NULL,
	`date` text NOT NULL,
	`status` text DEFAULT 'Pending' NOT NULL,
	`note` text,
	`reminded_at` text,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `pa_employee`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ix_monitoring_employee` ON `pa_it0019_monitoring` (`employee_id`,`monitoring_type`,`status`);--> statement-breakpoint
CREATE TABLE `pa_task` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`checklist_id` integer NOT NULL,
	`task` text NOT NULL,
	`owner_type` text NOT NULL,
	`assigned_user_id` integer,
	`due_date` text NOT NULL,
	`status` text DEFAULT 'Pending' NOT NULL,
	`done_by_user_id` integer,
	`done_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`checklist_id`) REFERENCES `pa_checklist`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ix_task_checklist` ON `pa_task` (`checklist_id`);--> statement-breakpoint
CREATE INDEX `ix_task_assignee` ON `pa_task` (`assigned_user_id`,`status`);