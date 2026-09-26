import { rawClient } from "@/lib/db";
import { getSession, hasRole } from "@/lib/auth";
import { logAccess } from "@/lib/access-log";
import { csvCell } from "@/lib/csv";

/**
 * The bank transfer file as a download: one NEFT bulk-upload row per payee.
 *
 * Rendered from the stored transfer lines each time rather than kept as a
 * file, because the lines are the record — a stored copy could only ever
 * agree with them or be wrong.
 */
export async function GET(_req: Request, ctx: RouteContext<"/api/payroll/bank-file/[id]">) {
  const session = await getSession();
  if (!session) return new Response("Sign in first.", { status: 401 });
  if (!hasRole(session, "HR_ADMIN")) return new Response("Not allowed.", { status: 403 });

  const { id } = await ctx.params;
  const fileId = Number(id);
  if (!Number.isInteger(fileId)) return new Response("Not found.", { status: 404 });

  const client = rawClient();
  const [file, lines] = await client.batch(
    [
      {
        sql: `SELECT f.id, f.payment_date, run.id AS run_id, run.run_type, p.year, p.month, p.area_code
              FROM py_bank_transfer_file f
              JOIN py_payroll_run run ON run.id = f.run_id
              JOIN py_payroll_period p ON p.id = run.period_id
              WHERE f.id = ?`,
        args: [fileId],
      },
      {
        sql: `SELECT l.employee_name, l.account_number, l.ifsc, l.amount_paise, e.employee_number
              FROM py_bank_transfer_line l JOIN pa_employee e ON e.id = l.employee_id
              WHERE l.file_id = ? ORDER BY e.employee_number`,
        args: [fileId],
      },
    ],
    "read",
  );
  const f = file.rows[0];
  if (!f) return new Response("Not found.", { status: 404 });

  const period = `${f.year}-${String(f.month).padStart(2, "0")}`;
  const reference = `SAL ${period}${f.run_type === "Off-cycle" ? " OFF" : ""}`;
  const csv = [
    ["Beneficiary name", "Account number", "IFSC", "Amount", "Payment date", "Reference"],
    ...lines.rows.map((l) => [
      String(l.employee_name),
      String(l.account_number),
      l.ifsc === null ? "" : String(l.ifsc),
      // Paise to rupees by string, never through a float.
      `${Math.trunc(Number(l.amount_paise) / 100)}.${String(Math.abs(Number(l.amount_paise)) % 100).padStart(2, "0")}`,
      String(f.payment_date),
      `${reference} ${l.employee_number}`,
    ]),
  ]
    .map((row) => row.map(csvCell).join(","))
    .join("\r\n");

  logAccess(session, { subjectEmployeeId: null, resource: "bank file", resourceId: fileId });

  const name = `neft-${period}-${f.area_code}-run${f.run_id}.csv`.toLowerCase();
  // No byte-order mark: bank upload portals are stricter than spreadsheets.
  return new Response(`${csv}\r\n`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
