import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { paEmployee, pyPayrollPeriod } from "@/db/schema";
import { calculateEmployee, runPayroll } from "@/lib/engines/payroll";
import {
  computeAnnualTax,
  taxOnIncome,
  financialYearOf,
  financialQuarterOf,
} from "@/lib/engines/tax";
import { createBareEmployee } from "./support/fixtures";

/**
 * Gross to net, and the tax arithmetic underneath it.
 *
 * Tax figures are chosen so each rule is actually exercised: a cess check on
 * a salary under the rebate limit would pass with zero tax and prove nothing.
 */

const rupees = (n: number) => n * 100;

describe("tax engine", () => {
  it("uses an April-to-March financial year", () => {
    expect(financialYearOf("2026-03-31")).toBe("2025-26");
    expect(financialYearOf("2026-04-01")).toBe("2026-27");
    expect(financialQuarterOf("2026-04-15")).toBe(1);
    expect(financialQuarterOf("2026-03-15")).toBe(4);
  });

  it("charges nothing below the first slab", async () => {
    expect(await taxOnIncome(rupees(300_000), "New", "2025-26")).toBe(0);
  });

  it("applies slabs cumulatively, not as a flat rate", async () => {
    // 0 on the first 4L, 5% of the next 4L, 10% of the last 2L = 40,000
    expect(await taxOnIncome(rupees(1_000_000), "New", "2025-26")).toBe(rupees(40_000));
  });

  it("takes the standard deduction off taxable income", async () => {
    const t = await computeAnnualTax({
      grossSalaryPaise: rupees(1_200_000),
      regime: "New",
      financialYear: "2025-26",
    });
    expect(t.taxableIncomePaise).toBe(rupees(1_125_000));
  });

  it("adds 4% cess on top of tax after the rebate", async () => {
    const t = await computeAnnualTax({
      grossSalaryPaise: rupees(2_500_000),
      regime: "New",
      financialYear: "2025-26",
    });
    const afterRebate = t.taxOnIncomePaise - t.rebate87aPaise;
    expect(t.cessPaise).toBeGreaterThan(0);
    expect(t.cessPaise).toBe(Math.round((afterRebate * 400) / 10_000));
    expect(t.totalTaxPaise).toBe(afterRebate + t.cessPaise);
  });

  it("lets the section 87A rebate wipe out tax at low income", async () => {
    const t = await computeAnnualTax({
      grossSalaryPaise: rupees(800_000),
      regime: "New",
      financialYear: "2025-26",
    });
    expect(t.totalTaxPaise).toBe(0);
  });
});

describe("payroll engine", () => {
  const now = new Date();
  const period = { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 };

  async function seededResult() {
    const employee = await db.query.paEmployee.findFirst({
      where: eq(paEmployee.employeeNumber, "EMP1001"),
    });
    expect(employee, "seeded employee EMP1001").toBeDefined();
    return calculateEmployee({ employeeId: employee!.id, ...period });
  }

  it("calculates a seeded employee without error", async () => {
    const r = await seededResult();
    expect(r.errorMessage ?? null).toBeNull();
    expect(r.status).toBe("Calculated");
  });

  it("derives the totals from the lines, so they sum exactly", async () => {
    const r = await seededResult();
    const sum = (kind: string) =>
      r.lines.filter((l) => l.kind === kind).reduce((s, l) => s + l.amountPaise, 0);
    expect(sum("Earning")).toBe(r.grossPaise);
    expect(sum("Deduction")).toBe(r.deductionsPaise);
  });

  it("pays net as gross less deductions", async () => {
    const r = await seededResult();
    expect(r.netPaise).toBe(r.grossPaise - r.deductionsPaise);
  });

  it("computes percentage allowances on basic", async () => {
    const r = await seededResult();
    const basic = r.lines.find((l) => l.wageTypeCode === "BASIC");
    const hra = r.lines.find((l) => l.wageTypeCode === "HRA");
    expect(basic && hra).toBeTruthy();
    expect(hra!.amountPaise).toBe(Math.round(basic!.amountPaise * 0.4));
  });

  it("caps provident fund at the wage ceiling", async () => {
    const r = await seededResult();
    const pf = r.lines.find((l) => l.wageTypeCode === "PF");
    // 12% of the ₹15,000 ceiling, not of the full basic.
    expect(pf?.amountPaise).toBe(rupees(1_800));
  });

  it("reports an employee who cannot be paid rather than skipping them", async () => {
    const bare = await createBareEmployee("ZZPAY");
    const r = await calculateEmployee({ employeeId: bare, ...period });
    expect(r.status).toBe("Error");
    expect(r.errorMessage).toBeTruthy();
  });

  it("refuses to run a period that is still open", async () => {
    const open = await db.query.pyPayrollPeriod.findFirst({
      where: eq(pyPayrollPeriod.status, "Open"),
    });
    expect(open, "the seed opens a period for the current month").toBeDefined();
    await expect(runPayroll({ periodId: open!.id, runBy: "test" })).rejects.toThrow();
  });
});
