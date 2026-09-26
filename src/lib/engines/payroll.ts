import "server-only";
import { and, eq, lte, gte, asc } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  pyWageType,
  pyRecurringPayment,
  pyAdditionalPayment,
  pyPayrollRun,
  pyPayrollResult,
  pyPayrollResultLine,
  pyPayrollPeriod,
  paEmployee,
  paOrgAssignment,
  tdsEmployeeDeclaration,
  now,
} from "@/db/schema";
import { readAsOf, SLICED_TABLES } from "./timeslice";
import { unpaidDaysInPeriod } from "./time-evaluation";
import { financialYearOf, monthlyTds } from "./tax";
import { percentOf } from "@/lib/money";

/**
 * The payroll engine: gross to net.
 *
 * Order matters, because each step feeds the next:
 *
 *   basic pay valid in the period
 *     -> prorated for unpaid absence
 *     -> percentage allowances computed on the prorated basic
 *     -> recurring and one-off payments added
 *     -> PF and TDS deducted
 *     -> net
 *
 * Every amount is INTEGER paise and every division rounds once, at the point
 * it happens, so the lines always sum exactly to the totals.
 *
 * An employee with no bank details is recorded as an error rather than skipped
 * silently — a run that quietly pays fewer people than expected is worse than
 * one that says which people it could not pay.
 */

export type PayrollLine = {
  wageTypeCode: string;
  wageTypeName: string;
  kind: "Earning" | "Deduction";
  amountPaise: number;
  sortOrder: number;
};

export type EmployeeResult = {
  employeeId: number;
  grossPaise: number;
  deductionsPaise: number;
  netPaise: number;
  unpaidDays: number;
  workingDays: number;
  status: "Calculated" | "Error";
  errorMessage?: string;
  lines: PayrollLine[];
};

/** EPF is 12% of basic, and basic is capped at ₹15,000 for the calculation. */
const PF_WAGE_CEILING_PAISE = 1_500_000;

function periodEnd(year: number, month: number): string {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
}

function periodStart(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

/** April is month 1 of the financial year. */
function financialMonthIndex(month: number): number {
  return ((month - 4 + 12) % 12) + 1;
}

export async function calculateEmployee(opts: {
  employeeId: number;
  year: number;
  month: number;
}): Promise<EmployeeResult> {
  const { employeeId, year, month } = opts;
  const from = periodStart(year, month);
  const to = periodEnd(year, month);

  const base: EmployeeResult = {
    employeeId,
    grossPaise: 0,
    deductionsPaise: 0,
    netPaise: 0,
    unpaidDays: 0,
    workingDays: 0,
    status: "Calculated",
    lines: [],
  };

  const basicPay = await readAsOf<{ amount_paise: number }>(
    SLICED_TABLES.basicPay,
    employeeId,
    to,
  );
  if (!basicPay) {
    return {
      ...base,
      status: "Error",
      errorMessage: "No basic pay is valid for this period (IT0008).",
    };
  }

  const bank = await readAsOf<{ account_number: string }>(
    SLICED_TABLES.bankDetails,
    employeeId,
    to,
  );
  if (!bank) {
    return {
      ...base,
      status: "Error",
      errorMessage: "No bank details on record (IT0009), so the salary cannot be paid.",
    };
  }

  const { unpaidDays, workingDays } = await unpaidDaysInPeriod(employeeId, year, month);

  // Unpaid absence reduces the basic, and everything derived from it.
  const paidDays = Math.max(0, workingDays - unpaidDays);
  const fullBasic = Number(basicPay.amount_paise);
  const basic =
    workingDays > 0 && unpaidDays > 0
      ? Math.round((fullBasic * paidDays) / workingDays)
      : fullBasic;

  const lines: PayrollLine[] = [];
  const wageTypes = await db
    .select()
    .from(pyWageType)
    .where(eq(pyWageType.isActive, true))
    .orderBy(asc(pyWageType.sortOrder));

  const basicType = wageTypes.find((w) => w.code === "BASIC");
  lines.push({
    wageTypeCode: "BASIC",
    wageTypeName: basicType?.name ?? "Basic salary",
    kind: "Earning",
    amountPaise: basic,
    sortOrder: basicType?.sortOrder ?? 10,
  });

  if (unpaidDays > 0) {
    lines.push({
      wageTypeCode: "UNPAID",
      wageTypeName: `Unpaid absence (${unpaidDays} of ${workingDays} days)`,
      kind: "Deduction",
      amountPaise: 0, // already reflected in the prorated basic
      sortOrder: 15,
    });
  }

  // Automatic percentage allowances, computed on the prorated basic.
  for (const w of wageTypes) {
    if (!w.isAutomatic || w.kind !== "Earning") continue;
    if (w.amountType !== "PercentOfBasic" || !w.percentBasisPoints) continue;
    const amount = Math.round((basic * w.percentBasisPoints) / 10_000);
    if (amount === 0) continue;
    lines.push({
      wageTypeCode: w.code,
      wageTypeName: w.name,
      kind: "Earning",
      amountPaise: amount,
      sortOrder: w.sortOrder,
    });
  }

  // Recurring payments and deductions active in the period.
  const recurring = await db
    .select({
      amountPaise: pyRecurringPayment.amountPaise,
      code: pyWageType.code,
      name: pyWageType.name,
      kind: pyWageType.kind,
      sortOrder: pyWageType.sortOrder,
    })
    .from(pyRecurringPayment)
    .innerJoin(pyWageType, eq(pyWageType.code, pyRecurringPayment.wageTypeCode))
    .where(
      and(
        eq(pyRecurringPayment.employeeId, employeeId),
        lte(pyRecurringPayment.startDate, to),
        gte(pyRecurringPayment.endDate, from),
      ),
    );

  for (const r of recurring) {
    lines.push({
      wageTypeCode: r.code,
      wageTypeName: r.name,
      kind: r.kind as "Earning" | "Deduction",
      amountPaise: r.amountPaise,
      sortOrder: r.sortOrder,
    });
  }

  // One-off payments dated inside the period.
  const additional = await db
    .select({
      amountPaise: pyAdditionalPayment.amountPaise,
      code: pyWageType.code,
      name: pyWageType.name,
      kind: pyWageType.kind,
      sortOrder: pyWageType.sortOrder,
    })
    .from(pyAdditionalPayment)
    .innerJoin(pyWageType, eq(pyWageType.code, pyAdditionalPayment.wageTypeCode))
    .where(
      and(
        eq(pyAdditionalPayment.employeeId, employeeId),
        gte(pyAdditionalPayment.paymentDate, from),
        lte(pyAdditionalPayment.paymentDate, to),
      ),
    );

  for (const a of additional) {
    lines.push({
      wageTypeCode: a.code,
      wageTypeName: a.name,
      kind: a.kind as "Earning" | "Deduction",
      amountPaise: a.amountPaise,
      sortOrder: a.sortOrder,
    });
  }

  // Provident fund, on capped basic.
  const pfType = wageTypes.find((w) => w.formulaKey === "PF");
  if (pfType) {
    const pfBase = Math.min(basic, PF_WAGE_CEILING_PAISE);
    const pf = percentOf(pfBase, (pfType.percentBasisPoints ?? 1200) / 100);
    if (pf > 0) {
      lines.push({
        wageTypeCode: pfType.code,
        wageTypeName: pfType.name,
        kind: "Deduction",
        amountPaise: pf,
        sortOrder: pfType.sortOrder,
      });
    }
  }

  const taxableEarnings = lines
    .filter((l) => l.kind === "Earning")
    .reduce((sum, l) => {
      const wt = wageTypes.find((w) => w.code === l.wageTypeCode);
      return wt && wt.isTaxable === false ? sum : sum + l.amountPaise;
    }, 0);

  // Income tax, projected across the financial year so months stay even.
  const tdsType = wageTypes.find((w) => w.formulaKey === "TDS");
  if (tdsType) {
    const financialYear = financialYearOf(to);
    const declaration = await db.query.tdsEmployeeDeclaration.findFirst({
      where: and(
        eq(tdsEmployeeDeclaration.employeeId, employeeId),
        eq(tdsEmployeeDeclaration.financialYear, financialYear),
      ),
    });

    const tds = await monthlyTds({
      monthlyTaxableGrossPaise: taxableEarnings,
      monthIndexInYear: financialMonthIndex(month),
      regime: (declaration?.regime as "Old" | "New") ?? "New",
      financialYear,
      section10ExemptPaise: declaration?.hraExemptionPaise ?? 0,
      chapterViaPaise:
        (declaration?.section80CPaise ?? 0) + (declaration?.section80DPaise ?? 0),
    });

    if (tds > 0) {
      lines.push({
        wageTypeCode: tdsType.code,
        wageTypeName: tdsType.name,
        kind: "Deduction",
        amountPaise: tds,
        sortOrder: tdsType.sortOrder,
      });
    }
  }

  const grossPaise = lines
    .filter((l) => l.kind === "Earning")
    .reduce((s, l) => s + l.amountPaise, 0);
  const deductionsPaise = lines
    .filter((l) => l.kind === "Deduction")
    .reduce((s, l) => s + l.amountPaise, 0);

  return {
    employeeId,
    grossPaise,
    deductionsPaise,
    netPaise: grossPaise - deductionsPaise,
    unpaidDays,
    workingDays,
    status: "Calculated",
    lines: lines.sort((a, b) => a.sortOrder - b.sortOrder),
  };
}

/**
 * Runs payroll for a period and stores the results.
 *
 * A previous run for the same period is replaced, so re-running after fixing
 * a record does not leave two sets of numbers claiming to be the same month.
 */
export async function runPayroll(opts: {
  periodId: number;
  runBy: string;
}): Promise<{ runId: number; results: EmployeeResult[] }> {
  const { periodId, runBy } = opts;

  const period = await db.query.pyPayrollPeriod.findFirst({
    where: eq(pyPayrollPeriod.id, periodId),
  });
  if (!period) throw new Error("That payroll period no longer exists.");
  if (period.status === "Open") {
    throw new Error("Release the period before running payroll.");
  }
  if (period.status === "Posted") {
    throw new Error("This period is posted and can no longer be run.");
  }

  const to = periodEnd(period.year, period.month);

  // Only employees assigned to this personnel area in the period.
  const employees = await db
    .select({ id: paEmployee.id })
    .from(paEmployee)
    .innerJoin(paOrgAssignment, eq(paOrgAssignment.employeeId, paEmployee.id))
    .where(
      and(
        eq(paOrgAssignment.areaCode, period.areaCode),
        lte(paOrgAssignment.validFrom, to),
        gte(paOrgAssignment.validTo, to),
        eq(paEmployee.employmentStatus, "Active"),
      ),
    );

  const results: EmployeeResult[] = [];
  for (const e of employees) {
    results.push(await calculateEmployee({ employeeId: e.id, year: period.year, month: period.month }));
  }

  // Replace any earlier run for this period.
  const previous = await db
    .select({ id: pyPayrollRun.id })
    .from(pyPayrollRun)
    .where(eq(pyPayrollRun.periodId, periodId));
  for (const p of previous) {
    await db.delete(pyPayrollRun).where(eq(pyPayrollRun.id, p.id));
  }

  const calculated = results.filter((r) => r.status === "Calculated");
  const [run] = await db
    .insert(pyPayrollRun)
    .values({
      periodId,
      runAt: now(),
      runBy,
      employeeCount: results.length,
      errorCount: results.length - calculated.length,
      grossTotalPaise: calculated.reduce((s, r) => s + r.grossPaise, 0),
      netTotalPaise: calculated.reduce((s, r) => s + r.netPaise, 0),
    })
    .returning({ id: pyPayrollRun.id });

  for (const r of results) {
    const [stored] = await db
      .insert(pyPayrollResult)
      .values({
        runId: run.id,
        employeeId: r.employeeId,
        grossPaise: r.grossPaise,
        deductionsPaise: r.deductionsPaise,
        netPaise: r.netPaise,
        unpaidDays: r.unpaidDays,
        workingDays: r.workingDays,
        status: r.status,
        errorMessage: r.errorMessage ?? null,
      })
      .returning({ id: pyPayrollResult.id });

    if (r.lines.length > 0) {
      await db.insert(pyPayrollResultLine).values(
        r.lines.map((l) => ({
          resultId: stored.id,
          wageTypeCode: l.wageTypeCode,
          wageTypeName: l.wageTypeName,
          kind: l.kind,
          amountPaise: l.amountPaise,
          sortOrder: l.sortOrder,
        })),
      );
    }
  }

  return { runId: run.id, results };
}
