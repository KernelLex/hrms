PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_pt_holiday` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`date` text NOT NULL,
	`name` text NOT NULL,
	`calendar_code` text DEFAULT 'NATIONAL' NOT NULL,
	`is_optional` integer DEFAULT false NOT NULL,
	`year` integer NOT NULL,
	FOREIGN KEY (`calendar_code`) REFERENCES `pt_holiday_calendar`(`code`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`calendar_code`,`year`) REFERENCES `pt_holiday_year`(`calendar_code`,`year`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_pt_holiday`("id", "date", "name", "calendar_code", "is_optional", "year") SELECT "id", "date", "name", "calendar_code", "is_optional", "year" FROM `pt_holiday`;--> statement-breakpoint
DROP TABLE `pt_holiday`;--> statement-breakpoint
ALTER TABLE `__new_pt_holiday` RENAME TO `pt_holiday`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `ux_holiday_date_calendar` ON `pt_holiday` (`date`,`calendar_code`);--> statement-breakpoint
CREATE INDEX `ix_holiday_year` ON `pt_holiday` (`calendar_code`,`year`);--> statement-breakpoint
ALTER TABLE `pt_holiday_calendar` DROP COLUMN `optional_allowance`;