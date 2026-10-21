/*
 Turns a flat list of holidays into one list per year.

 Every (calendar, year) already present becomes a published year, because the
 days on it are already in use — a tenant's existing list must not vanish
 behind a draft. The cap each year inherits is the old per-calendar optional
 allowance plus the fixed days that year already had, so nobody's choice
 shrinks on the day of the upgrade: if a calendar allowed 2 optional days and
 published 10 fixed ones, its year opens at 12 and still allows 2.

 Where that sum is below the 12 the client asked for, the year is lifted to
 12 — more choice, never less. HR edits any year afterwards.
*/

INSERT OR IGNORE INTO `pt_holiday_year` (`calendar_code`, `year`, `total_allowance`, `is_published`, `created_at`)
SELECT h.calendar_code,
       CAST(substr(h.date, 1, 4) AS INTEGER) AS y,
       MAX(
         12,
         (SELECT c.optional_allowance FROM pt_holiday_calendar c WHERE c.code = h.calendar_code)
         + SUM(CASE WHEN h.is_optional = 0 THEN 1 ELSE 0 END)
       ),
       1,
       '2026-10-21T00:00:00.000Z'
FROM pt_holiday h
GROUP BY h.calendar_code, y;
--> statement-breakpoint
UPDATE `pt_holiday` SET `year` = CAST(substr(`date`, 1, 4) AS INTEGER) WHERE `year` IS NULL;
--> statement-breakpoint
/*
 A calendar with no days yet still gets the current year opened, so the first
 holiday added to it has a year to land in rather than being refused.
*/
INSERT OR IGNORE INTO `pt_holiday_year` (`calendar_code`, `year`, `total_allowance`, `is_published`, `created_at`)
SELECT c.code, CAST(strftime('%Y', 'now') AS INTEGER), 12, 0, '2026-10-21T00:00:00.000Z'
FROM pt_holiday_calendar c
WHERE NOT EXISTS (SELECT 1 FROM pt_holiday_year y WHERE y.calendar_code = c.code);
