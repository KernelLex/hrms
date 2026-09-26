import { rawClient } from "@/lib/db";
import { can, getAccess } from "@/lib/access";
import { logAccess } from "@/lib/access-log";
import { csvResponse, rupees, toCsv, type Cell } from "@/lib/csv";

/**
 * A payroll run as a spreadsheet: one row per person, one column per wage
 * type, the way an accountant reconciles a run. HR only.
 */
export async function GET(_req: Request, ctx: RouteContext<"/api/export/payroll-run/[id]">) {
  const session = await getAccess();
  if (!session) return new Response("Sign in first.", { status: 401 });
  if (!can(session, "payroll.view")) return new Response("Not allowed.", { status: 403 });

  const runId = Number((await ctx.params).id);
  const [run, results, lines] = await rawClient().batch(
    [
      {
        sql: `SELECT run.run_type, run.reason, p.year, p.month, p.area_code
              FROM py_payroll_run run JOIN py_payroll_period p ON p.id = run.period_id WHERE run.id = ?`,
        args: [runId],
      },
      {
        sql: `SELECT r.id, e.employee_number, r.status, r.error_message, r.gross_paise,
                     r.deductions_paise, r.net_paise, r.working_days, r.employed_days, r.unpaid_days,
                     COALESCE(p.first_name || ' ' || p.last_name, e.employee_number) AS name
              FROM py_payroll_result r JOIN pa_employee e ON e.id = r.employee_id
              LEFT JOIN pa_it0002_personal_data p
                ON p.employee_id = e.id AND p.valid_from <= date('now') AND p.valid_to >= date('now')
              WHERE r.run_id = ? ORDER BY e.employee_number`,
        args: [runId],
      },
      {
        sql: `SELECT l.result_id, l.wage_type_code, l.kind, SUM(l.amount_paise) AS amount,
                     MIN(l.sort_order) AS sort_order
              FROM py_payroll_result_line l JOIN py_payroll_result r ON r.id = l.result_id
              WHERE r.run_id = ? GROUP BY l.result_id, l.wage_type_code, l.kind`,
        args: [runId],
      },
    ],
    "read",
  );
  const r = run.rows[0];
  if (!r) return new Response("Not found.", { status: 404 });

  // One column per wage type that appears, earnings before deductions.
  const codes = [
    ...new Map(
      [...lines.rows]
        .sort((a, b) => (String(a.kind) === String(b.kind) ? Number(a.sort_order) - Number(b.sort_order) : String(a.kind) === "Earning" ? -1 : 1))
        .map((l) => [String(l.wage_type_code), String(l.kind)]),
    ),
  ].filter(([code]) => code !== "UNPAID");
  const amount = new Map(lines.rows.map((l) => [`${l.result_id}:${l.wage_type_code}`, Number(l.amount)]));

  logAccess(session, { subjectEmployeeId: null, resource: "payroll run export", resourceId: runId });

  const header: Cell[] = [
    "Employee number", "Name", "Status", "Working days", "Days employed", "Unpaid days",
    ...codes.map(([code, kind]) => `${code} (${kind === "Earning" ? "earning" : "deduction"})`),
    "Gross", "Deductions", "Net", "Error",
  ];
  const period = `${r.year}-${String(r.month).padStart(2, "0")}`;
  return csvResponse(
    toCsv([
      header,
      ...results.rows.map((x) => [
        String(x.employee_number),
        String(x.name),
        String(x.status),
        Number(x.working_days),
        Number(x.employed_days),
        Number(x.unpaid_days),
        ...codes.map(([code]) => {
          const v = amount.get(`${x.id}:${code}`);
          return v === undefined ? null : rupees(v);
        }),
        rupees(Number(x.gross_paise)),
        rupees(Number(x.deductions_paise)),
        rupees(Number(x.net_paise)),
        x.error_message === null ? null : String(x.error_message),
      ]),
    ]),
    `payroll-${period}-${r.area_code}${r.run_type === "Off-cycle" ? "-off-cycle" : ""}-run${runId}.csv`,
  );
}
