"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db, rawClient } from "@/lib/db";
import { requirePermission } from "@/lib/access";
import { actorOf, recordChanges, recordCreate, recordCreated, recordDelete } from "@/lib/change-log";
import { pyClaim, pyClaimCategory, pyClaimCategoryLimit, pyLoanBenchmarkRate } from "@/db/schema";
import { submitLoanRequest, withdrawLoanRequest, recordPrepayment, closeLoanRequest } from "@/lib/services/loans";
import { submitClaimRequest, withdrawClaimRequest } from "@/lib/services/claims";
import { storeDocument, UploadError, DOCUMENT_OR_IMAGE_TYPES } from "@/lib/storage";
import { documentSummary } from "@/lib/document-kinds";
import { toPaise } from "@/lib/money";
import { kickJobs } from "@/lib/jobs/runner";

export type ActionState = { error?: string; ok?: boolean };

const OK: ActionState = { ok: true };
const fail = (error: string): ActionState => ({ error });
const str = (v: FormDataEntryValue | null) => (typeof v === "string" ? v.trim() : "");
const opt = (v: FormDataEntryValue | null) => str(v) || null;
const num = (v: FormDataEntryValue | null) => Number(str(v));
const bool = (v: FormDataEntryValue | null) => v === "on" || v === "true" || v === "1";

function revalidate() {
  revalidatePath("/loans-claims", "layout");
  revalidatePath("/");
}

/* -------------------------------------------------------------------- loans */

export async function submitLoan(_prev: ActionState, form: FormData): Promise<ActionState> {
  const session = await requirePermission("self.loans");
  const principal = num(form.get("principal"));
  if (!(principal > 0)) return fail("Enter an amount above zero.");

  const r = await submitLoanRequest(
    { userId: session.userId, username: session.username, displayName: session.displayName, employeeId: session.employeeId },
    actorOf(session),
    {
      loanType: str(form.get("loanType")),
      principalPaise: toPaise(principal),
      annualRateBasisPoints: Math.round(num(form.get("annualRate") || "0") * 100),
      tenureMonths: num(form.get("tenureMonths")),
      startDate: str(form.get("startDate")),
      reason: opt(form.get("reason")),
    },
  );
  if (!r.ok) return fail(r.error);
  await kickJobs();
  revalidate();
  revalidatePath("/approvals");
  return OK;
}

export async function withdrawLoan(_prev: ActionState, form: FormData): Promise<ActionState> {
  const session = await requirePermission("self.loans");
  const r = await withdrawLoanRequest(
    { userId: session.userId, username: session.username, displayName: session.displayName, employeeId: session.employeeId },
    actorOf(session),
    num(form.get("id")),
  );
  if (!r.ok) return fail(r.error);
  revalidate();
  return OK;
}

export async function prepayLoanAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const session = await requirePermission("payroll.setup");
  const amount = num(form.get("amount"));
  if (!(amount > 0)) return fail("Enter an amount above zero.");
  const r = await recordPrepayment(actorOf(session), {
    loanId: num(form.get("loanId")),
    amountPaise: toPaise(amount),
    date: str(form.get("date")),
    createdBy: session.username,
  });
  if (!r.ok) return fail(r.error);
  revalidate();
  return OK;
}

export async function closeLoanAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const session = await requirePermission("payroll.setup");
  const r = await closeLoanRequest(actorOf(session), num(form.get("id")));
  if (!r.ok) return fail(r.error);
  revalidate();
  return OK;
}

/* ------------------------------------------------------------------- claims */

export async function submitClaim(_prev: ActionState, form: FormData): Promise<ActionState> {
  const session = await requirePermission("self.claims");
  const categoryCode = str(form.get("categoryCode"));
  const claimDate = str(form.get("claimDate"));

  const lines: { date: string; description: string; amountPaise: number }[] = [];
  const files: (File | null)[] = [];
  for (let i = 0; form.has(`line_date_${i}`); i++) {
    const date = str(form.get(`line_date_${i}`));
    const description = str(form.get(`line_description_${i}`));
    const amount = num(form.get(`line_amount_${i}`));
    if (!date && !description && !amount) continue;
    lines.push({ date, description, amountPaise: toPaise(amount) });
    const file = form.get(`line_file_${i}`);
    files.push(file instanceof File && file.size > 0 ? file : null);
  }
  if (lines.length === 0) return fail("Add at least one line.");
  // A claim is a request to be paid against a bill, so the bill comes with
  // it. Without one there is nothing for the approver to check, and nothing
  // to keep for an audit afterwards.
  const missing = files.findIndex((f) => f === null);
  if (missing !== -1) return fail(`Attach the bill for line ${missing + 1}: every line needs its own.`);

  const r = await submitClaimRequest(
    { userId: session.userId, username: session.username, displayName: session.displayName, employeeId: session.employeeId },
    actorOf(session),
    { categoryCode, claimDate, lines },
  );
  if (!r.ok) return fail(r.error);

  // Bills attach once the lines exist to own them — same order they were inserted in.
  const created = await rawClient().execute({
    sql: "SELECT id FROM py_claim_line WHERE claim_id = ? ORDER BY id",
    args: [r.value.id],
  });
  for (let i = 0; i < created.rows.length; i++) {
    const file = files[i];
    if (!file) continue;
    try {
      const stored = await storeDocument({
        ownerType: "claim_line",
        ownerId: Number(created.rows[i].id),
        kind: "Bill",
        file,
        uploadedBy: session.username,
        allowed: DOCUMENT_OR_IMAGE_TYPES,
      });
      await recordCreated(actorOf(session), "app_document", [documentSummary(stored)]);
    } catch (err) {
      if (err instanceof UploadError) return fail(`Line ${i + 1}: ${err.message}`);
      throw err;
    }
  }

  await kickJobs();
  revalidate();
  revalidatePath("/approvals");
  return OK;
}

export async function withdrawClaim(_prev: ActionState, form: FormData): Promise<ActionState> {
  const session = await requirePermission("self.claims");
  const r = await withdrawClaimRequest(
    { userId: session.userId, username: session.username, displayName: session.displayName, employeeId: session.employeeId },
    actorOf(session),
    num(form.get("id")),
  );
  if (!r.ok) return fail(r.error);
  revalidate();
  return OK;
}

/* ---------------------------------------------------------- claim categories */

export async function saveClaimCategory(_prev: ActionState, form: FormData): Promise<ActionState> {
  const session = await requirePermission("payroll.setup");
  const original = opt(form.get("originalCode"));
  const code = str(form.get("code")).toUpperCase();
  const name = str(form.get("name"));
  const limit = num(form.get("defaultAnnualLimit"));
  if (!code) return fail("Enter a category code.");
  if (!name) return fail("Enter a category name.");
  if (!(limit > 0)) return fail("Enter an annual limit above zero.");

  const values = { code, name, isTaxable: bool(form.get("isTaxable")), defaultAnnualLimitPaise: toPaise(limit), isActive: bool(form.get("isActive")) };
  if (original) {
    await db.update(pyClaimCategory).set(values).where(eq(pyClaimCategory.code, original));
    await recordChanges(actorOf(session), [{ entity: "py_claim_category", entityId: original, action: "update", after: values }]);
  } else {
    const existing = await db.query.pyClaimCategory.findFirst({ where: eq(pyClaimCategory.code, code) });
    if (existing) return fail(`${code} already exists.`);
    await db.insert(pyClaimCategory).values(values);
    await recordCreate(actorOf(session), "py_claim_category", code, values);
  }
  revalidate();
  return OK;
}

export async function deleteClaimCategory(_prev: ActionState, form: FormData): Promise<ActionState> {
  const session = await requirePermission("payroll.setup");
  const code = str(form.get("code"));
  const used = await db.query.pyClaim.findFirst({ where: eq(pyClaim.categoryCode, code) });
  if (used) return fail(`${code} already has claims against it. Make it inactive instead.`);
  const before = await db.query.pyClaimCategory.findFirst({ where: eq(pyClaimCategory.code, code) });
  await db.delete(pyClaimCategory).where(eq(pyClaimCategory.code, code));
  if (before) await recordDelete(actorOf(session), "py_claim_category", code, before);
  revalidate();
  return OK;
}

export async function saveClaimCategoryLimit(_prev: ActionState, form: FormData): Promise<ActionState> {
  const session = await requirePermission("payroll.setup");
  const id = opt(form.get("id"));
  const categoryCode = str(form.get("categoryCode"));
  const grade = str(form.get("grade"));
  const limit = num(form.get("annualLimit"));
  if (!categoryCode) return fail("Choose a category.");
  if (!grade) return fail("Enter a grade.");
  if (!(limit > 0)) return fail("Enter an annual limit above zero.");

  const values = { categoryCode, grade, annualLimitPaise: toPaise(limit) };
  if (id) {
    await db.update(pyClaimCategoryLimit).set(values).where(eq(pyClaimCategoryLimit.id, Number(id)));
    await recordChanges(actorOf(session), [{ entity: "py_claim_category_limit", entityId: Number(id), action: "update", after: values }]);
  } else {
    const inserted = await db.insert(pyClaimCategoryLimit).values(values).returning();
    await recordCreate(actorOf(session), "py_claim_category_limit", inserted[0].id, inserted[0]);
  }
  revalidate();
  return OK;
}

export async function deleteClaimCategoryLimit(_prev: ActionState, form: FormData): Promise<ActionState> {
  const session = await requirePermission("payroll.setup");
  const id = num(form.get("id"));
  const before = await db.query.pyClaimCategoryLimit.findFirst({ where: eq(pyClaimCategoryLimit.id, id) });
  await db.delete(pyClaimCategoryLimit).where(eq(pyClaimCategoryLimit.id, id));
  if (before) await recordDelete(actorOf(session), "py_claim_category_limit", id, before);
  revalidate();
  return OK;
}

/* ------------------------------------------------------------ benchmark rate */

export async function saveLoanBenchmarkRate(_prev: ActionState, form: FormData): Promise<ActionState> {
  const session = await requirePermission("payroll.setup");
  const id = opt(form.get("id"));
  const validFrom = str(form.get("validFrom"));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(validFrom)) return fail("Enter a valid from date.");
  const values = { validFrom, validTo: opt(form.get("validTo")) ?? "9999-12-31", rateBasisPoints: Math.round(num(form.get("rate")) * 100) };
  if (id) {
    await db.update(pyLoanBenchmarkRate).set(values).where(eq(pyLoanBenchmarkRate.id, Number(id)));
    await recordChanges(actorOf(session), [{ entity: "py_loan_benchmark_rate", entityId: Number(id), action: "update", after: values }]);
  } else {
    const inserted = await db.insert(pyLoanBenchmarkRate).values(values).returning();
    await recordCreate(actorOf(session), "py_loan_benchmark_rate", inserted[0].id, inserted[0]);
  }
  revalidate();
  return OK;
}

export async function deleteLoanBenchmarkRate(_prev: ActionState, form: FormData): Promise<ActionState> {
  const session = await requirePermission("payroll.setup");
  const id = num(form.get("id"));
  const before = await db.query.pyLoanBenchmarkRate.findFirst({ where: eq(pyLoanBenchmarkRate.id, id) });
  await db.delete(pyLoanBenchmarkRate).where(eq(pyLoanBenchmarkRate.id, id));
  if (before) await recordDelete(actorOf(session), "py_loan_benchmark_rate", id, before);
  revalidate();
  return OK;
}
