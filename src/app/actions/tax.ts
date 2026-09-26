"use server";

import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { requireRole, requireSession, hasRole } from "@/lib/auth";
import {
  tdsSectionMaster,
  tdsEmployeeDeclaration,
  tdsDeductionRegister,
  tdsForm16,
  pyPayrollResult,
  pyPayrollResultLine,
  pyPayrollRun,
  pyPayrollPeriod,
  paEmployee,
  omCompany,
  now,
} from "@/db/schema";
import { computeAnnualTax, financialQuarterOf } from "@/lib/engines/tax";
import { toPaise } from "@/lib/money";

export type ActionState = { error?: string; ok?: boolean };

const OK: ActionState = { ok: true };
const fail = (error: string): ActionState => ({ error });
const str = (v: FormDataEntryValue | null) => (typeof v === "string" ? v.trim() : "");
const opt = (v: FormDataEntryValue | null) => {
  const s = str(v);
  return s.length > 0 ? s : null;
};
const num = (v: FormDataEntryValue | null) => Number(str(v));
const money = (v: FormDataEntryValue | null) => {
  const n = Number(str(v));
  return Number.isFinite(n) && n > 0 ? toPaise(n) : 0;
};
const bool = (v: FormDataEntryValue | null) => v === "on" || v === "true" || v === "1";

function revalidateTax() {
  revalidatePath("/tax", "layout");
  revalidatePath("/");
}

/** "2025-26" covers 1 Apr 2025 to 31 Mar 2026. */
function financialYearBounds(fy: string): { from: string; to: string } {
  const start = Number(fy.slice(0, 4));
  return { from: `${start}-04-01`, to: `${start + 1}-03-31` };
}

/* ---------------------------------------------------- TDS-01 section master */

export async function saveSection(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  await requireRole("HR_ADMIN");
  const original = opt(form.get("originalCode"));
  const code = str(form.get("code")).toUpperCase();
  const description = str(form.get("description"));
  const isSlabBased = bool(form.get("isSlabBased"));
  const rate = str(form.get("ratePercent"));

  if (!code) return fail("Enter a section code.");
  if (!description) return fail("Describe what the section covers.");
  if (!isSlabBased && !rate) {
    return fail("Enter a rate, or mark the section as slab based.");
  }

  const values = {
    code,
    description,
    rateBasisPoints: isSlabBased ? null : Math.round(Number(rate) * 100),
    isSlabBased,
    thresholdPaise: money(form.get("threshold")) || null,
    applicableTo: str(form.get("applicableTo")) || "Employee",
    isActive: bool(form.get("isActive")),
  };

  if (original) {
    await db.update(tdsSectionMaster).set(values).where(eq(tdsSectionMaster.code, original));
  } else {
    const existing = await db.query.tdsSectionMaster.findFirst({
      where: eq(tdsSectionMaster.code, code),
    });
    if (existing) return fail(`Section ${code} already exists.`);
    await db.insert(tdsSectionMaster).values(values);
  }

  revalidateTax();
  return OK;
}

export async function deleteSection(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  await requireRole("HR_ADMIN");
  await db.delete(tdsSectionMaster).where(eq(tdsSectionMaster.code, str(form.get("code"))));
  revalidateTax();
  return OK;
}

/* ------------------------------------------------ TDS-02 tax declarations */

/**
 * An employee declares their investments, or HR records them.
 *
 * Under the new regime the exemptions are not claimable, so they are stored
 * but ignored by the computation. Keeping them means switching regime does not
 * lose what someone already entered.
 */
export async function saveDeclaration(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireSession();

  const requestedEmployee = num(form.get("employeeId"));
  const employeeId = hasRole(session, "HR_ADMIN")
    ? requestedEmployee || session.employeeId
    : session.employeeId;

  if (!employeeId) return fail("No employee to record a declaration against.");
  if (!hasRole(session, "HR_ADMIN") && requestedEmployee && requestedEmployee !== employeeId) {
    return fail("You can only record your own declaration.");
  }

  const financialYear = str(form.get("financialYear"));
  if (!/^\d{4}-\d{2}$/.test(financialYear)) {
    return fail("Choose a financial year.");
  }

  const regime = str(form.get("regime")) === "Old" ? "Old" : "New";
  const section80C = money(form.get("section80C"));
  const section80D = money(form.get("section80D"));

  // 80C is capped at ₹1,50,000 and 80D at ₹25,000 for a non-senior taxpayer.
  if (section80C > 15_000_000) {
    return fail("Section 80C is capped at ₹1,50,000.");
  }
  if (section80D > 2_500_000) {
    return fail("Section 80D is capped at ₹25,000 here.");
  }

  const values = {
    employeeId,
    financialYear,
    regime,
    section80CPaise: section80C,
    section80DPaise: section80D,
    hraExemptionPaise: money(form.get("hraExemption")),
    otherIncomePaise: money(form.get("otherIncome")),
    status: hasRole(session, "HR_ADMIN")
      ? str(form.get("status")) || "Verified"
      : "Declared",
    updatedAt: now(),
  };

  const existing = await db.query.tdsEmployeeDeclaration.findFirst({
    where: and(
      eq(tdsEmployeeDeclaration.employeeId, employeeId),
      eq(tdsEmployeeDeclaration.financialYear, financialYear),
    ),
  });

  if (existing) {
    if (existing.status === "Verified" && !hasRole(session, "HR_ADMIN")) {
      return fail("That declaration has been verified and can no longer be changed.");
    }
    await db
      .update(tdsEmployeeDeclaration)
      .set(values)
      .where(eq(tdsEmployeeDeclaration.id, existing.id));
  } else {
    await db.insert(tdsEmployeeDeclaration).values(values);
  }

  revalidateTax();
  return OK;
}

export async function deleteDeclaration(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  await requireRole("HR_ADMIN");
  await db
    .delete(tdsEmployeeDeclaration)
    .where(eq(tdsEmployeeDeclaration.id, num(form.get("id"))));
  revalidateTax();
  return OK;
}

/* ------------------------------------------------- TDS-03 deduction register */

/**
 * Builds the quarterly register from what payroll actually deducted.
 *
 * The figures are read from the stored payroll result lines rather than
 * recomputed, so the register, the payslips and Form 16 all quote the same
 * numbers. Challan details are entered by hand afterwards, because they come
 * from the bank.
 */
export async function buildRegister(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  await requireRole("HR_ADMIN");
  const financialYear = str(form.get("financialYear"));
  if (!/^\d{4}-\d{2}$/.test(financialYear)) return fail("Choose a financial year.");

  const { from, to } = financialYearBounds(financialYear);

  // Every posted payroll result in the year, with its TDS line.
  const rows = await db
    .select({
      employeeId: pyPayrollResult.employeeId,
      grossPaise: pyPayrollResult.grossPaise,
      year: pyPayrollPeriod.year,
      month: pyPayrollPeriod.month,
      tdsPaise: sql<number>`COALESCE((
        SELECT SUM(amount_paise) FROM py_payroll_result_line
        WHERE result_id = ${pyPayrollResult.id} AND wage_type_code = 'TDS'
      ), 0)`,
    })
    .from(pyPayrollResult)
    .innerJoin(pyPayrollRun, eq(pyPayrollRun.id, pyPayrollResult.runId))
    .innerJoin(pyPayrollPeriod, eq(pyPayrollPeriod.id, pyPayrollRun.periodId))
    .where(eq(pyPayrollResult.status, "Calculated"));

  const inYear = rows.filter((r) => {
    const date = `${r.year}-${String(r.month).padStart(2, "0")}-01`;
    return date >= from && date <= to;
  });

  if (inYear.length === 0) {
    return fail(`No payroll results fall in ${financialYear}. Run payroll first.`);
  }

  // Aggregate by employee and quarter.
  const buckets = new Map<string, { employeeId: number; quarter: number; gross: number; tds: number }>();
  for (const r of inYear) {
    const date = `${r.year}-${String(r.month).padStart(2, "0")}-01`;
    const quarter = financialQuarterOf(date);
    const key = `${r.employeeId}:${quarter}`;
    const existing = buckets.get(key);
    buckets.set(key, {
      employeeId: r.employeeId,
      quarter,
      gross: (existing?.gross ?? 0) + r.grossPaise,
      tds: (existing?.tds ?? 0) + Number(r.tdsPaise),
    });
  }

  const updatedAt = now();
  for (const b of buckets.values()) {
    const existing = await db.query.tdsDeductionRegister.findFirst({
      where: and(
        eq(tdsDeductionRegister.employeeId, b.employeeId),
        eq(tdsDeductionRegister.financialYear, financialYear),
        eq(tdsDeductionRegister.quarter, b.quarter),
      ),
    });

    if (existing) {
      // Keep the challan details someone already entered.
      await db
        .update(tdsDeductionRegister)
        .set({ grossPaidPaise: b.gross, tdsDeductedPaise: b.tds, updatedAt })
        .where(eq(tdsDeductionRegister.id, existing.id));
    } else {
      await db.insert(tdsDeductionRegister).values({
        employeeId: b.employeeId,
        financialYear,
        quarter: b.quarter,
        grossPaidPaise: b.gross,
        tdsDeductedPaise: b.tds,
        updatedAt,
      });
    }
  }

  revalidateTax();
  return OK;
}

export async function saveChallan(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  await requireRole("HR_ADMIN");
  const id = num(form.get("id"));

  const depositDate = opt(form.get("depositDate"));
  if (depositDate && !/^\d{4}-\d{2}-\d{2}$/.test(depositDate)) {
    return fail("Enter a valid deposit date.");
  }

  await db
    .update(tdsDeductionRegister)
    .set({
      challanBsr: opt(form.get("challanBsr")),
      depositDate,
      receipt24q: opt(form.get("receipt24q")),
      updatedAt: now(),
    })
    .where(eq(tdsDeductionRegister.id, id));

  revalidateTax();
  return OK;
}

/* --------------------------------------------------------- TDS-04/05 Form 16 */

/**
 * Generates the certificate for one employee and year.
 *
 * Part A's quarterly totals come from the register — what was actually
 * deducted and deposited. Part B recomputes the annual liability from the same
 * gross and the employee's declaration, so the two halves reconcile: the
 * balance at the bottom is the difference between what was owed and what was
 * taken, and it is a refund when it is negative.
 */
export async function generateForm16(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireRole("HR_ADMIN");
  const employeeId = num(form.get("employeeId"));
  const financialYear = str(form.get("financialYear"));

  if (!employeeId) return fail("Choose an employee.");
  if (!/^\d{4}-\d{2}$/.test(financialYear)) return fail("Choose a financial year.");

  const register = await db
    .select()
    .from(tdsDeductionRegister)
    .where(
      and(
        eq(tdsDeductionRegister.employeeId, employeeId),
        eq(tdsDeductionRegister.financialYear, financialYear),
      ),
    );

  if (register.length === 0) {
    return fail(
      `Nothing is in the deduction register for ${financialYear}. Build it from payroll first.`,
    );
  }

  const grossSalaryPaise = register.reduce((s, r) => s + r.grossPaidPaise, 0);
  const tdsDeductedPaise = register.reduce((s, r) => s + r.tdsDeductedPaise, 0);

  const declaration = await db.query.tdsEmployeeDeclaration.findFirst({
    where: and(
      eq(tdsEmployeeDeclaration.employeeId, employeeId),
      eq(tdsEmployeeDeclaration.financialYear, financialYear),
    ),
  });
  const regime = (declaration?.regime as "Old" | "New") ?? "New";

  const computation = await computeAnnualTax({
    grossSalaryPaise,
    regime,
    financialYear,
    section10ExemptPaise: declaration?.hraExemptionPaise ?? 0,
    chapterViaPaise:
      (declaration?.section80CPaise ?? 0) + (declaration?.section80DPaise ?? 0),
    otherIncomePaise: declaration?.otherIncomePaise ?? 0,
  });

  const employer = await db.query.omCompany.findFirst({
    where: eq(omCompany.isActive, true),
  });
  const employee = await db.query.paEmployee.findFirst({
    where: eq(paEmployee.id, employeeId),
  });

  const existing = await db.query.tdsForm16.findFirst({
    where: and(
      eq(tdsForm16.employeeId, employeeId),
      eq(tdsForm16.financialYear, financialYear),
    ),
  });

  const values = {
    employeeId,
    financialYear,
    certificateNo:
      existing?.certificateNo ??
      `TDS/${financialYear.replace("-", "")}/${String(employee?.employeeNumber ?? employeeId).replace(/\D/g, "")}`,
    employerName: employer?.name ?? "Employer",
    employerTan: str(form.get("employerTan")) || existing?.employerTan || "BLRA12345B",
    employerPan: str(form.get("employerPan")) || existing?.employerPan || "AACCA1234B",
    employeePan: opt(form.get("employeePan")) ?? existing?.employeePan ?? null,
    regime,
    grossSalaryPaise,
    section10ExemptPaise: computation.section10ExemptPaise,
    standardDeductionPaise: computation.standardDeductionPaise,
    chapterViaPaise: computation.chapterViaPaise,
    taxableIncomePaise: computation.taxableIncomePaise,
    taxOnIncomePaise: computation.taxOnIncomePaise,
    rebate87aPaise: computation.rebate87aPaise,
    cessPaise: computation.cessPaise,
    totalTaxPaise: computation.totalTaxPaise,
    tdsDeductedPaise,
    balancePaise: computation.totalTaxPaise - tdsDeductedPaise,
    generatedAt: now(),
    generatedBy: session.username,
  };

  if (existing) {
    await db.update(tdsForm16).set(values).where(eq(tdsForm16.id, existing.id));
  } else {
    await db.insert(tdsForm16).values(values);
  }

  revalidateTax();
  return OK;
}

export async function deleteForm16(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  await requireRole("HR_ADMIN");
  await db.delete(tdsForm16).where(eq(tdsForm16.id, num(form.get("id"))));
  revalidateTax();
  return OK;
}
