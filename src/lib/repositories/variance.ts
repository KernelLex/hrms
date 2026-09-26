import "server-only";
import { rawClient } from "@/lib/db";
import { formatINR } from "@/lib/money";

/**
 * The check a payroll clerk makes before posting: whose pay moved, and why.
 *
 * Each person's net is compared with their previous regular run. Anyone paid
 * for the first time, or whose net moved by the threshold or more, is listed
 * with the likely causes read from this month's lines — so an unexpected
 * change is questioned before the money leaves, not after.
 */

export const VARIANCE_THRESHOLD = 0.1; // 10%

export type Variance = {
  resultId: number;
  employeeId: number;
  name: string;
  number: string;
  netPaise: number;
  previousNetPaise: number | null;
  /** Fractional change, 0.12 for 12% up. Null for someone paid for the first time. */
  change: number | null;
  reasons: string[];
};

export async function varianceFor(runId: number): Promise<{ checked: number; flagged: Variance[] }> {
  const client = rawClient();
  const run = await client.execute({
    sql: `SELECT p.year, p.month, run.run_type FROM py_payroll_run run
          JOIN py_payroll_period p ON p.id = run.period_id WHERE run.id = ?`,
    args: [runId],
  });
  const r = run.rows[0];
  if (!r || String(r.run_type) !== "Regular") return { checked: 0, flagged: [] };
  const current = Number(r.year) * 100 + Number(r.month);

  const rows = await client.execute({
    sql: `WITH cur AS (
            SELECT r.id, r.employee_id, r.net_paise, r.unpaid_days, r.working_days, r.employed_days
            FROM py_payroll_result r WHERE r.run_id = ?1 AND r.status = 'Calculated'
          ),
          prev AS (
            SELECT r.id AS result_id, r.employee_id, r.net_paise,
                   ROW_NUMBER() OVER (PARTITION BY r.employee_id
                                      ORDER BY p.year DESC, p.month DESC, run.run_at DESC) AS rn
            FROM py_payroll_result r
            JOIN py_payroll_run run ON run.id = r.run_id
             AND run.run_type = 'Regular' AND run.status = 'Completed'
            JOIN py_payroll_period p ON p.id = run.period_id
            WHERE r.status = 'Calculated' AND r.run_id != ?1
              AND p.year * 100 + p.month < ?2
              AND r.employee_id IN (SELECT employee_id FROM cur)
          )
          SELECT cur.id, cur.employee_id, cur.net_paise, cur.unpaid_days, cur.working_days,
                 cur.employed_days, prev.net_paise AS prev_net, e.employee_number,
                 (SELECT SUM(amount_paise) FROM py_payroll_result_line
                   WHERE result_id = cur.id AND wage_type_code = 'BASIC') AS basic,
                 (SELECT SUM(amount_paise) FROM py_payroll_result_line
                   WHERE result_id = prev.result_id AND wage_type_code = 'BASIC') AS prev_basic,
                 COALESCE(pd.first_name || ' ' || pd.last_name, e.employee_number) AS name,
                 (SELECT group_concat(DISTINCT l.wage_type_code) FROM py_payroll_result_line l
                   WHERE l.result_id = cur.id) AS codes
          FROM cur
          JOIN pa_employee e ON e.id = cur.employee_id
          LEFT JOIN prev ON prev.employee_id = cur.employee_id AND prev.rn = 1
          LEFT JOIN pa_it0002_personal_data pd
            ON pd.employee_id = e.id AND pd.valid_from <= date('now') AND pd.valid_to >= date('now')
          ORDER BY e.employee_number`,
    args: [runId, current],
  });

  const oneOffCodes = await client.execute(
    "SELECT code FROM py_wage_type WHERE is_automatic = 0",
  );
  const oneOff = new Set(oneOffCodes.rows.map((c) => String(c.code)));

  const flagged: Variance[] = [];
  for (const row of rows.rows) {
    const net = Number(row.net_paise);
    const prev = row.prev_net === null ? null : Number(row.prev_net);
    const change = prev === null ? null : prev === 0 ? (net === 0 ? 0 : 1) : (net - prev) / prev;
    if (change !== null && Math.abs(change) < VARIANCE_THRESHOLD) continue;

    const codes = new Set(String(row.codes ?? "").split(",").filter(Boolean));
    const reasons: string[] = [];
    if (prev === null) reasons.push("first payroll in the system");
    const basic = Number(row.basic ?? 0);
    const prevBasic = row.prev_basic === null ? null : Number(row.prev_basic);
    if (
      prevBasic !== null &&
      basic !== prevBasic &&
      Number(row.employed_days) === Number(row.working_days) &&
      Number(row.unpaid_days) === 0
    ) {
      reasons.push(`basic pay changed from ${formatINR(prevBasic)} to ${formatINR(basic)}`);
    }
    if (Number(row.employed_days) < Number(row.working_days)) reasons.push("joined or left this month");
    if (Number(row.unpaid_days) > 0) reasons.push(`${Number(row.unpaid_days)} unpaid days`);
    if (codes.has("RETRO")) reasons.push("arrears for earlier months");
    if ([...codes].some((c) => oneOff.has(c))) reasons.push("a one-off or recurring payment");
    if (reasons.length === 0) reasons.push("no change in the inputs explains it; check basic pay");

    flagged.push({
      resultId: Number(row.id),
      employeeId: Number(row.employee_id),
      name: String(row.name),
      number: String(row.employee_number),
      netPaise: net,
      previousNetPaise: prev,
      change,
      reasons,
    });
  }
  return { checked: rows.rows.length, flagged };
}
