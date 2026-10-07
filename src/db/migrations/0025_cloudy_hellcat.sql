ALTER TABLE `pt_holiday` ADD `is_optional` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `pt_holiday_calendar` ADD `optional_allowance` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `pa_it0011_statutory_details` ADD `vpf_basis_points` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
INSERT OR IGNORE INTO `pt_absence_type` (`code`, `name`, `is_paid`, `counts_against_quota`, `quota_type_code`, `is_comp_off`, `is_active`) VALUES ('OPTH', 'Optional holiday', 1, 0, NULL, 0, 1);--> statement-breakpoint
INSERT OR IGNORE INTO `pt_device` (`code`, `name`, `location`, `client_pk`, `is_active`) VALUES ('WEB', 'The app itself', 'Clocking in and out from HRMS', NULL, 1);--> statement-breakpoint
INSERT OR IGNORE INTO `py_wage_type` (`code`, `name`, `kind`, `amount_type`, `percent_basis_points`, `fixed_amount_paise`, `formula_key`, `is_taxable`, `is_automatic`, `gl_account`, `sort_order`, `is_active`) VALUES ('VPF', 'Voluntary provident fund', 'Deduction', 'Formula', NULL, NULL, 'VPF', 0, 1, '2120', 111, 1);--> statement-breakpoint
INSERT OR IGNORE INTO `sec_role_permission` (`role_code`, `permission_code`) VALUES ('FINANCE', 'payroll.view');--> statement-breakpoint
INSERT OR IGNORE INTO `sec_role_permission` (`role_code`, `permission_code`) VALUES ('FINANCE', 'payroll.setup');--> statement-breakpoint
INSERT OR IGNORE INTO `sec_role_permission` (`role_code`, `permission_code`) VALUES ('FINANCE', 'payroll.run');--> statement-breakpoint
INSERT OR IGNORE INTO `sec_role_permission` (`role_code`, `permission_code`) VALUES ('FINANCE', 'payroll.post');--> statement-breakpoint
INSERT OR IGNORE INTO `sec_role_permission` (`role_code`, `permission_code`) VALUES ('FINANCE', 'tax.manage');--> statement-breakpoint
INSERT OR IGNORE INTO `sec_role_permission` (`role_code`, `permission_code`) VALUES ('FINANCE', 'reports.view');--> statement-breakpoint
INSERT OR IGNORE INTO `sec_role_permission` (`role_code`, `permission_code`) VALUES ('FINANCE', 'audit.view');--> statement-breakpoint
INSERT OR IGNORE INTO `sec_role_permission` (`role_code`, `permission_code`) VALUES ('FINANCE', 'self.profile');--> statement-breakpoint
INSERT OR IGNORE INTO `sec_role_permission` (`role_code`, `permission_code`) VALUES ('FINANCE', 'self.leave');--> statement-breakpoint
INSERT OR IGNORE INTO `sec_role_permission` (`role_code`, `permission_code`) VALUES ('FINANCE', 'self.pay');--> statement-breakpoint
INSERT OR IGNORE INTO `sec_role_permission` (`role_code`, `permission_code`) VALUES ('FINANCE', 'self.tax');--> statement-breakpoint
UPDATE `sec_role` SET `description` = 'Runs the money side: payroll, statutory rates, tax and the reports behind them. Also approves the budget on a new position and the finance step on a claim.' WHERE `code` = 'FINANCE';
