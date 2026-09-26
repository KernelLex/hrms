import "server-only";
import { rawClient } from "@/lib/db";
import { financialYearOf } from "@/lib/engines/tax";

/**
 * The HR reports page: who works here, what they cost, how much leave is
 * taken and how many leave. Aggregated in SQL, one batch.
 */

export type Reports = {
  financialYear: string;
  headcount: number;
  joiners: number;
  leavers: number;
  /** Leavers in the last twelve months over today's headcount. */
  attrition: number | null;
  byDepartment: { label: string; value: number }[];
  payroll: { month: string; byDepartment: { label: string; value: number }[] } | null;
  leaveByType: { label: string; value: number }[];
};

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export async function reports(today: string): Promise<Reports> {
  const fy = financialYearOf(today);
  const fyStart = `${fy.slice(0, 4)}-04-01`;
  const yearAgo = `${Number(today.slice(0, 4)) - 1}${today.slice(4)}`;
  const calendarYear = today.slice(0, 4);

  const [counts, departments, latest, leave] = await rawClient().batch(
    [
      {
        sql: `SELECT
                (SELECT COUNT(*) FROM pa_employee
                   WHERE hire_date <= ?1 AND (termination_date IS NULL OR termination_date > ?1)) AS headcount,
                (SELECT COUNT(*) FROM pa_employee WHERE hire_date BETWEEN ?2 AND ?1) AS joiners,
                (SELECT COUNT(*) FROM pa_employee WHERE termination_date BETWEEN ?2 AND ?1) AS leavers,
                (SELECT COUNT(*) FROM pa_employee WHERE termination_date > ?3 AND termination_date <= ?1) AS leavers_12m`,
        args: [today, fyStart, yearAgo],
      },
      {
        sql: `SELECT COALESCE(ou.name, 'Unassigned') AS label, COUNT(*) AS value
              FROM pa_employee e
              LEFT JOIN pa_it0001_org_assignment o
                ON o.employee_id = e.id AND o.valid_from <= ?1 AND o.valid_to >= ?1
              LEFT JOIN om_org_unit ou ON ou.code = o.org_unit_code
              WHERE e.hire_date <= ?1 AND (e.termination_date IS NULL OR e.termination_date > ?1)
              GROUP BY label ORDER BY value DESC, label`,
        args: [today],
      },
      {
        // Gross pay by department for the latest posted month.
        sql: `WITH latest AS (
                SELECT p.year, p.month FROM py_payroll_period p
                WHERE p.status = 'Posted' ORDER BY p.year DESC, p.month DESC LIMIT 1
              )
              SELECT latest.year, latest.month, COALESCE(ou.name, 'Unassigned') AS label,
                     SUM(r.gross_paise) AS value
              FROM latest
              JOIN py_payroll_period p ON p.year = latest.year AND p.month = latest.month
              JOIN py_payroll_run run ON run.period_id = p.id AND run.status = 'Completed'
              JOIN py_payroll_result r ON r.run_id = run.id AND r.status = 'Calculated'
              LEFT JOIN pa_it0001_org_assignment o
                ON o.employee_id = r.employee_id
               AND o.valid_from <= date(printf('%04d-%02d-01', p.year, p.month), '+1 month', '-1 day')
               AND o.valid_to >= date(printf('%04d-%02d-01', p.year, p.month), '+1 month', '-1 day')
              LEFT JOIN om_org_unit ou ON ou.code = o.org_unit_code
              GROUP BY label ORDER BY value DESC, label`,
        args: [],
      },
      {
        sql: `SELECT t.name AS label, SUM(a.payroll_days) AS value
              FROM pt_it2001_absence a JOIN pt_absence_type t ON t.code = a.absence_type_code
              WHERE substr(a.start_date, 1, 4) = ?
              GROUP BY t.name ORDER BY value DESC, label`,
        args: [calendarYear],
      },
    ],
    "read",
  );

  const c = counts.rows[0];
  const headcount = Number(c.headcount);
  const toItems = (rows: typeof departments.rows) =>
    rows.map((r) => ({ label: String(r.label), value: Number(r.value) }));
  const first = latest.rows[0];

  return {
    financialYear: fy,
    headcount,
    joiners: Number(c.joiners),
    leavers: Number(c.leavers),
    attrition: headcount > 0 ? Number(c.leavers_12m) / headcount : null,
    byDepartment: toItems(departments.rows),
    payroll: first
      ? { month: `${MONTHS[Number(first.month) - 1]} ${first.year}`, byDepartment: toItems(latest.rows) }
      : null,
    leaveByType: toItems(leave.rows),
  };
}
