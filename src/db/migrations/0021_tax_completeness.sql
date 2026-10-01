CREATE TABLE `tds_arrears_relief` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employee_id` integer NOT NULL,
	`financial_year` text NOT NULL,
	`relates_to_year` text NOT NULL,
	`arrears_paise` integer NOT NULL,
	`tax_with_arrears_this_year_paise` integer NOT NULL,
	`tax_without_arrears_this_year_paise` integer NOT NULL,
	`tax_with_arrears_that_year_paise` integer NOT NULL,
	`tax_without_arrears_that_year_paise` integer NOT NULL,
	`relief_paise` integer NOT NULL,
	`computed_at` text NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `pa_employee`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_arrears_relief_employee_years` ON `tds_arrears_relief` (`employee_id`,`financial_year`,`relates_to_year`);--> statement-breakpoint
CREATE TABLE `tds_perquisite` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employee_id` integer NOT NULL,
	`financial_year` text NOT NULL,
	`perquisite_type` text NOT NULL,
	`source` text NOT NULL,
	`amount_paise` integer NOT NULL,
	`computed_at` text NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `pa_employee`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_perquisite_source` ON `tds_perquisite` (`source`,`financial_year`);--> statement-breakpoint
CREATE INDEX `ix_perquisite_employee_year` ON `tds_perquisite` (`employee_id`,`financial_year`);--> statement-breakpoint
CREATE TABLE `tds_proof` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employee_id` integer NOT NULL,
	`financial_year` text NOT NULL,
	`section` text NOT NULL,
	`amount_paise` integer NOT NULL,
	`document_id` integer,
	`status` text DEFAULT 'Pending' NOT NULL,
	`note` text,
	`verified_by` text,
	`verified_at` text,
	`submitted_at` text NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `pa_employee`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`document_id`) REFERENCES `app_document`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ix_proof_employee_year` ON `tds_proof` (`employee_id`,`financial_year`,`section`);--> statement-breakpoint
CREATE TABLE `tds_proof_window` (
	`financial_year` text PRIMARY KEY NOT NULL,
	`opens_at` text NOT NULL,
	`closes_at` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tds_rent` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employee_id` integer NOT NULL,
	`financial_year` text NOT NULL,
	`monthly_rent_paise` integer NOT NULL,
	`landlord_name` text NOT NULL,
	`landlord_pan` text,
	`is_metro` integer DEFAULT false NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `pa_employee`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_rent_employee_year` ON `tds_rent` (`employee_id`,`financial_year`);--> statement-breakpoint
ALTER TABLE `pa_it0011_statutory_details` ADD `pan` text;