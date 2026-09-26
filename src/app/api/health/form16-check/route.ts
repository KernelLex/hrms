import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, rawClient } from "@/lib/db";
import {
  tdsDeductionRegister,
  tdsEmployeeDeclaration,
  tdsForm16,
  pyPayrollPeriod,
  pyPayrollRun,
  pyPayrollResult,
  pyPayrollResultLine,
  omPersonnelArea,
} from "@/db/schema";
import { financialQuarterOf, financialYearOf } from "@/lib/engines/tax";
import { formatINR } from "@/lib/money";

/**
 * Temporary harness for the register and Form 16.
 *
 * Fabricates a year of payroll results for a throwaway employee, builds the
 * register from them, generates the certificate, and checks that Part A and
 * Part B agree. Removes everything afterwards.
 */
export const dynamic = "force-dynamic";

type Check = { name: string; pass: boolean; detail: string };

export async function GET() {
  const client = rawClient();
  const checks: Check[] = [];
  const add = (name: string, pass: boolean, detail: string) =>
    checks.push({ name, pass, detail });

  let employeeId: number | undefined;
  const periodIds: number[] = [];

  try {
    const stamp = Date.now();
    const financialYear = "2025-26";
    // High enough that tax is genuinely payable: a salary under the rebate
    // limit would make the cess and rebate lines trivially zero and prove
    // nothing about the arithmetic.
    const monthlyGross = 200_000_00; // ₹2,00,000 a month, ₹24,00,000 a year
    const monthlyTds = 30_000_00; // ₹30,000 a month

    const area = await db.query.omPersonnelArea.findFirst({
      where: eq(omPersonnelArea.isActive, true),
    });
    if (!area) throw new Error("No personnel area seeded.");

    const created = await client.execute({
      sql: `INSERT INTO pa_employee (employee_number, hire_date, employment_status, created_at)
            VALUES (?, '2020-01-01', 'Active', ?) RETURNING id`,
      args: [`ZZF16${stamp}`, new Date().toISOString()],
    });
    employeeId = created.rows[0].id as number;

    // Twelve months of payroll results across FY 2025-26 (Apr 2025 to Mar 2026).
    for (let i = 0; i < 12; i += 1) {
      const month = ((3 + i) % 12) + 1;
      const year = month >= 4 ? 2025 : 2026;

      const [period] = await db
        .insert(pyPayrollPeriod)
        .values({
          areaCode: area.code,
          year,
          month,
          status: "Posted",
          payDate: null,
        })
        .onConflictDoNothing()
        .returning({ id: pyPayrollPeriod.id });

      const periodId =
        period?.id ??
        (
          await db.query.pyPayrollPeriod.findFirst({
            where: and(
              eq(pyPayrollPeriod.areaCode, area.code),
              eq(pyPayrollPeriod.year, year),
              eq(pyPayrollPeriod.month, month),
            ),
          })
        )?.id;
      if (!periodId) continue;
      if (period?.id) periodIds.push(period.id);

      const [run] = await db
        .insert(pyPayrollRun)
        .values({
          periodId,
          runAt: new Date().toISOString(),
          runBy: "form16-check",
          employeeCount: 1,
          errorCount: 0,
          grossTotalPaise: monthlyGross,
          netTotalPaise: monthlyGross - monthlyTds,
        })
        .returning({ id: pyPayrollRun.id });

      const [result] = await db
        .insert(pyPayrollResult)
        .values({
          runId: run.id,
          employeeId,
          grossPaise: monthlyGross,
          deductionsPaise: monthlyTds,
          netPaise: monthlyGross - monthlyTds,
          status: "Calculated",
        })
        .returning({ id: pyPayrollResult.id });

      await db.insert(pyPayrollResultLine).values({
        resultId: result.id,
        wageTypeCode: "TDS",
        wageTypeName: "Income tax (TDS)",
        kind: "Deduction",
        amountPaise: monthlyTds,
        sortOrder: 120,
      });
    }

    add(
      "financial year runs April to March",
      financialYearOf("2025-04-01") === financialYear &&
        financialYearOf("2026-03-31") === financialYear &&
        financialQuarterOf("2026-01-15") === 4,
      "Apr 2025 and Mar 2026 both fall in 2025-26",
    );

    // A declaration under the old regime, so exemptions are exercised.
    await db.insert(tdsEmployeeDeclaration).values({
      employeeId,
      financialYear,
      regime: "Old",
      section80CPaise: 15_000_00,
      section80DPaise: 2_500_00,
      hraExemptionPaise: 14_400_00,
      otherIncomePaise: 0,
      status: "Verified",
      updatedAt: new Date().toISOString(),
    });

    const { buildRegister, generateForm16 } = await import("@/app/actions/tax");

    const buildForm = new FormData();
    buildForm.set("financialYear", financialYear);
    const built = await buildRegister({}, buildForm);

    const register = await db
      .select()
      .from(tdsDeductionRegister)
      .where(
        and(
          eq(tdsDeductionRegister.employeeId, employeeId),
          eq(tdsDeductionRegister.financialYear, financialYear),
        ),
      );

    add(
      "the register buckets twelve months into four quarters",
      built.ok === true && register.length === 4,
      `${register.length} quarters: ${register.map((r) => `Q${r.quarter}`).join(" ")}`,
    );

    add(
      "each quarter holds three months of deductions",
      register.every((r) => r.tdsDeductedPaise === monthlyTds * 3),
      register.map((r) => formatINR(r.tdsDeductedPaise)).join(", "),
    );

    const genForm = new FormData();
    genForm.set("employeeId", String(employeeId));
    genForm.set("financialYear", financialYear);
    const generated = await generateForm16({}, genForm);

    const cert = await db.query.tdsForm16.findFirst({
      where: and(
        eq(tdsForm16.employeeId, employeeId),
        eq(tdsForm16.financialYear, financialYear),
      ),
    });

    add(
      "a certificate is produced",
      generated.ok === true && Boolean(cert),
      generated.error ?? cert?.certificateNo ?? "none",
    );

    if (cert) {
      const registerGross = register.reduce((s, r) => s + r.grossPaidPaise, 0);
      const registerTds = register.reduce((s, r) => s + r.tdsDeductedPaise, 0);

      add(
        "Part B's gross equals Part A's total paid",
        cert.grossSalaryPaise === registerGross,
        `${formatINR(cert.grossSalaryPaise)} vs ${formatINR(registerGross)}`,
      );

      add(
        "Part B's tax deducted equals Part A's total deducted",
        cert.tdsDeductedPaise === registerTds,
        `${formatINR(cert.tdsDeductedPaise)} vs ${formatINR(registerTds)}`,
      );

      const expectedTaxable = Math.max(
        0,
        cert.grossSalaryPaise -
          cert.section10ExemptPaise -
          cert.standardDeductionPaise -
          cert.chapterViaPaise,
      );
      add(
        "taxable income is gross less exemptions, standard deduction and Chapter VI-A",
        cert.taxableIncomePaise === expectedTaxable,
        `${formatINR(cert.grossSalaryPaise)} - ${formatINR(cert.section10ExemptPaise)} - ${formatINR(cert.standardDeductionPaise)} - ${formatINR(cert.chapterViaPaise)} = ${formatINR(cert.taxableIncomePaise)}`,
      );

      add(
        "total tax is tax less rebate plus cess, and is actually non-zero",
        cert.totalTaxPaise > 0 &&
          cert.cessPaise > 0 &&
          cert.totalTaxPaise ===
            cert.taxOnIncomePaise - cert.rebate87aPaise + cert.cessPaise,
        `${formatINR(cert.taxOnIncomePaise)} - ${formatINR(cert.rebate87aPaise)} + ${formatINR(cert.cessPaise)} = ${formatINR(cert.totalTaxPaise)}`,
      );

      add(
        "the balance is what was owed less what was taken",
        cert.balancePaise === cert.totalTaxPaise - cert.tdsDeductedPaise,
        cert.balancePaise < 0
          ? `refund of ${formatINR(Math.abs(cert.balancePaise))}`
          : `payable ${formatINR(cert.balancePaise)}`,
      );

      add(
        "the old regime applied the declared exemptions",
        cert.regime === "Old" &&
          cert.chapterViaPaise === 17_500_00 &&
          cert.section10ExemptPaise === 14_400_00,
        `Chapter VI-A ${formatINR(cert.chapterViaPaise)}, section 10 ${formatINR(cert.section10ExemptPaise)}`,
      );
    }
  } catch (err) {
    add("chain threw", false, err instanceof Error ? err.message : String(err));
  } finally {
    if (employeeId) {
      await client.execute({ sql: "DELETE FROM pa_employee WHERE id = ?", args: [employeeId] });
    }
    for (const id of periodIds) {
      await client.execute({ sql: "DELETE FROM py_payroll_period WHERE id = ?", args: [id] });
    }
  }

  const passed = checks.filter((c) => c.pass).length;
  return NextResponse.json(
    { ok: passed === checks.length, passed, total: checks.length, checks },
    { status: passed === checks.length ? 200 : 500 },
  );
}
