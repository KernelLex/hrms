import { rawClient } from "@/lib/db";
import { can, getAccess } from "@/lib/access";
import { logAccess } from "@/lib/access-log";
import { generate24QAnnexure1, generate24QAnnexure2 } from "@/lib/engines/tax-returns";

/**
 * The 24Q file for one quarter: Annexure I's challan and deductee detail
 * always, Annexure II's full salary computation only in the fourth
 * quarter. See tax-returns.ts for the exact field order.
 */
export async function GET(req: Request) {
  const session = await getAccess();
  if (!session) return new Response("Sign in first.", { status: 401 });
  if (!can(session, "tax.manage")) return new Response("Not allowed.", { status: 403 });

  const url = new URL(req.url);
  const financialYear = url.searchParams.get("financialYear") ?? "";
  const quarter = Number(url.searchParams.get("quarter"));
  if (!/^\d{4}-\d{2}$/.test(financialYear) || !(quarter >= 1 && quarter <= 4)) {
    return new Response("Give financialYear (YYYY-YY) and quarter (1 to 4).", { status: 400 });
  }

  const client = rawClient();
  const register = await client.execute({
    sql: `SELECT r.*, COALESCE(p.first_name || ' ' || p.last_name, e.employee_number) AS name,
                 (SELECT pan FROM pa_it0011_statutory_details s WHERE s.employee_id = r.employee_id AND s.valid_from <= date('now') AND s.valid_to >= date('now') ORDER BY s.valid_from DESC LIMIT 1) AS pan
          FROM tds_deduction_register r
          JOIN pa_employee e ON e.id = r.employee_id
          LEFT JOIN pa_it0002_personal_data p ON p.employee_id = e.id AND p.valid_from <= date('now') AND p.valid_to >= date('now')
          WHERE r.financial_year = ? AND r.quarter = ?
          ORDER BY e.employee_number`,
    args: [financialYear, quarter],
  });
  if (register.rows.length === 0) {
    return new Response(`Nothing is in the deduction register for ${financialYear} Q${quarter}.`, { status: 404 });
  }

  const annexure1 = generate24QAnnexure1(
    register.rows.map((r) => ({
      bsrCode: r.challan_bsr ? String(r.challan_bsr) : "NOTDEPOSITED",
      depositDate: r.deposit_date ? String(r.deposit_date) : "",
      challanSerial: String(r.id),
      employeePan: r.pan ? String(r.pan) : null,
      employeeName: String(r.name),
      paymentDate: String(r.updated_at).slice(0, 10),
      amountPaidPaise: Number(r.gross_paid_paise),
      tdsDeductedPaise: Number(r.tds_deducted_paise),
    })),
  );

  let text = `ANNEXURE I\r\n${annexure1}\r\n`;

  if (quarter === 4) {
    const form16s = await client.execute({
      sql: `SELECT f.*, COALESCE(p.first_name || ' ' || p.last_name, e.employee_number) AS name
            FROM tds_form16 f
            JOIN pa_employee e ON e.id = f.employee_id
            LEFT JOIN pa_it0002_personal_data p ON p.employee_id = e.id AND p.valid_from <= date('now') AND p.valid_to >= date('now')
            WHERE f.financial_year = ?
            ORDER BY e.employee_number`,
      args: [financialYear],
    });
    const annexure2 = generate24QAnnexure2(
      form16s.rows.map((f) => ({
        employeePan: f.employee_pan ? String(f.employee_pan) : null,
        employeeName: String(f.name),
        grossSalaryPaise: Number(f.gross_salary_paise),
        section10ExemptPaise: Number(f.section_10_exempt_paise),
        standardDeductionPaise: Number(f.standard_deduction_paise),
        chapterViaPaise: Number(f.chapter_via_paise),
        taxableIncomePaise: Number(f.taxable_income_paise),
        taxOnIncomePaise: Number(f.tax_on_income_paise),
        rebate87aPaise: Number(f.rebate_87a_paise),
        cessPaise: Number(f.cess_paise),
        totalTaxPaise: Number(f.total_tax_paise),
        tdsDeductedPaise: Number(f.tds_deducted_paise),
      })),
    );
    text += `\r\nANNEXURE II\r\n${annexure2}\r\n`;
  }

  logAccess(session, { subjectEmployeeId: null, resource: "24Q file", resourceId: `${financialYear} Q${quarter}` });

  const name = `24q-${financialYear}-q${quarter}.txt`.toLowerCase();
  return new Response(text, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
