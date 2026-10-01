"use server";

import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { db, rawClient } from "@/lib/db";
import { can, requireAnyPermission, requirePermission } from "@/lib/access";
import { actorOf, audited, recordChanges, recordCreated, recordDeleted, subjectOf } from "@/lib/change-log";
import {
  tdsSectionMaster,
  tdsEmployeeDeclaration,
  tdsDeductionRegister,
  tdsForm16,
  tdsProofWindow,
  tdsProof,
  tdsRent,
  tdsPerquisite,
  tdsArrearsRelief,
  paEmployee,
  omCompany,
  now,
  type TaxRegime,
} from "@/db/schema";
import { computeAnnualTax, effectiveDeclarationAmounts, section89Relief } from "@/lib/engines/tax";
import { storeDocument, UploadError, DOCUMENT_TYPES } from "@/lib/storage";
import { documentSummary } from "@/lib/document-kinds";
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
  const actor = actorOf(await requirePermission("tax.manage"));
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
  const actor = actorOf(await requirePermission("tax.manage"));
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
  const session = await requireAnyPermission("self.tax", "tax.manage");
  const actor = actorOf(session);

  const requestedEmployee = num(form.get("employeeId"));
  const employeeId = can(session, "tax.manage")
    ? requestedEmployee || session.employeeId
    : session.employeeId;

  if (!employeeId) return fail("No employee to record a declaration against.");
  if (!can(session, "tax.manage") && requestedEmployee && requestedEmployee !== employeeId) {
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
    status: can(session, "tax.manage")
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
    if (existing.status === "Verified" && !can(session, "tax.manage")) {
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
  const actor = actorOf(await requirePermission("tax.manage"));
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
  const actor = actorOf(await requirePermission("tax.manage"));
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
  const actor = actorOf(await requirePermission("tax.manage"));
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
  const session = await requirePermission("tax.manage");
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
  // The certificate claims no more than TDS actually used, month to month.
  const effective = await effectiveDeclarationAmounts(employeeId, financialYear, {
    section80CPaise: declaration?.section80CPaise ?? 0,
    section80DPaise: declaration?.section80DPaise ?? 0,
    hraExemptionPaise: declaration?.hraExemptionPaise ?? 0,
  });

  const computation = await computeAnnualTax({
    grossSalaryPaise,
    regime,
    financialYear,
    section10ExemptPaise: effective.hraExemptionPaise,
    chapterViaPaise: effective.section80CPaise + effective.section80DPaise,
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
  const actor = actorOf(await requirePermission("tax.manage"));
  await recordDeleted(
    actor,
    "tds_form16",
    await db.delete(tdsForm16).where(eq(tdsForm16.id, num(form.get("id")))).returning(),
  );
  revalidateTax();
  return OK;
}

/* --------------------------------------------------------- TDS-06 proofs */

/** HR opens the proof window for a year: investment and rent proof uploaded before it closes is still provisional; after, only what was verified counts. */
export async function saveProofWindow(_prev: ActionState, form: FormData): Promise<ActionState> {
  const actor = actorOf(await requirePermission("tax.manage"));
  const financialYear = str(form.get("financialYear"));
  if (!/^\d{4}-\d{2}$/.test(financialYear)) return fail("Choose a financial year.");
  const opensAt = str(form.get("opensAt"));
  const closesAt = str(form.get("closesAt"));
  if (!opensAt || !closesAt) return fail("Enter when the window opens and closes.");
  if (closesAt <= opensAt) return fail("The window must close after it opens.");

  const values = { financialYear, opensAt, closesAt, createdBy: actor.name, createdAt: now() };
  await db
    .insert(tdsProofWindow)
    .values(values)
    .onConflictDoUpdate({ target: tdsProofWindow.financialYear, set: { opensAt, closesAt } });
  await recordChanges(actor, [{ entity: "tds_proof_window", entityId: financialYear, action: "update", before: {}, after: values }]);
  revalidateTax();
  return OK;
}

/** An employee files one piece of evidence against a section they declared; HR may file on their behalf. */
export async function submitProof(_prev: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireAnyPermission("self.tax", "tax.manage");
  const actor = actorOf(session);
  const requestedEmployee = num(form.get("employeeId"));
  const employeeId = can(session, "tax.manage") ? requestedEmployee || session.employeeId : session.employeeId;
  if (!employeeId) return fail("No employee to file this against.");

  const financialYear = str(form.get("financialYear"));
  if (!/^\d{4}-\d{2}$/.test(financialYear)) return fail("Choose a financial year.");
  const section = str(form.get("section"));
  if (!["80C", "80D", "HRA"].includes(section)) return fail("Choose what this proves.");
  const amount = money(form.get("amount"));
  if (!amount) return fail("Enter an amount above zero.");

  const inserted = await db
    .insert(tdsProof)
    .values({ employeeId, financialYear, section, amountPaise: amount, status: "Pending", submittedAt: now() })
    .returning();
  await recordCreated(actor, "tds_proof", inserted);

  const file = form.get("document");
  if (file instanceof File && file.size > 0) {
    try {
      const stored = await storeDocument({ ownerType: "tds_proof", ownerId: inserted[0].id, kind: section, file, uploadedBy: session.username, allowed: DOCUMENT_TYPES });
      await db.update(tdsProof).set({ documentId: stored.id }).where(eq(tdsProof.id, inserted[0].id));
      await recordCreated(actor, "app_document", [documentSummary(stored)]);
    } catch (err) {
      if (err instanceof UploadError) return fail(err.message);
      throw err;
    }
  }

  revalidateTax();
  return OK;
}

/** HR verifies or rejects one proof. Only a pending one can be decided. */
export async function decideProof(_prev: ActionState, form: FormData): Promise<ActionState> {
  const session = await requirePermission("tax.manage");
  const actor = actorOf(session);
  const id = num(form.get("id"));
  const decision = str(form.get("decision")) === "Verified" ? "Verified" : "Rejected";
  const note = opt(form.get("note"));

  const before = await db.query.tdsProof.findFirst({ where: eq(tdsProof.id, id) });
  if (!before) return fail("That proof no longer exists.");
  if (before.status !== "Pending") return fail(`That proof was already ${before.status.toLowerCase()}.`);

  await db
    .update(tdsProof)
    .set({ status: decision, note, verifiedBy: session.username, verifiedAt: now() })
    .where(eq(tdsProof.id, id));
  await recordChanges(actor, [
    { entity: "tds_proof", entityId: id, subjectEmployeeId: before.employeeId, action: "update", before: { status: "Pending" }, after: { status: decision, note } },
  ]);
  revalidateTax();
  return OK;
}

/** Rent for the HRA exemption — one row per employee per year, superseding whatever was there before. */
export async function saveRent(_prev: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireAnyPermission("self.tax", "tax.manage");
  const actor = actorOf(session);
  const requestedEmployee = num(form.get("employeeId"));
  const employeeId = can(session, "tax.manage") ? requestedEmployee || session.employeeId : session.employeeId;
  if (!employeeId) return fail("No employee to record rent for.");

  const financialYear = str(form.get("financialYear"));
  if (!/^\d{4}-\d{2}$/.test(financialYear)) return fail("Choose a financial year.");
  const monthlyRent = money(form.get("monthlyRent"));
  if (!monthlyRent) return fail("Enter the monthly rent.");
  const landlordName = str(form.get("landlordName"));
  if (!landlordName) return fail("Enter the landlord's name.");
  const landlordPan = opt(form.get("landlordPan"));
  if (monthlyRent * 12 > 100_00_00 && !landlordPan) {
    return fail("The landlord's PAN is required once annual rent is over ₹1,00,000.");
  }

  const values = {
    employeeId,
    financialYear,
    monthlyRentPaise: monthlyRent,
    landlordName,
    landlordPan,
    isMetro: bool(form.get("isMetro")),
    updatedAt: now(),
  };
  const existing = await db.query.tdsRent.findFirst({ where: and(eq(tdsRent.employeeId, employeeId), eq(tdsRent.financialYear, financialYear)) });
  if (existing) {
    await audited(
      actor,
      { entity: "tds_rent", entityId: existing.id, subjectEmployeeId: employeeId },
      () => db.query.tdsRent.findFirst({ where: eq(tdsRent.id, existing.id) }),
      () => db.update(tdsRent).set(values).where(eq(tdsRent.id, existing.id)),
    );
  } else {
    await recordCreated(actor, "tds_rent", await db.insert(tdsRent).values(values).returning());
  }
  revalidateTax();
  return OK;
}

/* ------------------------------------------------------- TDS-07 12BA and 24Q */

/**
 * Form 12BA: today, every concessional loan's monthly perquisite value
 * for the year, summed per loan — phase 19 computed and stored it on each
 * instalment, and this is the first thing to read it back.
 */
export async function generate12BA(_prev: ActionState, form: FormData): Promise<ActionState> {
  const actor = actorOf(await requirePermission("tax.manage"));
  const employeeId = num(form.get("employeeId"));
  const financialYear = str(form.get("financialYear"));
  if (!employeeId) return fail("Choose an employee.");
  if (!/^\d{4}-\d{2}$/.test(financialYear)) return fail("Choose a financial year.");

  const start = Number(financialYear.slice(0, 4));
  const found = await rawClient().execute({
    sql: `SELECT l.loan_id, SUM(l.perquisite_value_paise) AS total
          FROM py_loan_schedule l JOIN py_loan ln ON ln.id = l.loan_id
          WHERE ln.employee_id = ? AND l.due_date >= ? AND l.due_date <= ?
          GROUP BY l.loan_id
          HAVING total > 0`,
    args: [employeeId, `${start}-04-01`, `${start + 1}-03-31`],
  });

  const at = now();
  for (const r of found.rows as unknown as { loan_id: number; total: number }[]) {
    const source = `py_loan:${r.loan_id}`;
    await db
      .insert(tdsPerquisite)
      .values({ employeeId, financialYear, perquisiteType: "Concessional loan", source, amountPaise: Number(r.total), computedAt: at })
      .onConflictDoUpdate({ target: [tdsPerquisite.source, tdsPerquisite.financialYear], set: { amountPaise: Number(r.total), computedAt: at } });
  }
  await recordChanges(actor, [
    { entity: "tds_perquisite", entityId: `${employeeId}:${financialYear}`, subjectEmployeeId: employeeId, action: "update", before: {}, after: { financialYear, loans: found.rows.length }, reason: "Computed from loan schedules" },
  ]);
  revalidateTax();
  return OK;
}

/**
 * Section 89 relief (Form 10E): arrears paid this year that relate to an
 * earlier one, relieved against the extra tax they would have cost had
 * they been paid on time — read from that year's own issued Form 16.
 */
export async function computeArrearsRelief(_prev: ActionState, form: FormData): Promise<ActionState> {
  const actor = actorOf(await requirePermission("tax.manage"));
  const employeeId = num(form.get("employeeId"));
  const financialYear = str(form.get("financialYear"));
  const relatesToYear = str(form.get("relatesToYear"));
  if (!employeeId) return fail("Choose an employee.");
  if (!/^\d{4}-\d{2}$/.test(financialYear) || !/^\d{4}-\d{2}$/.test(relatesToYear)) return fail("Choose both years.");
  if (relatesToYear >= financialYear) return fail("The arrears must relate to an earlier year than the one they were paid in.");

  const relatesStart = Number(relatesToYear.slice(0, 4));
  const arrears = await rawClient().execute({
    sql: `SELECT COALESCE(SUM(l.amount_paise), 0) AS total
          FROM py_payroll_result_line l
          JOIN py_payroll_result r ON r.id = l.result_id
          WHERE r.employee_id = ? AND l.wage_type_code = 'RETRO' AND l.for_period_id IN (
            SELECT id FROM py_payroll_period WHERE (year * 100 + month) BETWEEN ? AND ?
          )`,
    args: [employeeId, relatesStart * 100 + 4, (relatesStart + 1) * 100 + 3],
  });
  const arrearsPaise = Number((arrears.rows[0] as unknown as { total: number }).total);
  if (arrearsPaise <= 0) return fail(`No arrears relating to ${relatesToYear} were found for this employee in ${financialYear}.`);

  const thatYearForm16 = await db.query.tdsForm16.findFirst({ where: and(eq(tdsForm16.employeeId, employeeId), eq(tdsForm16.financialYear, relatesToYear)) });
  if (!thatYearForm16) return fail(`Issue ${relatesToYear}'s Form 16 first — the relief is worked out against what it assessed.`);
  const thisYearForm16 = await db.query.tdsForm16.findFirst({ where: and(eq(tdsForm16.employeeId, employeeId), eq(tdsForm16.financialYear, financialYear)) });
  if (!thisYearForm16) return fail(`Issue ${financialYear}'s Form 16 first.`);

  const [withArrearsThatYear, withoutArrearsThisYear] = await Promise.all([
    computeAnnualTax({
      grossSalaryPaise: thatYearForm16.grossSalaryPaise + arrearsPaise,
      regime: thatYearForm16.regime as TaxRegime,
      financialYear: relatesToYear,
      section10ExemptPaise: thatYearForm16.section10ExemptPaise,
      chapterViaPaise: thatYearForm16.chapterViaPaise,
    }),
    computeAnnualTax({
      grossSalaryPaise: thisYearForm16.grossSalaryPaise - arrearsPaise,
      regime: thisYearForm16.regime as TaxRegime,
      financialYear,
      section10ExemptPaise: thisYearForm16.section10ExemptPaise,
      chapterViaPaise: thisYearForm16.chapterViaPaise,
    }),
  ]);

  const reliefPaise = section89Relief({
    taxWithArrearsThisYearPaise: thisYearForm16.totalTaxPaise,
    taxWithoutArrearsThisYearPaise: withoutArrearsThisYear.totalTaxPaise,
    taxWithArrearsThatYearPaise: withArrearsThatYear.totalTaxPaise,
    taxWithoutArrearsThatYearPaise: thatYearForm16.totalTaxPaise,
  });

  const values = {
    employeeId,
    financialYear,
    relatesToYear,
    arrearsPaise,
    taxWithArrearsThisYearPaise: thisYearForm16.totalTaxPaise,
    taxWithoutArrearsThisYearPaise: withoutArrearsThisYear.totalTaxPaise,
    taxWithArrearsThatYearPaise: withArrearsThatYear.totalTaxPaise,
    taxWithoutArrearsThatYearPaise: thatYearForm16.totalTaxPaise,
    reliefPaise,
    computedAt: now(),
  };
  await db
    .insert(tdsArrearsRelief)
    .values(values)
    .onConflictDoUpdate({ target: [tdsArrearsRelief.employeeId, tdsArrearsRelief.financialYear, tdsArrearsRelief.relatesToYear], set: values });
  await recordChanges(actor, [{ entity: "tds_arrears_relief", entityId: `${employeeId}:${financialYear}:${relatesToYear}`, subjectEmployeeId: employeeId, action: "update", before: {}, after: values }]);

  revalidateTax();
  return OK;
}
