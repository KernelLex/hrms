import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
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
import { buildRegister, generateForm16 } from "@/app/actions/tax";
import { createBareEmployee, form } from "./support/fixtures";

/**
 * The register and the certificate: a year of payroll results bucketed into
 * quarters (Part A), and the year's liability recomputed from the same gross
 * and the employee's declaration (Part B). The two halves must agree.
 */

const FY = "2025-26";
// High enough that tax is genuinely payable, so cess and rebate are exercised.
const MONTHLY_GROSS = 200_000_00; // ₹2,00,000 a month
const MONTHLY_TDS = 30_000_00; // ₹30,000 a month

let employeeId: number;

const register = () =>
  db
    .select()
    .from(tdsDeductionRegister)
    .where(
      and(
        eq(tdsDeductionRegister.employeeId, employeeId),
        eq(tdsDeductionRegister.financialYear, FY),
      ),
    );

const certificate = () =>
  db.query.tdsForm16.findFirst({
    where: and(eq(tdsForm16.employeeId, employeeId), eq(tdsForm16.financialYear, FY)),
  });

describe("register and Form 16", () => {
  beforeAll(async () => {
    const area = await db.query.omPersonnelArea.findFirst({
      where: eq(omPersonnelArea.isActive, true),
    });
    if (!area) throw new Error("No personnel area seeded.");

    employeeId = await createBareEmployee("ZZF16");

    // Twelve posted months, April 2025 to March 2026.
    for (let i = 0; i < 12; i += 1) {
      const month = ((3 + i) % 12) + 1;
      const year = month >= 4 ? 2025 : 2026;

      await db
        .insert(pyPayrollPeriod)
        .values({ areaCode: area.code, year, month, status: "Posted", payDate: null })
        .onConflictDoNothing();
      const period = await db.query.pyPayrollPeriod.findFirst({
        where: and(
          eq(pyPayrollPeriod.areaCode, area.code),
          eq(pyPayrollPeriod.year, year),
          eq(pyPayrollPeriod.month, month),
        ),
      });

      const [run] = await db
        .insert(pyPayrollRun)
        .values({
          periodId: period!.id,
          runAt: new Date().toISOString(),
          runBy: "test",
          employeeCount: 1,
          errorCount: 0,
          grossTotalPaise: MONTHLY_GROSS,
          netTotalPaise: MONTHLY_GROSS - MONTHLY_TDS,
        })
        .returning({ id: pyPayrollRun.id });

      const [result] = await db
        .insert(pyPayrollResult)
        .values({
          runId: run.id,
          employeeId,
          grossPaise: MONTHLY_GROSS,
          deductionsPaise: MONTHLY_TDS,
          netPaise: MONTHLY_GROSS - MONTHLY_TDS,
          status: "Calculated",
        })
        .returning({ id: pyPayrollResult.id });

      await db.insert(pyPayrollResultLine).values({
        resultId: result.id,
        wageTypeCode: "TDS",
        wageTypeName: "Income tax (TDS)",
        kind: "Deduction",
        amountPaise: MONTHLY_TDS,
        sortOrder: 120,
      });
    }

    // The old regime, so declared exemptions are actually applied.
    await db.insert(tdsEmployeeDeclaration).values({
      employeeId,
      financialYear: FY,
      regime: "Old",
      section80CPaise: 15_000_00,
      section80DPaise: 2_500_00,
      hraExemptionPaise: 14_400_00,
      otherIncomePaise: 0,
      status: "Verified",
      updatedAt: new Date().toISOString(),
    });
  });

  it("runs the financial year April to March", () => {
    expect(financialYearOf("2025-04-01")).toBe(FY);
    expect(financialYearOf("2026-03-31")).toBe(FY);
    expect(financialQuarterOf("2026-01-15")).toBe(4);
  });

  it("buckets twelve months into four quarters", async () => {
    const result = await buildRegister({}, form({ financialYear: FY }));
    expect(result.error).toBeUndefined();
    expect((await register()).map((r) => r.quarter).sort()).toEqual([1, 2, 3, 4]);
  });

  it("holds three months of deductions in each quarter", async () => {
    for (const q of await register()) expect(q.tdsDeductedPaise).toBe(MONTHLY_TDS * 3);
  });

  it("produces a certificate", async () => {
    const result = await generateForm16({}, form({ employeeId, financialYear: FY }));
    expect(result.error).toBeUndefined();
    expect(await certificate()).toBeDefined();
  });

  it("carries Part A's total paid into Part B's gross", async () => {
    const paid = (await register()).reduce((s, r) => s + r.grossPaidPaise, 0);
    expect((await certificate())!.grossSalaryPaise).toBe(paid);
  });

  it("carries Part A's total deducted into Part B", async () => {
    const deducted = (await register()).reduce((s, r) => s + r.tdsDeductedPaise, 0);
    expect((await certificate())!.tdsDeductedPaise).toBe(deducted);
  });

  it("computes taxable income as gross less exemptions and deductions", async () => {
    const c = (await certificate())!;
    expect(c.taxableIncomePaise).toBe(
      Math.max(
        0,
        c.grossSalaryPaise - c.section10ExemptPaise - c.standardDeductionPaise - c.chapterViaPaise,
      ),
    );
  });

  it("computes total tax as tax less rebate plus cess, and it is not zero", async () => {
    const c = (await certificate())!;
    expect(c.totalTaxPaise).toBeGreaterThan(0);
    expect(c.cessPaise).toBeGreaterThan(0);
    expect(c.totalTaxPaise).toBe(c.taxOnIncomePaise - c.rebate87aPaise + c.cessPaise);
  });

  it("states the balance as what was owed less what was taken", async () => {
    const c = (await certificate())!;
    expect(c.balancePaise).toBe(c.totalTaxPaise - c.tdsDeductedPaise);
  });

  it("applies the declared exemptions under the old regime", async () => {
    const c = (await certificate())!;
    expect(c.regime).toBe("Old");
    expect(c.chapterViaPaise).toBe(17_500_00);
    expect(c.section10ExemptPaise).toBe(14_400_00);
  });
});
