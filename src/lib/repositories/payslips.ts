import "server-only";
import { rawClient } from "@/lib/db";
import { formatMonth } from "@/lib/dates";
import { periodEnd, periodStart } from "@/lib/engines/payroll";

/**
 * One payslip, with everything the page, the PDF and the API show: the
 * result and its lines, who and when, and the year to date — summed from
 * the stored lines of every payslip in the financial year up to this one,
 * never recalculated.
 */

export type PayslipLine = { wageTypeCode: string; wageTypeName: string; kind: string; amountPaise: number };

export type PayslipData = {
  resultId: number;
  runId: number;
  employeeId: number;
  employer: { name: string; address: string | null };
  employeeName: string;
  firstName: string | null;
  dateOfBirth: string | null;
  employeeNumber: string;
  position: string | null;
  year: number;
  month: number;
  periodLabel: string;
  payDate: string | null;
  offCycleReason: string | null;
  lines: PayslipLine[];
  grossPaise: number;
  deductionsPaise: number;
  netPaise: number;
  unpaidDays: number;
  workingDays: number;
  employedDays: number;
  joinedOn: string | null;
  leftOn: string | null;
  /** Posted (or an off-cycle payment made): the employee can see it. */
  published: boolean;
  publishedAt: string | null;
  /** "2026-27". */
  financialYear: string;
  ytd: { lines: PayslipLine[]; grossPaise: number; deductionsPaise: number; netPaise: number; payslips: number };
};

/** April to March: the financial year a month falls in, as its first year. */
export const fyStartYear = (year: number, month: number) => (month >= 4 ? year : year - 1);
export const fyLabel = (start: number) => `${start}-${String((start + 1) % 100).padStart(2, "0")}`;

export async function getPayslip(resultId: number): Promise<PayslipData | null> {
  const client = rawClient();
  const r = await client.execute({
    sql: `SELECT r.*, run.run_type, run.reason, run.pay_date AS run_pay_date, run.status AS run_status,
                 p.year, p.month, p.pay_date AS period_pay_date, p.status AS period_status,
                 e.employee_number, e.hire_date, e.termination_date,
                 pd.first_name, pd.last_name, pd.date_of_birth
          FROM py_payroll_result r
          JOIN py_payroll_run run ON run.id = r.run_id
          JOIN py_payroll_period p ON p.id = run.period_id
          JOIN pa_employee e ON e.id = r.employee_id
          LEFT JOIN pa_it0002_personal_data pd ON pd.employee_id = e.id
            AND pd.valid_from <= date('now') AND pd.valid_to >= date('now')
          WHERE r.id = ?`,
    args: [resultId],
  });
  const row = r.rows[0] as unknown as Record<string, unknown> | undefined;
  if (!row) return null;

  const year = Number(row.year);
  const month = Number(row.month);
  const from = periodStart(year, month);
  const to = periodEnd(year, month);
  const employeeId = Number(row.employee_id);
  const runId = Number(row.run_id);

  // The assignment as it stood at the end of the month, and a company to head the payslip.
  const [assignment, lines, fallbackCompany] = await Promise.all([
    client.execute({
      sql: `SELECT pos.title, co.name, co.address, co.city FROM pa_it0001_org_assignment oa
            LEFT JOIN om_position pos ON pos.code = oa.position_code
            LEFT JOIN om_company co ON co.code = oa.company_code
            WHERE oa.employee_id = ? AND oa.valid_from <= ? ORDER BY oa.valid_from DESC LIMIT 1`,
      args: [employeeId, to],
    }),
    client.execute({
      sql: `SELECT wage_type_code, wage_type_name, kind, amount_paise FROM py_payroll_result_line
            WHERE result_id = ? ORDER BY sort_order, id`,
      args: [resultId],
    }),
    client.execute("SELECT name, address, city FROM om_company ORDER BY code LIMIT 1"),
  ]);
  const a = assignment.rows[0];
  const company = a?.name ? a : fallbackCompany.rows[0];

  const fyStart = fyStartYear(year, month);
  const key = year * 12 + month;
  // Every payslip the employee has in the financial year up to this one: the
  // ones they can see (a posted month, or an off-cycle payment), plus this.
  const ytd = await client.execute({
    sql: `SELECT l.wage_type_code, MAX(l.wage_type_name) AS wage_type_name, MAX(l.kind) AS kind,
                 SUM(l.amount_paise) AS amount_paise
          FROM py_payroll_result r2
          JOIN py_payroll_run run2 ON run2.id = r2.run_id AND run2.status = 'Completed'
          JOIN py_payroll_period p2 ON p2.id = run2.period_id
          JOIN py_payroll_result_line l ON l.result_id = r2.id
          WHERE r2.employee_id = ?1 AND r2.status = 'Calculated'
            AND (p2.year * 12 + p2.month) BETWEEN ?2 AND ?3
            AND (r2.id = ?4 OR (
                  (p2.status = 'Posted' OR run2.run_type = 'Off-cycle')
                  AND ((p2.year * 12 + p2.month) < ?3 OR run2.id <= ?5)))
          GROUP BY l.wage_type_code`,
    args: [employeeId, fyStart * 12 + 4, key, resultId, runId],
  });
  const totals = await client.execute({
    sql: `SELECT COUNT(*) AS n, COALESCE(SUM(r2.gross_paise), 0) AS gross, COALESCE(SUM(r2.deductions_paise), 0) AS deductions,
                 COALESCE(SUM(r2.net_paise), 0) AS net
          FROM py_payroll_result r2
          JOIN py_payroll_run run2 ON run2.id = r2.run_id AND run2.status = 'Completed'
          JOIN py_payroll_period p2 ON p2.id = run2.period_id
          WHERE r2.employee_id = ?1 AND r2.status = 'Calculated'
            AND (p2.year * 12 + p2.month) BETWEEN ?2 AND ?3
            AND (r2.id = ?4 OR (
                  (p2.status = 'Posted' OR run2.run_type = 'Off-cycle')
                  AND ((p2.year * 12 + p2.month) < ?3 OR run2.id <= ?5)))`,
    args: [employeeId, fyStart * 12 + 4, key, resultId, runId],
  });
  const t = totals.rows[0];

  const hire = String(row.hire_date);
  const left = row.termination_date === null ? null : String(row.termination_date);
  const offCycle = String(row.run_type) === "Off-cycle";
  const name = [row.first_name, row.last_name].filter(Boolean).join(" ") || String(row.employee_number);

  return {
    resultId,
    runId,
    employeeId,
    employer: {
      name: company?.name ? String(company.name) : "Company",
      address: company ? [company.address, company.city].filter(Boolean).join(" · ") || null : null,
    },
    employeeName: name,
    firstName: row.first_name === null ? null : String(row.first_name),
    dateOfBirth: row.date_of_birth === null ? null : String(row.date_of_birth),
    employeeNumber: String(row.employee_number),
    position: a?.title ? String(a.title) : null,
    year,
    month,
    periodLabel: formatMonth(year, month),
    payDate: (row.run_pay_date ?? row.period_pay_date) === null ? null : String(row.run_pay_date ?? row.period_pay_date),
    offCycleReason: offCycle ? (row.reason === null ? "Off-cycle payment" : String(row.reason)) : null,
    lines: lines.rows.map((l) => ({
      wageTypeCode: String(l.wage_type_code),
      wageTypeName: String(l.wage_type_name),
      kind: String(l.kind),
      amountPaise: Number(l.amount_paise),
    })),
    grossPaise: Number(row.gross_paise),
    deductionsPaise: Number(row.deductions_paise),
    netPaise: Number(row.net_paise),
    unpaidDays: Number(row.unpaid_days),
    workingDays: Number(row.working_days),
    employedDays: Number(row.employed_days),
    joinedOn: hire >= from && hire <= to ? hire : null,
    leftOn: left && left >= from && left <= to ? left : null,
    published: String(row.run_status) === "Completed" && (String(row.period_status) === "Posted" || offCycle),
    publishedAt: row.published_at === null ? null : String(row.published_at),
    financialYear: fyLabel(fyStart),
    ytd: {
      lines: ytd.rows.map((l) => ({
        wageTypeCode: String(l.wage_type_code),
        wageTypeName: String(l.wage_type_name),
        kind: String(l.kind),
        amountPaise: Number(l.amount_paise),
      })),
      grossPaise: Number(t.gross),
      deductionsPaise: Number(t.deductions),
      netPaise: Number(t.net),
      payslips: Number(t.n),
    },
  };
}

export type YearToDate = { grossPaise: number; deductionsPaise: number; netPaise: number; lines: Map<string, number> };

/**
 * The year to date for many people's payslips in one run, in two queries
 * rather than a few per person: what the API's run results carry.
 */
export async function ytdForRun(runId: number, resultIds: number[]): Promise<{ financialYear: string; byResult: Map<number, YearToDate> }> {
  const client = rawClient();
  const run = (
    await client.execute({
      sql: "SELECT p.year, p.month FROM py_payroll_run run JOIN py_payroll_period p ON p.id = run.period_id WHERE run.id = ?",
      args: [runId],
    })
  ).rows[0];
  const byResult = new Map<number, YearToDate>();
  if (!run || resultIds.length === 0) return { financialYear: "", byResult };
  const year = Number(run.year);
  const month = Number(run.month);
  const start = fyStartYear(year, month);
  const key = year * 12 + month;
  const marks = resultIds.map(() => "?").join(", ");
  // Each result's employee, and the payslips of theirs that count towards it.
  const scope = `
    FROM py_payroll_result mine
    JOIN py_payroll_result r2 ON r2.employee_id = mine.employee_id AND r2.status = 'Calculated'
    JOIN py_payroll_run run2 ON run2.id = r2.run_id AND run2.status = 'Completed'
    JOIN py_payroll_period p2 ON p2.id = run2.period_id
    WHERE mine.id IN (${marks})
      AND (p2.year * 12 + p2.month) BETWEEN ? AND ?
      AND (r2.id = mine.id OR ((p2.status = 'Posted' OR run2.run_type = 'Off-cycle')
            AND ((p2.year * 12 + p2.month) < ? OR run2.id <= ?)))`;
  const args = [...resultIds, start * 12 + 4, key, key, runId];
  const [totals, lines] = await client.batch(
    [
      {
        sql: `SELECT mine.id AS result_id, SUM(r2.gross_paise) AS gross, SUM(r2.deductions_paise) AS deductions, SUM(r2.net_paise) AS net
              ${scope} GROUP BY mine.id`,
        args,
      },
      {
        sql: `SELECT mine.id AS result_id, l.wage_type_code, SUM(l.amount_paise) AS amount
              ${scope.replace("WHERE mine.id", "JOIN py_payroll_result_line l ON l.result_id = r2.id WHERE mine.id")}
              GROUP BY mine.id, l.wage_type_code`,
        args,
      },
    ],
    "read",
  );
  for (const t of totals.rows) {
    byResult.set(Number(t.result_id), { grossPaise: Number(t.gross), deductionsPaise: Number(t.deductions), netPaise: Number(t.net), lines: new Map() });
  }
  for (const l of lines.rows) byResult.get(Number(l.result_id))?.lines.set(String(l.wage_type_code), Number(l.amount));
  return { financialYear: fyLabel(start), byResult };
}
