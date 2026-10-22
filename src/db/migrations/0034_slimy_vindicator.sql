CREATE TABLE `tds_declaration_line` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`declaration_id` integer NOT NULL,
	`component_code` text NOT NULL,
	`declared_paise` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`declaration_id`) REFERENCES `tds_employee_declaration`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ix_declaration_line` ON `tds_declaration_line` (`declaration_id`,`component_code`);--> statement-breakpoint
CREATE TABLE `tx_city_category` (
	`country` text NOT NULL,
	`city` text NOT NULL,
	`category` text NOT NULL,
	PRIMARY KEY(`country`, `city`)
);
--> statement-breakpoint
CREATE TABLE `tx_company_component` (
	`company_code` text NOT NULL,
	`component_code` text NOT NULL,
	`is_enabled` integer DEFAULT true NOT NULL,
	`cap_override_paise` integer,
	PRIMARY KEY(`company_code`, `component_code`),
	FOREIGN KEY (`company_code`) REFERENCES `om_company`(`code`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `tx_component` (
	`country` text NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`cap_paise` integer,
	`requires_proof` integer DEFAULT true NOT NULL,
	`is_derived` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	PRIMARY KEY(`country`, `code`)
);
--> statement-breakpoint
ALTER TABLE `tds_rent` ADD `accommodation_type` text DEFAULT 'Rented' NOT NULL;