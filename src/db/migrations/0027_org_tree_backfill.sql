/*
 Moves the old fixed hierarchy into the one configurable tree.

 Personnel areas, sub-areas and ERP-synced cost centres all become org units,
 keeping their own codes, so every row that already points at one still
 resolves. The levels they land on are inserted first, because what a node is
 now comes from its level, not from which table it sat in.

 Behaviour this preserves: an employee's holiday calendar and payroll group
 used to come from their assignment's own area_code, independent of their
 department. They now come from walking up the tree, so each department is
 re-parented under the area its own people were assigned to.

 The pre-flight check below is what makes that safe. It aborts the migration
 if any department's employees sit in more than one personnel area, because
 there is then no single ancestor that preserves today's answer for all of
 them — that data needs splitting by hand before this can run.
*/

CREATE TABLE `_org_unit_area_check` (`org_unit_code` text PRIMARY KEY NOT NULL);
--> statement-breakpoint
INSERT INTO `_org_unit_area_check` (`org_unit_code`)
SELECT o.org_unit_code
FROM pa_it0001_org_assignment o
WHERE o.area_code IS NOT NULL
GROUP BY o.org_unit_code, o.area_code;
--> statement-breakpoint
DROP TABLE `_org_unit_area_check`;
--> statement-breakpoint
INSERT OR IGNORE INTO `om_level_type` (`code`, `name`, `parent_level_type_code`, `rank`, `is_payroll_group`, `is_calendar_level`, `is_cost_centre`, `is_active`) VALUES
	('ORGANISATION', 'Organisation', NULL, 0, 0, 0, 0, 1),
	('VERTICAL', 'Business vertical', 'ORGANISATION', 1, 0, 0, 0, 1),
	('CENTER', 'Business center', 'VERTICAL', 2, 1, 1, 0, 1),
	('DEPARTMENT', 'Department', 'CENTER', 3, 0, 0, 0, 1),
	('COST_CENTRE', 'Cost centre', 'DEPARTMENT', 4, 0, 0, 1, 1);
--> statement-breakpoint
UPDATE `om_org_unit` SET `level_type_code` = 'DEPARTMENT' WHERE `level_type_code` IS NULL;
--> statement-breakpoint
INSERT OR IGNORE INTO `om_org_unit` (`code`, `name`, `parent_code`, `company_code`, `level_type_code`, `calendar_code`, `valid_from`, `valid_to`, `is_active`)
SELECT a.code, a.name, NULL, a.company_code, 'CENTER', a.calendar_code, '2000-01-01', '9999-12-31', a.is_active
FROM om_personnel_area a;
--> statement-breakpoint
INSERT OR IGNORE INTO `om_org_unit` (`code`, `name`, `parent_code`, `company_code`, `level_type_code`, `calendar_code`, `valid_from`, `valid_to`, `is_active`)
SELECT sa.code, sa.name, sa.area_code, a.company_code, 'DEPARTMENT', NULL, '2000-01-01', '9999-12-31', sa.is_active
FROM om_personnel_sub_area sa JOIN om_personnel_area a ON a.code = sa.area_code;
--> statement-breakpoint
INSERT OR IGNORE INTO `om_org_unit` (`code`, `name`, `parent_code`, `company_code`, `level_type_code`, `calendar_code`, `valid_from`, `valid_to`, `is_active`)
SELECT cc.code, cc.name, NULL, cc.company_code, 'COST_CENTRE', NULL, '2000-01-01', '9999-12-31', cc.is_active
FROM om_cost_centre cc;
--> statement-breakpoint
UPDATE `om_org_unit` SET `parent_code` = (
	SELECT o.area_code FROM pa_it0001_org_assignment o
	WHERE o.org_unit_code = om_org_unit.code AND o.area_code IS NOT NULL LIMIT 1
)
WHERE `parent_code` IS NULL
	AND `level_type_code` = 'DEPARTMENT'
	AND EXISTS (SELECT 1 FROM pa_it0001_org_assignment o WHERE o.org_unit_code = om_org_unit.code AND o.area_code IS NOT NULL);
--> statement-breakpoint
UPDATE `om_org_unit` SET `parent_code` = `area_code`
WHERE `parent_code` IS NULL AND `area_code` IS NOT NULL AND `level_type_code` = 'DEPARTMENT';
--> statement-breakpoint
UPDATE `py_payroll_period` SET `node_code` = `area_code` WHERE `node_code` IS NULL;
--> statement-breakpoint
UPDATE `pt_leave_policy` SET `applies_to_node_code` = `applies_to_area_code` WHERE `applies_to_node_code` IS NULL;
--> statement-breakpoint
INSERT OR IGNORE INTO `om_job_family` (`code`, `name`, `is_active`)
SELECT upper(trim(j.job_group)), trim(j.job_group), 1
FROM om_job j WHERE j.job_group IS NOT NULL AND trim(j.job_group) <> '';
--> statement-breakpoint
UPDATE `om_job` SET `job_family_code` = upper(trim(`job_group`))
WHERE `job_group` IS NOT NULL AND trim(`job_group`) <> '' AND `job_family_code` IS NULL;
--> statement-breakpoint
UPDATE `sec_role_scope` SET `scope_type` = 'node' WHERE `scope_type` = 'area';
--> statement-breakpoint
/*
 Cost centres are HR's records now that they are org units, so the row
 migration 0009 seeded flips with them. Only the seeded row: `updated_by` is
 null on it, so an ownership HR has already chosen for itself is left alone.
*/
UPDATE `int_ownership` SET `owner` = 'hrms'
WHERE `record_type` = 'cost_centre' AND `field` = '' AND `owner` = 'erp' AND `updated_by` IS NULL;
