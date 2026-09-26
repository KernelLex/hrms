import { rawClient } from "@/lib/db";
import { can, getAccess } from "@/lib/access";
import { logAccess } from "@/lib/access-log";
import { csvResponse, rupees, toCsv } from "@/lib/csv";

/**
 * The quarterly deduction register as CSV: the working file for preparing a
 * 24Q return. HR only.
 */
export async function GET(req: Request) {
  const session = await getAccess();
  if (!session) return new Response("Sign in first.", { status: 401 });
  if (!can(session, "tax.manage")) return new Response("Not allowed.", { status: 403 });

  const fy = new URL(req.url).searchParams.get("fy") ?? "";
  if (!/^\d{4}-\d{2}$/.test(fy)) return new Response("Choose a financial year.", { status: 400 });

  const rows = await rawClient().execute({
    sql: `SELECT e.employee_number,
                 COALESCE(p.first_name || ' ' || p.last_name, e.employee_number) AS name,
                 r.quarter, r.gross_paid_paise, r.tds_deducted_paise, r.challan_bsr,
                 r.deposit_date, r.receipt_24q
          FROM tds_deduction_register r
          JOIN pa_employee e ON e.id = r.employee_id
          LEFT JOIN pa_it0002_personal_data p
            ON p.employee_id = e.id AND p.valid_from <= date('now') AND p.valid_to >= date('now')
          WHERE r.financial_year = ?
          ORDER BY e.employee_number, r.quarter`,
    args: [fy],
  });

  logAccess(session, { subjectEmployeeId: null, resource: "tax register export", resourceId: fy });

  return csvResponse(
    toCsv([
      ["Employee number", "Name", "Financial year", "Quarter", "Gross paid", "TDS deducted", "Challan BSR", "Deposit date", "24Q receipt"],
      ...rows.rows.map((r) => [
        String(r.employee_number),
        String(r.name),
        fy,
        `Q${r.quarter}`,
        rupees(Number(r.gross_paid_paise)),
        rupees(Number(r.tds_deducted_paise)),
        r.challan_bsr === null ? null : String(r.challan_bsr),
        r.deposit_date === null ? null : String(r.deposit_date),
        r.receipt_24q === null ? null : String(r.receipt_24q),
      ]),
    ]),
    `tds-register-${fy}.csv`,
  );
}
