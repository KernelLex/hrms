CREATE TABLE `rp_schedule` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`report_name` text NOT NULL,
	`filters` text,
	`recipients` text NOT NULL,
	`frequency` text DEFAULT 'Monthly' NOT NULL,
	`format` text DEFAULT 'CSV' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`last_run_at` text
);
--> statement-breakpoint
CREATE TABLE `rp_snapshot` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`month` text NOT NULL,
	`measure` text NOT NULL,
	`dimension` text DEFAULT 'ALL' NOT NULL,
	`dimension_type` text DEFAULT 'company' NOT NULL,
	`value` integer NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_snapshot_month_measure_dimension` ON `rp_snapshot` (`month`,`measure`,`dimension`);--> statement-breakpoint
CREATE INDEX `ix_snapshot_measure` ON `rp_snapshot` (`measure`,`month`);