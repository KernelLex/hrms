import { rawClient } from "@/lib/db";
import { can, getAccess } from "@/lib/access";
import { logAccess } from "@/lib/access-log";
import { pfRateFor, generateEcrText, type EcrRow } from "@/lib/engines/statutory";
import { periodEnd } from "@/lib/engines/payroll";

/**
 * The ECR file for a posted run: one line per member who had a PF deduction,
 * in EPFO's published pipe-delimited text format. See generateEcrText for the
 * exact field order.
 */
export async function GET(_req: Request, ctx: RouteContext<"/api/payroll/ecr/[id]">) {
  const session = await getAccess();
  if (!session) return new Response("Sign in first.", { status: 401 });
  if (!can(session, "payroll.post")) return new Response("Not allowed.", { status: 403 });

  const { id } = await ctx.params;
  const runId = Number(id);
  if (!Number.isInteger(runId)) return new Response("Not found.", { status: 404 });

  const client = rawClient();
  const [run, results, lines, statutory] = await client.batch(
    [
      {
        sql: `SELECT run.id, run.run_type, p.year, p.month, p.area_code
              FROM py_payroll_run run JOIN py_payroll_period p ON p.id = run.period_id WHERE run.id = ?`,
        args: [runId],
      },
      {
        sql: `SELECT r.id, r.employee_id, r.gross_paise, r.unpaid_days, e.employee_number,
                     COALESCE(pd.first_name || ' ' || pd.last_name, e.employee_number) AS name
              FROM py_payroll_result r JOIN pa_employee e ON e.id = r.employee_id
              LEFT JOIN pa_it0002_personal_data pd
                ON pd.employee_id = e.id AND pd.valid_from <= date('now') AND pd.valid_to >= date('now')
              WHERE r.run_id = ? AND r.status = 'Calculated' ORDER BY e.employee_number`,
        args: [runId],
      },
      {
        sql: `SELECT l.result_id, l.wage_type_code, l.amount_paise
              FROM py_payroll_result_line l JOIN py_payroll_result r ON r.id = l.result_id
              WHERE r.run_id = ? AND l.wage_type_code IN ('BASIC', 'PF', 'EPS_ER', 'EPF_ER')`,
        args: [runId],
      },
      {
        sql: `SELECT employee_id, uan FROM pa_it0011_statutory_details
              WHERE employee_id IN (SELECT employee_id FROM py_payroll_result WHERE run_id = ?)`,
        args: [runId],
      },
    ],
    "read",
  );
  const r = run.rows[0];
  if (!r) return new Response("Not found.", { status: 404 });

  const period = `${r.year}-${String(r.month).padStart(2, "0")}`;
  const asOfDate = periodEnd(Number(r.year), Number(r.month));
  const pfRate = await pfRateFor(asOfDate);
  const ceilingPaise = pfRate?.wageCeilingPaise ?? 1_500_000;

  const byResult = new Map<number, Record<string, number>>();
  for (const l of lines.rows) {
    const resultId = Number(l.result_id);
    if (!byResult.has(resultId)) byResult.set(resultId, {});
    byResult.get(resultId)![String(l.wage_type_code)] = Number(l.amount_paise);
  }
  const uanByEmployee = new Map(statutory.rows.map((s) => [Number(s.employee_id), s.uan === null ? "" : String(s.uan)]));

  const rows: EcrRow[] = results.rows
    .map((res) => {
      const line = byResult.get(Number(res.id)) ?? {};
      const employeePf = line.PF ?? 0;
      if (employeePf <= 0) return null;
      const basic = line.BASIC ?? 0;
      const pfWages = Math.min(basic, ceilingPaise);
      return {
        uan: uanByEmployee.get(Number(res.employee_id)) ?? "",
        memberName: String(res.name),
        grossWagesPaise: Number(res.gross_paise),
        pfWagesPaise: pfWages,
        epsWagesPaise: pfWages,
        edliWagesPaise: pfWages,
        employeePfPaise: employeePf,
        epsPaise: line.EPS_ER ?? 0,
        employerPfPaise: line.EPF_ER ?? 0,
        ncpDays: Number(res.unpaid_days),
        refundOfAdvancesPaise: 0,
      } satisfies EcrRow;
    })
    .filter((row): row is EcrRow => row !== null);

  logAccess(session, { subjectEmployeeId: null, resource: "ECR file", resourceId: runId });

  const name = `ecr-${period}-${r.area_code}-run${runId}.txt`.toLowerCase();
  return new Response(generateEcrText(rows) + "\r\n", {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
