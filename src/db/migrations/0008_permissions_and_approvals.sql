CREATE TABLE `sec_permission` (
	`code` text PRIMARY KEY NOT NULL,
	`group_name` text NOT NULL,
	`description` text NOT NULL,
	`is_sensitive` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sec_role_permission` (
	`role_code` text NOT NULL,
	`permission_code` text NOT NULL,
	PRIMARY KEY(`role_code`, `permission_code`),
	FOREIGN KEY (`role_code`) REFERENCES `sec_role`(`code`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`permission_code`) REFERENCES `sec_permission`(`code`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `sec_role_scope` (
	`role_code` text NOT NULL,
	`scope_type` text NOT NULL,
	`scope_code` text NOT NULL,
	PRIMARY KEY(`role_code`, `scope_type`, `scope_code`),
	FOREIGN KEY (`role_code`) REFERENCES `sec_role`(`code`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `wf_action` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`request_id` integer NOT NULL,
	`step_order` integer NOT NULL,
	`actor_type` text NOT NULL,
	`actor_user_id` integer,
	`actor_name` text NOT NULL,
	`on_behalf_of_user_id` integer,
	`on_behalf_of_name` text,
	`decision` text NOT NULL,
	`comment` text,
	`at` text NOT NULL,
	FOREIGN KEY (`request_id`) REFERENCES `wf_request`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ix_wf_action_request` ON `wf_action` (`request_id`);--> statement-breakpoint
CREATE TABLE `wf_assignee` (
	`request_id` integer NOT NULL,
	`step_order` integer NOT NULL,
	`user_id` integer NOT NULL,
	`reason` text DEFAULT 'step' NOT NULL,
	PRIMARY KEY(`request_id`, `step_order`, `user_id`),
	FOREIGN KEY (`request_id`) REFERENCES `wf_request`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ix_wf_assignee_user` ON `wf_assignee` (`user_id`);--> statement-breakpoint
CREATE TABLE `wf_delegation` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`from_user_id` integer NOT NULL,
	`to_user_id` integer NOT NULL,
	`from_date` text NOT NULL,
	`to_date` text NOT NULL,
	`processes` text,
	`created_at` text NOT NULL,
	`ended_at` text
);
--> statement-breakpoint
CREATE INDEX `ix_wf_delegation_to` ON `wf_delegation` (`to_user_id`,`from_date`,`to_date`);--> statement-breakpoint
CREATE TABLE `wf_flow` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`process` text NOT NULL,
	`version` integer NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_wf_flow_version` ON `wf_flow` (`process`,`version`);--> statement-breakpoint
CREATE TABLE `wf_request` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`process` text NOT NULL,
	`flow_id` integer NOT NULL,
	`subject_type` text NOT NULL,
	`subject_id` text NOT NULL,
	`subject_employee_id` integer,
	`requester_user_id` integer,
	`summary` text NOT NULL,
	`facts` text,
	`status` text DEFAULT 'Pending' NOT NULL,
	`current_step` integer NOT NULL,
	`step_started_at` text NOT NULL,
	`created_at` text NOT NULL,
	`decided_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_wf_request_subject` ON `wf_request` (`subject_type`,`subject_id`);--> statement-breakpoint
CREATE INDEX `ix_wf_request_status` ON `wf_request` (`status`,`process`);--> statement-breakpoint
CREATE TABLE `wf_step` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`flow_id` integer NOT NULL,
	`step_order` integer NOT NULL,
	`approver_type` text NOT NULL,
	`approver_role` text,
	`approver_user_id` integer,
	`condition_field` text,
	`condition_min` real,
	`escalate_after_days` integer,
	FOREIGN KEY (`flow_id`) REFERENCES `wf_flow`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_wf_step_order` ON `wf_step` (`flow_id`,`step_order`);--> statement-breakpoint
ALTER TABLE `sec_role` ADD `description` text;--> statement-breakpoint
ALTER TABLE `sec_role` ADD `is_built_in` integer DEFAULT false NOT NULL;
--> statement-breakpoint
-- Hand-written from here: the permission catalogue and the built-in roles
-- (src/lib/permissions.ts), the first leave flow, and pending leave moved
-- onto the approval engine (src/lib/workflow/adopt.ts).
INSERT OR IGNORE INTO `sec_permission` (`code`, `group_name`, `description`, `is_sensitive`) VALUES ('org.view', 'Organisation', 'see the org structure: companies, locations, departments, positions and the chart', 0);--> statement-breakpoint
INSERT OR IGNORE INTO `sec_permission` (`code`, `group_name`, `description`, `is_sensitive`) VALUES ('org.edit', 'Organisation', 'change the org structure', 0);--> statement-breakpoint
INSERT OR IGNORE INTO `sec_permission` (`code`, `group_name`, `description`, `is_sensitive`) VALUES ('employee.view_all', 'People', 'see every employee''s record', 0);--> statement-breakpoint
INSERT OR IGNORE INTO `sec_permission` (`code`, `group_name`, `description`, `is_sensitive`) VALUES ('employee.view_team', 'People', 'see the people who report to them, without pay', 0);--> statement-breakpoint
INSERT OR IGNORE INTO `sec_permission` (`code`, `group_name`, `description`, `is_sensitive`) VALUES ('employee.edit', 'People', 'hire people and change employee records, including mass updates', 0);--> statement-breakpoint
INSERT OR IGNORE INTO `sec_permission` (`code`, `group_name`, `description`, `is_sensitive`) VALUES ('employee.documents', 'People', 'file and remove employee documents', 0);--> statement-breakpoint
INSERT OR IGNORE INTO `sec_permission` (`code`, `group_name`, `description`, `is_sensitive`) VALUES ('pay.view', 'People', 'see salaries and pay', 1);--> statement-breakpoint
INSERT OR IGNORE INTO `sec_permission` (`code`, `group_name`, `description`, `is_sensitive`) VALUES ('bank.view', 'People', 'see bank account details', 1);--> statement-breakpoint
INSERT OR IGNORE INTO `sec_permission` (`code`, `group_name`, `description`, `is_sensitive`) VALUES ('time.manage', 'Time and leave', 'record absences and attendance, generate quotas, run time evaluation, and keep schedules and holidays', 0);--> statement-breakpoint
INSERT OR IGNORE INTO `sec_permission` (`code`, `group_name`, `description`, `is_sensitive`) VALUES ('time.team_calendar', 'Time and leave', 'see who is away across their team', 0);--> statement-breakpoint
INSERT OR IGNORE INTO `sec_permission` (`code`, `group_name`, `description`, `is_sensitive`) VALUES ('leave.decide_any', 'Time and leave', 'decide any leave request, whoever it is waiting for', 0);--> statement-breakpoint
INSERT OR IGNORE INTO `sec_permission` (`code`, `group_name`, `description`, `is_sensitive`) VALUES ('payroll.view', 'Payroll', 'see payroll periods, runs and results', 1);--> statement-breakpoint
INSERT OR IGNORE INTO `sec_permission` (`code`, `group_name`, `description`, `is_sensitive`) VALUES ('payroll.setup', 'Payroll', 'keep wage types, recurring payments and one-off payments', 0);--> statement-breakpoint
INSERT OR IGNORE INTO `sec_permission` (`code`, `group_name`, `description`, `is_sensitive`) VALUES ('payroll.run', 'Payroll', 'run payroll, including off-cycle runs', 0);--> statement-breakpoint
INSERT OR IGNORE INTO `sec_permission` (`code`, `group_name`, `description`, `is_sensitive`) VALUES ('payroll.post', 'Payroll', 'release and post periods, and make bank files, ledger postings and remittances', 0);--> statement-breakpoint
INSERT OR IGNORE INTO `sec_permission` (`code`, `group_name`, `description`, `is_sensitive`) VALUES ('tax.manage', 'Tax', 'keep tax sections and slabs, everyone''s declarations, the TDS register and Form 16', 0);--> statement-breakpoint
INSERT OR IGNORE INTO `sec_permission` (`code`, `group_name`, `description`, `is_sensitive`) VALUES ('recruitment.manage', 'Recruitment', 'manage requisitions, candidates, the pipeline and interviews', 0);--> statement-breakpoint
INSERT OR IGNORE INTO `sec_permission` (`code`, `group_name`, `description`, `is_sensitive`) VALUES ('recruitment.hire', 'Recruitment', 'turn an offered candidate into an employee, with their starting pay', 1);--> statement-breakpoint
INSERT OR IGNORE INTO `sec_permission` (`code`, `group_name`, `description`, `is_sensitive`) VALUES ('performance.manage', 'Performance', 'run appraisal cycles, calibration and increments', 1);--> statement-breakpoint
INSERT OR IGNORE INTO `sec_permission` (`code`, `group_name`, `description`, `is_sensitive`) VALUES ('performance.rate_team', 'Performance', 'set goals for and rate the people who report to them', 0);--> statement-breakpoint
INSERT OR IGNORE INTO `sec_permission` (`code`, `group_name`, `description`, `is_sensitive`) VALUES ('performance.rate_any', 'Performance', 'set goals for and rate anyone', 0);--> statement-breakpoint
INSERT OR IGNORE INTO `sec_permission` (`code`, `group_name`, `description`, `is_sensitive`) VALUES ('reports.view', 'Reports and records', 'see HR reports and download exports', 1);--> statement-breakpoint
INSERT OR IGNORE INTO `sec_permission` (`code`, `group_name`, `description`, `is_sensitive`) VALUES ('audit.view', 'Reports and records', 'read the change log, access logs and outbox', 0);--> statement-breakpoint
INSERT OR IGNORE INTO `sec_permission` (`code`, `group_name`, `description`, `is_sensitive`) VALUES ('access.manage', 'Administration', 'manage roles, permissions, who holds them, and approval flows', 0);--> statement-breakpoint
INSERT OR IGNORE INTO `sec_permission` (`code`, `group_name`, `description`, `is_sensitive`) VALUES ('self.profile', 'Self-service', 'see their own profile, documents and who has viewed them', 0);--> statement-breakpoint
INSERT OR IGNORE INTO `sec_permission` (`code`, `group_name`, `description`, `is_sensitive`) VALUES ('self.leave', 'Self-service', 'ask for leave and see their own balances', 0);--> statement-breakpoint
INSERT OR IGNORE INTO `sec_permission` (`code`, `group_name`, `description`, `is_sensitive`) VALUES ('self.pay', 'Self-service', 'read their own payslips', 0);--> statement-breakpoint
INSERT OR IGNORE INTO `sec_permission` (`code`, `group_name`, `description`, `is_sensitive`) VALUES ('self.tax', 'Self-service', 'make their own tax declaration and download their Form 16', 0);--> statement-breakpoint
INSERT OR IGNORE INTO `sec_permission` (`code`, `group_name`, `description`, `is_sensitive`) VALUES ('self.appraisal', 'Self-service', 'write their own self review', 0);--> statement-breakpoint
INSERT OR IGNORE INTO `sec_role` (`code`, `name`) VALUES ('HR_ADMIN', 'HR administrator');--> statement-breakpoint
UPDATE `sec_role` SET `is_built_in` = 1, `description` = 'Runs the back office: the org structure, employee records, time, payroll, tax, recruitment and performance.' WHERE `code` = 'HR_ADMIN';--> statement-breakpoint
INSERT OR IGNORE INTO `sec_role_permission` (`role_code`, `permission_code`) VALUES ('HR_ADMIN', 'org.view');--> statement-breakpoint
INSERT OR IGNORE INTO `sec_role_permission` (`role_code`, `permission_code`) VALUES ('HR_ADMIN', 'org.edit');--> statement-breakpoint
INSERT OR IGNORE INTO `sec_role_permission` (`role_code`, `permission_code`) VALUES ('HR_ADMIN', 'employee.view_all');--> statement-breakpoint
INSERT OR IGNORE INTO `sec_role_permission` (`role_code`, `permission_code`) VALUES ('HR_ADMIN', 'employee.edit');--> statement-breakpoint
INSERT OR IGNORE INTO `sec_role_permission` (`role_code`, `permission_code`) VALUES ('HR_ADMIN', 'employee.documents');--> statement-breakpoint
INSERT OR IGNORE INTO `sec_role_permission` (`role_code`, `permission_code`) VALUES ('HR_ADMIN', 'pay.view');--> statement-breakpoint
INSERT OR IGNORE INTO `sec_role_permission` (`role_code`, `permission_code`) VALUES ('HR_ADMIN', 'bank.view');--> statement-breakpoint
INSERT OR IGNORE INTO `sec_role_permission` (`role_code`, `permission_code`) VALUES ('HR_ADMIN', 'time.manage');--> statement-breakpoint
INSERT OR IGNORE INTO `sec_role_permission` (`role_code`, `permission_code`) VALUES ('HR_ADMIN', 'time.team_calendar');--> statement-breakpoint
INSERT OR IGNORE INTO `sec_role_permission` (`role_code`, `permission_code`) VALUES ('HR_ADMIN', 'leave.decide_any');--> statement-breakpoint
INSERT OR IGNORE INTO `sec_role_permission` (`role_code`, `permission_code`) VALUES ('HR_ADMIN', 'payroll.view');--> statement-breakpoint
INSERT OR IGNORE INTO `sec_role_permission` (`role_code`, `permission_code`) VALUES ('HR_ADMIN', 'payroll.setup');--> statement-breakpoint
INSERT OR IGNORE INTO `sec_role_permission` (`role_code`, `permission_code`) VALUES ('HR_ADMIN', 'payroll.run');--> statement-breakpoint
INSERT OR IGNORE INTO `sec_role_permission` (`role_code`, `permission_code`) VALUES ('HR_ADMIN', 'payroll.post');--> statement-breakpoint
INSERT OR IGNORE INTO `sec_role_permission` (`role_code`, `permission_code`) VALUES ('HR_ADMIN', 'tax.manage');--> statement-breakpoint
INSERT OR IGNORE INTO `sec_role_permission` (`role_code`, `permission_code`) VALUES ('HR_ADMIN', 'recruitment.manage');--> statement-breakpoint
INSERT OR IGNORE INTO `sec_role_permission` (`role_code`, `permission_code`) VALUES ('HR_ADMIN', 'recruitment.hire');--> statement-breakpoint
INSERT OR IGNORE INTO `sec_role_permission` (`role_code`, `permission_code`) VALUES ('HR_ADMIN', 'performance.manage');--> statement-breakpoint
INSERT OR IGNORE INTO `sec_role_permission` (`role_code`, `permission_code`) VALUES ('HR_ADMIN', 'performance.rate_any');--> statement-breakpoint
INSERT OR IGNORE INTO `sec_role_permission` (`role_code`, `permission_code`) VALUES ('HR_ADMIN', 'reports.view');--> statement-breakpoint
INSERT OR IGNORE INTO `sec_role_permission` (`role_code`, `permission_code`) VALUES ('HR_ADMIN', 'audit.view');--> statement-breakpoint
INSERT OR IGNORE INTO `sec_role_permission` (`role_code`, `permission_code`) VALUES ('HR_ADMIN', 'access.manage');--> statement-breakpoint
INSERT OR IGNORE INTO `sec_role_permission` (`role_code`, `permission_code`) VALUES ('HR_ADMIN', 'self.profile');--> statement-breakpoint
INSERT OR IGNORE INTO `sec_role_permission` (`role_code`, `permission_code`) VALUES ('HR_ADMIN', 'self.leave');--> statement-breakpoint
INSERT OR IGNORE INTO `sec_role_permission` (`role_code`, `permission_code`) VALUES ('HR_ADMIN', 'self.pay');--> statement-breakpoint
INSERT OR IGNORE INTO `sec_role_permission` (`role_code`, `permission_code`) VALUES ('HR_ADMIN', 'self.tax');--> statement-breakpoint
INSERT OR IGNORE INTO `sec_role_permission` (`role_code`, `permission_code`) VALUES ('HR_ADMIN', 'self.appraisal');--> statement-breakpoint
INSERT OR IGNORE INTO `sec_role` (`code`, `name`) VALUES ('MANAGER', 'Manager');--> statement-breakpoint
UPDATE `sec_role` SET `is_built_in` = 1, `description` = 'Approves their team''s requests, rates their team, and sees who is away.' WHERE `code` = 'MANAGER';--> statement-breakpoint
INSERT OR IGNORE INTO `sec_role_permission` (`role_code`, `permission_code`) VALUES ('MANAGER', 'employee.view_team');--> statement-breakpoint
INSERT OR IGNORE INTO `sec_role_permission` (`role_code`, `permission_code`) VALUES ('MANAGER', 'time.team_calendar');--> statement-breakpoint
INSERT OR IGNORE INTO `sec_role_permission` (`role_code`, `permission_code`) VALUES ('MANAGER', 'performance.rate_team');--> statement-breakpoint
INSERT OR IGNORE INTO `sec_role_permission` (`role_code`, `permission_code`) VALUES ('MANAGER', 'self.profile');--> statement-breakpoint
INSERT OR IGNORE INTO `sec_role_permission` (`role_code`, `permission_code`) VALUES ('MANAGER', 'self.leave');--> statement-breakpoint
INSERT OR IGNORE INTO `sec_role_permission` (`role_code`, `permission_code`) VALUES ('MANAGER', 'self.pay');--> statement-breakpoint
INSERT OR IGNORE INTO `sec_role_permission` (`role_code`, `permission_code`) VALUES ('MANAGER', 'self.tax');--> statement-breakpoint
INSERT OR IGNORE INTO `sec_role_permission` (`role_code`, `permission_code`) VALUES ('MANAGER', 'self.appraisal');--> statement-breakpoint
INSERT OR IGNORE INTO `sec_role` (`code`, `name`) VALUES ('EMPLOYEE', 'Employee');--> statement-breakpoint
UPDATE `sec_role` SET `is_built_in` = 1, `description` = 'Acts on their own record: leave, payslips, tax and appraisal.' WHERE `code` = 'EMPLOYEE';--> statement-breakpoint
INSERT OR IGNORE INTO `sec_role_permission` (`role_code`, `permission_code`) VALUES ('EMPLOYEE', 'self.profile');--> statement-breakpoint
INSERT OR IGNORE INTO `sec_role_permission` (`role_code`, `permission_code`) VALUES ('EMPLOYEE', 'self.leave');--> statement-breakpoint
INSERT OR IGNORE INTO `sec_role_permission` (`role_code`, `permission_code`) VALUES ('EMPLOYEE', 'self.pay');--> statement-breakpoint
INSERT OR IGNORE INTO `sec_role_permission` (`role_code`, `permission_code`) VALUES ('EMPLOYEE', 'self.tax');--> statement-breakpoint
INSERT OR IGNORE INTO `sec_role_permission` (`role_code`, `permission_code`) VALUES ('EMPLOYEE', 'self.appraisal');--> statement-breakpoint
INSERT OR IGNORE INTO `wf_flow` (`process`, `version`, `is_active`, `created_by`, `created_at`) VALUES ('leave', 1, 1, 'system', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));--> statement-breakpoint
INSERT OR IGNORE INTO `wf_step` (`flow_id`, `step_order`, `approver_type`) SELECT id, 1, 'reporting_manager' FROM wf_flow WHERE process = 'leave' AND version = 1;--> statement-breakpoint
INSERT OR IGNORE INTO wf_request (process, flow_id, subject_type, subject_id, subject_employee_id, requester_user_id, summary, facts, status, current_step, step_started_at, created_at) SELECT 'leave', (SELECT id FROM wf_flow WHERE process = 'leave' ORDER BY version LIMIT 1), 'pt_leave_request', CAST(lr.id AS TEXT), lr.employee_id, (SELECT u.id FROM sec_app_user u WHERE u.employee_id = lr.employee_id AND u.is_active = 1 LIMIT 1), COALESCE((SELECT p.first_name || ' ' || p.last_name FROM pa_it0002_personal_data p WHERE p.employee_id = lr.employee_id ORDER BY p.valid_from DESC LIMIT 1), 'An employee') || ': ' || lr.payroll_days || ' days of ' || lower(COALESCE((SELECT t.name FROM pt_absence_type t WHERE t.code = lr.absence_type_code), 'leave')), json_object('days', lr.payroll_days), 'Pending', 1, lr.submitted_at, lr.submitted_at FROM pt_leave_request lr WHERE lr.status = 'Pending';--> statement-breakpoint
INSERT OR IGNORE INTO wf_assignee (request_id, step_order, user_id, reason) SELECT r.id, 1, u.id, 'step' FROM wf_request r JOIN pa_it0001_org_assignment mine ON mine.employee_id = r.subject_employee_id AND mine.valid_from <= date('now') AND mine.valid_to >= date('now') JOIN om_position pos ON pos.code = mine.position_code JOIN pa_it0001_org_assignment theirs ON theirs.position_code = pos.reports_to_code AND theirs.valid_from <= date('now') AND theirs.valid_to >= date('now') JOIN sec_app_user u ON u.employee_id = theirs.employee_id AND u.is_active = 1 WHERE r.process = 'leave' AND r.status = 'Pending' AND NOT EXISTS (SELECT 1 FROM wf_action a WHERE a.request_id = r.id);--> statement-breakpoint
INSERT OR IGNORE INTO wf_assignee (request_id, step_order, user_id, reason) SELECT r.id, 1, ur.user_id, 'step' FROM wf_request r JOIN sec_user_role ur ON ur.role_code = 'HR_ADMIN' JOIN sec_app_user u ON u.id = ur.user_id AND u.is_active = 1 WHERE r.process = 'leave' AND r.status = 'Pending' AND NOT EXISTS (SELECT 1 FROM wf_assignee a WHERE a.request_id = r.id) AND NOT EXISTS (SELECT 1 FROM wf_action a WHERE a.request_id = r.id);--> statement-breakpoint
INSERT INTO wf_action (request_id, step_order, actor_type, actor_user_id, actor_name, decision, at) SELECT r.id, 0, 'user', r.requester_user_id, COALESCE(u.username, 'unknown'), 'Submitted', r.created_at FROM wf_request r LEFT JOIN sec_app_user u ON u.id = r.requester_user_id WHERE r.process = 'leave' AND NOT EXISTS (SELECT 1 FROM wf_action a WHERE a.request_id = r.id);
