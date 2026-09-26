CREATE TABLE `sec_app_user` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text NOT NULL,
	`password_hash` text NOT NULL,
	`display_name` text NOT NULL,
	`employee_id` integer,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sec_app_user_username_unique` ON `sec_app_user` (`username`);--> statement-breakpoint
CREATE TABLE `sec_role` (
	`code` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sec_user_role` (
	`user_id` integer NOT NULL,
	`role_code` text NOT NULL,
	PRIMARY KEY(`user_id`, `role_code`),
	FOREIGN KEY (`user_id`) REFERENCES `sec_app_user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`role_code`) REFERENCES `sec_role`(`code`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `om_company` (
	`code` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`address` text,
	`city` text,
	`country` text,
	`is_active` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE `om_job` (
	`code` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`job_group` text,
	`description` text,
	`is_active` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE `om_org_unit` (
	`code` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`parent_code` text,
	`company_code` text NOT NULL,
	`area_code` text,
	`valid_from` text NOT NULL,
	`valid_to` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`parent_code`) REFERENCES `om_org_unit`(`code`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`company_code`) REFERENCES `om_company`(`code`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`area_code`) REFERENCES `om_personnel_area`(`code`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ix_orgunit_parent` ON `om_org_unit` (`parent_code`);--> statement-breakpoint
CREATE INDEX `ix_orgunit_company` ON `om_org_unit` (`company_code`);--> statement-breakpoint
CREATE TABLE `om_personnel_area` (
	`code` text PRIMARY KEY NOT NULL,
	`company_code` text NOT NULL,
	`name` text NOT NULL,
	`location` text,
	`is_active` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`company_code`) REFERENCES `om_company`(`code`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ix_area_company` ON `om_personnel_area` (`company_code`);--> statement-breakpoint
CREATE TABLE `om_personnel_sub_area` (
	`code` text PRIMARY KEY NOT NULL,
	`area_code` text NOT NULL,
	`name` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`area_code`) REFERENCES `om_personnel_area`(`code`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ix_subarea_area` ON `om_personnel_sub_area` (`area_code`);--> statement-breakpoint
CREATE TABLE `om_position` (
	`code` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`org_unit_code` text NOT NULL,
	`job_code` text NOT NULL,
	`reports_to_code` text,
	`is_manager` integer DEFAULT false NOT NULL,
	`is_vacant` integer DEFAULT true NOT NULL,
	`valid_from` text NOT NULL,
	`valid_to` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`org_unit_code`) REFERENCES `om_org_unit`(`code`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`job_code`) REFERENCES `om_job`(`code`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reports_to_code`) REFERENCES `om_position`(`code`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ix_position_orgunit` ON `om_position` (`org_unit_code`);--> statement-breakpoint
CREATE INDEX `ix_position_reportsto` ON `om_position` (`reports_to_code`);--> statement-breakpoint
CREATE TABLE `om_reporting_line` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`position_code` text NOT NULL,
	`reports_to_code` text NOT NULL,
	`effective_from` text NOT NULL,
	`remarks` text,
	FOREIGN KEY (`position_code`) REFERENCES `om_position`(`code`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reports_to_code`) REFERENCES `om_position`(`code`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ix_reportingline_position` ON `om_reporting_line` (`position_code`);