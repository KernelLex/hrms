ALTER TABLE `rc_application` ADD `channel` text DEFAULT 'Added by HR' NOT NULL;--> statement-breakpoint
ALTER TABLE `rc_application` ADD `cover_note` text;--> statement-breakpoint
ALTER TABLE `rc_application` ADD `rejected_by` text;--> statement-breakpoint
ALTER TABLE `rc_application` ADD `selected_at` text;--> statement-breakpoint
ALTER TABLE `rc_application` ADD `selected_by` text;--> statement-breakpoint
ALTER TABLE `rc_application` ADD `selection_note` text;--> statement-breakpoint
ALTER TABLE `rc_application` ADD `offered_at` text;--> statement-breakpoint
ALTER TABLE `rc_application` ADD `source_hash` text;--> statement-breakpoint
CREATE INDEX `ix_application_source` ON `rc_application` (`source_hash`,`applied_date`);--> statement-breakpoint
ALTER TABLE `rc_candidate` ADD `profile_link` text;--> statement-breakpoint
ALTER TABLE `rc_candidate` ADD `current_employer` text;--> statement-breakpoint
ALTER TABLE `rc_candidate` ADD `experience_years` integer;--> statement-breakpoint
ALTER TABLE `rc_candidate` ADD `notice_period_days` integer;--> statement-breakpoint
ALTER TABLE `rc_candidate` ADD `updated_at` text;--> statement-breakpoint
ALTER TABLE `rc_interview` ADD `interviewer_employee_id` integer REFERENCES pa_employee(id);--> statement-breakpoint
ALTER TABLE `rc_interview` ADD `duration_minutes` integer DEFAULT 60 NOT NULL;--> statement-breakpoint
ALTER TABLE `rc_interview` ADD `location` text;--> statement-breakpoint
ALTER TABLE `rc_interview` ADD `status` text DEFAULT 'Scheduled' NOT NULL;--> statement-breakpoint
ALTER TABLE `rc_interview` ADD `recommendation` text;--> statement-breakpoint
ALTER TABLE `rc_interview` ADD `completed_at` text;--> statement-breakpoint
ALTER TABLE `rc_interview` ADD `completed_by` text;--> statement-breakpoint
CREATE INDEX `ix_interview_interviewer` ON `rc_interview` (`interviewer_employee_id`,`scheduled_date`);--> statement-breakpoint
ALTER TABLE `rc_requisition` ADD `title` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `rc_requisition` ADD `description` text;--> statement-breakpoint
ALTER TABLE `rc_requisition` ADD `qualifications` text;--> statement-breakpoint
ALTER TABLE `rc_requisition` ADD `skills` text;--> statement-breakpoint
ALTER TABLE `rc_requisition` ADD `experience_min_years` integer;--> statement-breakpoint
ALTER TABLE `rc_requisition` ADD `experience_max_years` integer;--> statement-breakpoint
ALTER TABLE `rc_requisition` ADD `employment_type` text DEFAULT 'Full-time' NOT NULL;--> statement-breakpoint
ALTER TABLE `rc_requisition` ADD `work_mode` text DEFAULT 'On site' NOT NULL;--> statement-breakpoint
ALTER TABLE `rc_requisition` ADD `location` text;--> statement-breakpoint
ALTER TABLE `rc_requisition` ADD `budget_min_paise` integer;--> statement-breakpoint
ALTER TABLE `rc_requisition` ADD `budget_max_paise` integer;--> statement-breakpoint
ALTER TABLE `rc_requisition` ADD `hiring_manager_employee_id` integer REFERENCES pa_employee(id);--> statement-breakpoint
ALTER TABLE `rc_requisition` ADD `is_published` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `rc_requisition` ADD `updated_at` text;--> statement-breakpoint
CREATE INDEX `ix_requisition_published` ON `rc_requisition` (`is_published`,`status`);--> statement-breakpoint
-- Data, written by hand: the workflow's stages and the interviewer's permission.
-- Requisitions take their title from the position, and their location from its area.
UPDATE `rc_requisition` SET `title` = COALESCE((SELECT `title` FROM `om_position` WHERE `code` = `rc_requisition`.`position_code`), `code`) WHERE `title` = '';--> statement-breakpoint
UPDATE `rc_requisition` SET `location` = (SELECT a.`location` FROM `om_org_unit` u JOIN `om_personnel_area` a ON a.`code` = u.`area_code` WHERE u.`code` = `rc_requisition`.`org_unit_code`) WHERE `location` IS NULL;--> statement-breakpoint
-- Screened and Interviewed became one stage: Interviewing.
UPDATE `rc_application` SET `stage` = 'Interviewing' WHERE `stage` IN ('Screened', 'Interviewed');--> statement-breakpoint
UPDATE `rc_application` SET `offered_at` = `applied_date` WHERE `stage` IN ('Offered', 'Hired') AND `offered_at` IS NULL;--> statement-breakpoint
-- An interview with a rating or notes has happened.
UPDATE `rc_interview` SET `status` = 'Completed', `completed_at` = `created_at`, `completed_by` = 'migration' WHERE `rating` IS NOT NULL OR `feedback` IS NOT NULL;--> statement-breakpoint
-- Interviewers named exactly as an employee is become that employee.
UPDATE `rc_interview` SET `interviewer_employee_id` = (SELECT p.`employee_id` FROM `pa_it0002_personal_data` p WHERE p.`first_name` || ' ' || p.`last_name` = `rc_interview`.`interviewer` AND p.`valid_to` = '9999-12-31' LIMIT 1) WHERE `interviewer_employee_id` IS NULL;--> statement-breakpoint
INSERT OR IGNORE INTO `sec_permission` (`code`, `group_name`, `description`, `is_sensitive`) VALUES ('recruitment.interview', 'Recruitment', 'take the interviews assigned to them: see the candidate and the role, and record notes and a recommendation', 0);--> statement-breakpoint
INSERT OR IGNORE INTO `sec_role_permission` (`role_code`, `permission_code`) VALUES ('HR_ADMIN', 'recruitment.interview');--> statement-breakpoint
INSERT OR IGNORE INTO `sec_role_permission` (`role_code`, `permission_code`) VALUES ('MANAGER', 'recruitment.interview');--> statement-breakpoint
INSERT OR IGNORE INTO `sec_role_permission` (`role_code`, `permission_code`) VALUES ('EMPLOYEE', 'recruitment.interview');--> statement-breakpoint
INSERT OR IGNORE INTO `sec_role_permission` (`role_code`, `permission_code`) SELECT 'RECRUITER', 'recruitment.interview' WHERE EXISTS (SELECT 1 FROM `sec_role` WHERE `code` = 'RECRUITER');
