/*
 Turns four fixed columns on a declaration into lines against a catalogue.

 India's components are seeded first, because every existing declaration is
 Indian: this system has only ever computed Indian tax. Each declaration's
 four figures then become four lines, keeping the same amounts — so the tax
 a month deducts is the same either side of the upgrade.

 The pre-flight check below refuses the upgrade if a declaration would lose
 a figure: every non-zero amount must have a component to land on. It fires
 only if the seeded catalogue has been edited out from under this migration,
 which is the one case where silently dropping a figure would change
 somebody's tax without telling anyone.
*/

INSERT OR IGNORE INTO `tx_component` (`country`, `code`, `name`, `kind`, `cap_paise`, `requires_proof`, `is_derived`, `sort_order`, `is_active`) VALUES
	('India', '80C', 'LIC, PPF, ELSS and the rest of 80C', 'chapter_via', 15000000, 1, 0, 10, 1),
	('India', '80CCD1B', 'National Pension System, over and above 80C', 'chapter_via', 5000000, 1, 0, 20, 1),
	('India', '80D', 'Medical insurance premium', 'chapter_via', 2500000, 1, 0, 30, 1),
	('India', '80E', 'Interest on an education loan', 'chapter_via', NULL, 1, 0, 40, 1),
	('India', '80G', 'Donations', 'chapter_via', NULL, 1, 0, 50, 1),
	('India', '24B', 'Interest on a housing loan', 'chapter_via', 20000000, 1, 0, 60, 1),
	('India', 'HRA', 'House rent allowance, under section 10(13A)', 'section_10', NULL, 1, 1, 70, 1),
	('India', 'LTA', 'Leave travel allowance', 'section_10', NULL, 1, 0, 80, 1),
	('India', 'OTHER_INCOME', 'Income from other sources', 'other_income', NULL, 0, 0, 90, 1);
--> statement-breakpoint
INSERT OR IGNORE INTO `tx_city_category` (`country`, `city`, `category`) VALUES
	('India', 'DELHI', 'METRO'),
	('India', 'MUMBAI', 'METRO'),
	('India', 'KOLKATA', 'METRO'),
	('India', 'CHENNAI', 'METRO');
--> statement-breakpoint
/*
 The gate: one row per figure that has nowhere to go. A primary key of a
 single constant means a second such figure aborts the whole upgrade, and
 the table's name is what the error says.
*/
CREATE TABLE `_declared_figure_has_no_component` (`problem` text PRIMARY KEY NOT NULL);
--> statement-breakpoint
INSERT INTO `_declared_figure_has_no_component` (`problem`)
SELECT 'a declared figure has no component to land on'
FROM tds_employee_declaration d
WHERE (d.section_80c_paise > 0 AND NOT EXISTS (SELECT 1 FROM tx_component c WHERE c.code = '80C'))
   OR (d.section_80d_paise > 0 AND NOT EXISTS (SELECT 1 FROM tx_component c WHERE c.code = '80D'))
   OR (d.hra_exemption_paise > 0 AND NOT EXISTS (SELECT 1 FROM tx_component c WHERE c.code = 'HRA'))
   OR (d.other_income_paise > 0 AND NOT EXISTS (SELECT 1 FROM tx_component c WHERE c.code = 'OTHER_INCOME'));
--> statement-breakpoint
DROP TABLE `_declared_figure_has_no_component`;
--> statement-breakpoint
INSERT INTO `tds_declaration_line` (`declaration_id`, `component_code`, `declared_paise`)
SELECT d.id, '80C', d.section_80c_paise FROM tds_employee_declaration d WHERE d.section_80c_paise > 0;
--> statement-breakpoint
INSERT INTO `tds_declaration_line` (`declaration_id`, `component_code`, `declared_paise`)
SELECT d.id, '80D', d.section_80d_paise FROM tds_employee_declaration d WHERE d.section_80d_paise > 0;
--> statement-breakpoint
INSERT INTO `tds_declaration_line` (`declaration_id`, `component_code`, `declared_paise`)
SELECT d.id, 'HRA', d.hra_exemption_paise FROM tds_employee_declaration d WHERE d.hra_exemption_paise > 0;
--> statement-breakpoint
INSERT INTO `tds_declaration_line` (`declaration_id`, `component_code`, `declared_paise`)
SELECT d.id, 'OTHER_INCOME', d.other_income_paise FROM tds_employee_declaration d WHERE d.other_income_paise > 0;
--> statement-breakpoint
/*
 A rent record already saying which city category applies keeps it; one that
 does not takes it from the employee's own address against the list above.
*/
UPDATE `tds_rent` SET `is_metro` = 1
WHERE `is_metro` = 0 AND EXISTS (
	SELECT 1 FROM pa_it0006_address a
	JOIN tx_city_category c ON c.city = upper(trim(a.city)) AND c.category = 'METRO'
	WHERE a.employee_id = tds_rent.employee_id
);
