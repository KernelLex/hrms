CREATE TABLE `rc_offer` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`application_id` integer NOT NULL,
	`ctc_paise` integer NOT NULL,
	`structure_code` text NOT NULL,
	`joining_date` text NOT NULL,
	`expiry_date` text NOT NULL,
	`letter_text` text NOT NULL,
	`status` text DEFAULT 'Sent' NOT NULL,
	`token` text NOT NULL,
	`sent_at` text NOT NULL,
	`responded_at` text,
	`responded_ip` text,
	`created_by` text NOT NULL,
	FOREIGN KEY (`application_id`) REFERENCES `rc_application`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`structure_code`) REFERENCES `py_salary_structure`(`code`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rc_offer_token_unique` ON `rc_offer` (`token`);--> statement-breakpoint
CREATE INDEX `ix_offer_application` ON `rc_offer` (`application_id`);--> statement-breakpoint
CREATE TABLE `rc_referral` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`referrer_employee_id` integer NOT NULL,
	`candidate_id` integer NOT NULL,
	`bonus_paise` integer NOT NULL,
	`qualifying_days` integer DEFAULT 90 NOT NULL,
	`status` text DEFAULT 'Pending' NOT NULL,
	`paid_at` text,
	`additional_payment_id` integer,
	`created_at` text NOT NULL,
	FOREIGN KEY (`referrer_employee_id`) REFERENCES `pa_employee`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`candidate_id`) REFERENCES `rc_candidate`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`additional_payment_id`) REFERENCES `py_it0015_additional_payment`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_referral_candidate` ON `rc_referral` (`candidate_id`);--> statement-breakpoint
CREATE TABLE `rc_scorecard` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`interview_id` integer NOT NULL,
	`criterion` text NOT NULL,
	`rating` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`interview_id`) REFERENCES `rc_interview`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_scorecard_round` ON `rc_scorecard` (`interview_id`,`criterion`);--> statement-breakpoint
CREATE TABLE `rc_scorecard_template` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_code` text NOT NULL,
	`criterion` text NOT NULL,
	`weight` integer DEFAULT 1 NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`job_code`) REFERENCES `om_job`(`code`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_scorecard_template` ON `rc_scorecard_template` (`job_code`,`criterion`);