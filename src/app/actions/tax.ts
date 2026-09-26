"use server";

import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { db, rawClient } from "@/lib/db";
import { requireRole, requireSession, hasRole } from "@/lib/auth";
import { actorOf, audited, recordChanges, recordCreated, recordDeleted, subjectOf } from "@/lib/change-log";
import {
  tdsSectionMaster,
  tdsEmployeeDeclaration,
  tdsDeductionRegister,
  tdsForm16,
  paEmployee,
  omCompany,
  now,
} from "@/db/schema";
import { computeAnnualTax } from "@/lib/engines/tax";
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
/* ---------------------------------------------------- TDS-01 section master */

export async function saveSection(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const actor = actorOf(await requireRole("HR_ADMIN"));
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
    await audited(
      actor,
      { entity: "tds_section_master", entityId: original },
      () => db.query.tdsSectionMaster.findFirst({ where: eq(tdsSectionMaster.code, original) }),
      () => db.update(tdsSectionMaster).set(values).where(eq(tdsSectionMaster.code, original)),
    );
  } else {
    const existing = await db.query.tdsSectionMaster.findFirst({
      where: eq(tdsSectionMaster.code, code),
    });
    if (existing) return fail(`Section ${code} already exists.`);
    await recordCreated(
      actor,
      "tds_section_master",
      await db.insert(tdsSectionMaster).values(values).returning(),
    );
  }

  revalidateTax();
  return OK;
}

export async function deleteSection(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const actor = actorOf(await requireRole("HR_ADMIN"));
  await recordDeleted(
    actor,
    "tds_section_master",
    await db
      .delete(tdsSectionMaster)
      .where(eq(tdsSectionMaster.code, str(form.get("code"))))
      .returning(),
  );
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
  const actor = actorOf(session);

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
    await audited(
      actor,
      { entity: "tds_employee_declaration", entityId: existing.id, subjectEmployeeId: subjectOf },
      () =>
        db.query.tdsEmployeeDeclaration.findFirst({
          where: eq(tdsEmployeeDeclaration.id, existing.id),
        }),
      () =>
        db
          .update(tdsEmployeeDeclaration)
          .set(values)
          .where(eq(tdsEmployeeDeclaration.id, existing.id)),
    );
  } else {
    await recordCreated(
      actor,
      "tds_employee_declaration",
      await db.insert(tdsEmployeeDeclaration).values(values).returning(),
    );
  }

  revalidateTax();
  return OK;
}

export async function deleteDeclaration(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const actor = actorOf(await requireRole("HR_ADMIN"));
  await recordDeleted(
    actor,
    "tds_employee_declaration",
    await db
      .delete(tdsEmployeeDeclaration)
      .where(eq(tdsEmployeeDeclaration.id, num(form.get("id"))))
      .returning(),
  );
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
  const actor = actorOf(await requireRole("HR_ADMIN"));
  const financialYear = str(form.get("financialYear"));
  if (!/^\d{4}-\d{2}$/.test(financialYear)) return fail("Choose a financial year.");

  const start = Number(financialYear.slice(0, 4));

  // Every paid result in the year — posted months and completed off-cycle
  // runs, never a run still in progress or a month not yet final — summed by
  // employee and quarter in the database rather than row by row here.
  const buckets = await rawClient().execute({
    sql: `SELECT r.employee_id,
                 ((p.month + 8) % 12) / 3 + 1 AS quarter,
                 SUM(r.gross_paise) AS gross,
                 SUM(COALESCE((SELECT SUM(l.amount_paise) FROM py_payroll_result_line l
                               WHERE l.result_id = r.id AND l.wage_type_code = 'TDS'), 0)) AS tds
          FROM py_payroll_result r
          JOIN py_payroll_run run ON run.id = r.run_id AND run.status = 'Completed'
          JOIN py_payroll_period p ON p.id = run.period_id
          WHERE r.status = 'Calculated'
            AND (p.status = 'Posted' OR run.run_type = 'Off-cycle')
            AND p.year * 100 + p.month BETWEEN ? AND ?
          GROUP BY r.employee_id, quarter`,
    args: [start * 100 + 4, (start + 1) * 100 + 3],
  });

  if (buckets.rows.length === 0) {
    return fail(`No posted payroll results fall in ${financialYear}. Run and post payroll first.`);
  }

  // One upsert. Challan details already entered by hand are kept.
  const updatedAt = now();
  await db
    .insert(tdsDeductionRegister)
    .values(
      buckets.rows.map((b) => ({
        employeeId: Number(b.employee_id),
        financialYear,
        quarter: Number(b.quarter),
        grossPaidPaise: Number(b.gross),
        tdsDeductedPaise: Number(b.tds),
        updatedAt,
      })),
    )
    .onConflictDoUpdate({
      target: [
        tdsDeductionRegister.employeeId,
        tdsDeductionRegister.financialYear,
        tdsDeductionRegister.quarter,
      ],
      set: {
        grossPaidPaise: sql`excluded.gross_paid_paise`,
        tdsDeductedPaise: sql`excluded.tds_deducted_paise`,
        updatedAt: sql`excluded.updated_at`,
      },
    });
  await recordChanges(actor, [
    {
      entity: "tds_deduction_register",
      entityId: financialYear,
      action: "update",
      before: {},
      after: { financialYear, rows: buckets.rows.length },
      reason: "Rebuilt from posted payroll",
    },
  ]);

  revalidateTax();
  return OK;
}

export async function saveChallan(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const actor = actorOf(await requireRole("HR_ADMIN"));
  const id = num(form.get("id"));

  const depositDate = opt(form.get("depositDate"));
  if (depositDate && !/^\d{4}-\d{2}-\d{2}$/.test(depositDate)) {
    return fail("Enter a valid deposit date.");
  }

  await audited(
    actor,
    { entity: "tds_deduction_register", entityId: id, subjectEmployeeId: subjectOf },
    () => db.query.tdsDeductionRegister.findFirst({ where: eq(tdsDeductionRegister.id, id) }),
    () =>
      db
        .update(tdsDeductionRegister)
        .set({
          challanBsr: opt(form.get("challanBsr")),
          depositDate,
          receipt24q: opt(form.get("receipt24q")),
          updatedAt: now(),
        })
        .where(eq(tdsDeductionRegister.id, id)),
  );

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
  const actor = actorOf(session);
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
    await audited(
      actor,
      { entity: "tds_form16", entityId: existing.id, subjectEmployeeId: subjectOf },
      () => db.query.tdsForm16.findFirst({ where: eq(tdsForm16.id, existing.id) }),
      () => db.update(tdsForm16).set(values).where(eq(tdsForm16.id, existing.id)),
    );
  } else {
    await recordCreated(actor, "tds_form16", await db.insert(tdsForm16).values(values).returning());
  }

  revalidateTax();
  return OK;
}

export async function deleteForm16(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const actor = actorOf(await requireRole("HR_ADMIN"));
  await recordDeleted(
    actor,
    "tds_form16",
    await db.delete(tdsForm16).where(eq(tdsForm16.id, num(form.get("id")))).returning(),
  );
  revalidateTax();
  return OK;
}
