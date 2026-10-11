ALTER TABLE `om_company` ADD `currency` text DEFAULT 'INR' NOT NULL;--> statement-breakpoint
ALTER TABLE `om_company` ADD `fiscal_year_start` text DEFAULT '04-01' NOT NULL;--> statement-breakpoint
ALTER TABLE `om_job` ADD `grade` text;--> statement-breakpoint
ALTER TABLE `om_level_type` ADD `is_business_centre` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `om_org_unit` ADD `centre_type` text;
--> statement-breakpoint
/*
 The business-centre level is the one the reference design classifies as a
 profit centre or shared services, so the level migration 0027 created for it
 gains the flag. Existing centres are left unclassified rather than guessed
 at: the first person to edit one is asked which it is.
*/
UPDATE `om_level_type` SET `is_business_centre` = 1 WHERE `code` = 'CENTER';
