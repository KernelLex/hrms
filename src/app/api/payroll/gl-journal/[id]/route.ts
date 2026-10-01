import { rawClient } from "@/lib/db";
import { can, getAccess } from "@/lib/access";
import { logAccess } from "@/lib/access-log";
import { csvResponse, rupees, toCsv, type Cell } from "@/lib/csv";

/**
 * The GL journal as a downloadable CSV: every debit and credit line of one
 * posting, for audit and as a fallback when the link to the ERP is down.
 */
export async function GET(_req: Request, ctx: RouteContext<"/api/payroll/gl-journal/[id]">) {
  const session = await getAccess();
  if (!session) return new Response("Sign in first.", { status: 401 });
  if (!can(session, "payroll.view")) return new Response("Not allowed.", { status: 403 });

  const { id } = await ctx.params;
  const postingId = Number(id);
  if (!Number.isInteger(postingId)) return new Response("Not found.", { status: 404 });

  const client = rawClient();
  const [posting, lines] = await client.batch(
    [
      {
        sql: `SELECT p.posting_date, run.id AS run_id, run.run_type, per.year, per.month, per.area_code
              FROM py_gl_posting p
              JOIN py_payroll_run run ON run.id = p.run_id
              JOIN py_payroll_period per ON per.id = run.period_id
              WHERE p.id = ?`,
        args: [postingId],
      },
      {
        sql: `SELECT gl_account, description, cost_center, debit_paise, credit_paise
              FROM py_gl_posting_line WHERE posting_id = ? ORDER BY id`,
        args: [postingId],
      },
    ],
    "read",
  );
  const p = posting.rows[0];
  if (!p) return new Response("Not found.", { status: 404 });

  const period = `${p.year}-${String(p.month).padStart(2, "0")}`;
  logAccess(session, { subjectEmployeeId: null, resource: "GL journal", resourceId: postingId });

  const header: Cell[] = ["GL account", "Description", "Cost centre", "Debit", "Credit"];
  const name = `gl-journal-${period}-${p.area_code}-run${p.run_id}.csv`.toLowerCase();
  return csvResponse(
    toCsv([
      header,
      ...lines.rows.map((l) => [
        String(l.gl_account),
        String(l.description),
        l.cost_center === null ? null : String(l.cost_center),
        Number(l.debit_paise) > 0 ? rupees(Number(l.debit_paise)) : null,
        Number(l.credit_paise) > 0 ? rupees(Number(l.credit_paise)) : null,
      ]),
    ]),
    name,
  );
}
