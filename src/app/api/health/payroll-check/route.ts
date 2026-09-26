import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, rawClient } from "@/lib/db";
import { paEmployee, pyPayrollPeriod } from "@/db/schema";
import { calculateEmployee, runPayroll } from "@/lib/engines/payroll";
import { computeAnnualTax, taxOnIncome, financialYearOf, financialQuarterOf } from "@/lib/engines/tax";
import { formatINR } from "@/lib/money";

/**
 * Temporary harness for the payroll and tax engines.
 *
 * Works against the seeded employees without changing them: the calculation is
 * pure until `runPayroll` is called, which this does not do.
 */
export const dynamic = "force-dynamic";

type Check = { name: string; pass: boolean; detail: string };

export async function GET() {
  const checks: Check[] = [];
  const add = (name: string, pass: boolean, detail: string) =>
    checks.push({ name, pass, detail });

  try {
    /* ------------------------------------------------------------ tax */

    add(
      "financial year and quarter are April based",
      financialYearOf("2026-03-31") === "2025-26" &&
        financialYearOf("2026-04-01") === "2026-27" &&
        financialQuarterOf("2026-04-15") === 1 &&
        financialQuarterOf("2026-03-15") === 4,
      `31 Mar 2026 -> ${financialYearOf("2026-03-31")}, 1 Apr 2026 -> ${financialYearOf("2026-04-01")}`,
    );

    // New regime: nothing due below the first slab.
    const lowTax = await taxOnIncome(30_000_000, "New", "2025-26");
    add("no tax below the first slab", lowTax === 0, `${formatINR(lowTax)} on ₹3,00,000`);

    // ₹10,00,000 taxable under the new regime:
    //   0 on the first 4L, 5% on the next 4L = 20,000, 10% on the last 2L = 20,000
    const midTax = await taxOnIncome(100_000_000, "New", "2025-26");
    add(
      "slabs are applied cumulatively, not as a flat rate",
      midTax === 4_000_000,
      `${formatINR(midTax)} on ₹10,00,000, expected ₹40,000`,
    );

    const annual = await computeAnnualTax({
      grossSalaryPaise: 120_000_000,
      regime: "New",
      financialYear: "2025-26",
    });
    add(
      "standard deduction reduces taxable income",
      annual.taxableIncomePaise === 112_500_000,
      `₹12,00,000 gross less ₹75,000 standard = ${formatINR(annual.taxableIncomePaise)}`,
    );
    // Above the rebate limit, so the cess is actually exercised rather than
    // trivially zero.
    const taxed = await computeAnnualTax({
      grossSalaryPaise: 250_000_000,
      regime: "New",
      financialYear: "2025-26",
    });
    const afterRebate = taxed.taxOnIncomePaise - taxed.rebate87aPaise;
    add(
      "cess is 4% on top of tax after rebate",
      taxed.totalTaxPaise > 0 &&
        taxed.cessPaise > 0 &&
        taxed.cessPaise === Math.round((afterRebate * 400) / 10_000) &&
        taxed.totalTaxPaise === afterRebate + taxed.cessPaise,
      `₹25,00,000 gross -> tax ${formatINR(afterRebate)} plus cess ${formatINR(taxed.cessPaise)} = ${formatINR(taxed.totalTaxPaise)}`,
    );

    const rebated = await computeAnnualTax({
      grossSalaryPaise: 80_000_000,
      regime: "New",
      financialYear: "2025-26",
    });
    add(
      "section 87A rebate wipes out tax at low income",
      rebated.totalTaxPaise === 0,
      `₹8,00,000 gross -> ${formatINR(rebated.totalTaxPaise)} payable`,
    );

    /* -------------------------------------------------------- payroll */

    const employee = await db.query.paEmployee.findFirst({
      where: eq(paEmployee.employeeNumber, "EMP1001"),
    });
    if (!employee) throw new Error("Seeded employee EMP1001 is missing.");

    const nowDate = new Date();
    const result = await calculateEmployee({
      employeeId: employee.id,
      year: nowDate.getUTCFullYear(),
      month: nowDate.getUTCMonth() + 1,
    });

    add(
      "a seeded employee calculates without error",
      result.status === "Calculated",
      result.errorMessage ?? `net ${formatINR(result.netPaise)}`,
    );

    const earnings = result.lines
      .filter((l) => l.kind === "Earning")
      .reduce((s, l) => s + l.amountPaise, 0);
    const deductions = result.lines
      .filter((l) => l.kind === "Deduction")
      .reduce((s, l) => s + l.amountPaise, 0);

    add(
      "payslip lines sum exactly to the totals",
      earnings === result.grossPaise && deductions === result.deductionsPaise,
      `lines ${formatINR(earnings)} / ${formatINR(deductions)} vs totals ${formatINR(result.grossPaise)} / ${formatINR(result.deductionsPaise)}`,
    );

    add(
      "net equals gross less deductions",
      result.netPaise === result.grossPaise - result.deductionsPaise,
      `${formatINR(result.grossPaise)} - ${formatINR(result.deductionsPaise)} = ${formatINR(result.netPaise)}`,
    );

    const basic = result.lines.find((l) => l.wageTypeCode === "BASIC");
    const hra = result.lines.find((l) => l.wageTypeCode === "HRA");
    add(
      "percentage allowances are computed on basic",
      Boolean(basic && hra) && hra!.amountPaise === Math.round(basic!.amountPaise * 0.4),
      hra && basic
        ? `HRA ${formatINR(hra.amountPaise)} is 40% of basic ${formatINR(basic.amountPaise)}`
        : "HRA or basic line missing",
    );

    const pf = result.lines.find((l) => l.wageTypeCode === "PF");
    add(
      "provident fund respects the wage ceiling",
      Boolean(pf) && pf!.amountPaise === 180_000,
      pf ? `PF ${formatINR(pf.amountPaise)} on capped basic of ₹15,000` : "PF line missing",
    );

    // An employee with no bank details must be an error, not a silent skip.
    const client = rawClient();
    const created = await client.execute({
      sql: `INSERT INTO pa_employee (employee_number, hire_date, employment_status, created_at)
            VALUES (?, '2020-01-01', 'Active', ?) RETURNING id`,
      args: [`ZZPAY${Date.now()}`, new Date().toISOString()],
    });
    const bare = created.rows[0].id as number;
    const bareResult = await calculateEmployee({
      employeeId: bare,
      year: nowDate.getUTCFullYear(),
      month: nowDate.getUTCMonth() + 1,
    });
    add(
      "an employee who cannot be paid is reported, not skipped",
      bareResult.status === "Error" && Boolean(bareResult.errorMessage),
      bareResult.errorMessage ?? "no error raised",
    );
    await client.execute({ sql: "DELETE FROM pa_employee WHERE id = ?", args: [bare] });

    // The control record must refuse a run on an open period.
    const openPeriod = await db.query.pyPayrollPeriod.findFirst({
      where: eq(pyPayrollPeriod.status, "Open"),
    });
    if (openPeriod) {
      let refused = false;
      let message = "";
      try {
        await runPayroll({ periodId: openPeriod.id, runBy: "payroll-check" });
      } catch (err) {
        refused = true;
        message = err instanceof Error ? err.message : String(err);
      }
      add("an open period refuses to run", refused, message || "the run was allowed");
    }
  } catch (err) {
    add("engine threw", false, err instanceof Error ? err.message : String(err));
  }

  const passed = checks.filter((c) => c.pass).length;
  return NextResponse.json(
    { ok: passed === checks.length, passed, total: checks.length, checks },
    { status: passed === checks.length ? 200 : 500 },
  );
}
