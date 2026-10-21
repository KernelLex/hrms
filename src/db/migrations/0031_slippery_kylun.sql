CREATE TABLE `pt_holiday_year` (
	`calendar_code` text NOT NULL,
	`year` integer NOT NULL,
	`total_allowance` integer DEFAULT 12 NOT NULL,
	`is_published` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`calendar_code`, `year`),
	FOREIGN KEY (`calendar_code`) REFERENCES `pt_holiday_calendar`(`code`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `pt_holiday` ADD `year` integer;--> statement-breakpoint
CREATE INDEX `ix_holiday_year` ON `pt_holiday` (`calendar_code`,`year`);