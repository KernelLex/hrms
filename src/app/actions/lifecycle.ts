"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { rawClient } from "@/lib/db";
import { can, inScope, requireAccess, requirePermission, type Access } from "@/lib/access";
import { actorOf, changeStatement } from "@/lib/change-log";
import { transferEmployee, promoteEmployee } from "@/lib/services/actions";
import { completeChecklistIfDone } from "@/lib/services/checklist";
import { confirmProbation, extendProbation, endProbation } from "@/lib/services/monitoring";
import { issueLetter } from "@/lib/services/letters";
import { toPaise } from "@/lib/money";
import { kickJobs } from "@/lib/jobs/runner";

/**
 * The moments in an employee's life that are guided actions: tasks from
 * onboarding checklists, probation decisions, transfers and promotions, and
 * letters issued from templates.
 */

export type ActionState = { error?: string; ok?: boolean };

const OK: ActionState = { ok: true };
const fail = (error: string): ActionState => ({ error });
const str = (v: FormDataEntryValue | null) => (typeof v === "string" ? v.trim() : "");
const opt = (v: FormDataEntryValue | null) => str(v) || null;
const num = (v: FormDataEntryValue | null) => Number(str(v));
const dateish = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a date.");

function revalidateEmployee(id?: number) {
  revalidatePath("/core-hr", "layout");
  if (id) revalidatePath(`/core-hr/${id}`, "layout");
  revalidatePath("/tasks");
  revalidatePath("/core-hr/probation");
}

async function guardEmployee(access: Access, employeeId: number): Promise<string | null> {
  if (!(await inScope(access, employeeId))) return "That employee is outside the companies and areas your role covers.";
  return null;
}

/* ------------------------------------------------------------- onboarding */

/** Marks a task done — only the person it is assigned to, or HR. */
export async function completeTask(_prev: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireAccess();
  const id = num(form.get("id"));
  const task = (await rawClient().execute({ sql: "SELECT * FROM pa_task WHERE id = ?", args: [id] })).rows[0];
  if (!task) return fail("That task no longer exists.");
  if (String(task.status) !== "Pending") return fail("That task is already done.");
  const mine = task.assigned_user_id !== null && Number(task.assigned_user_id) === session.userId;
  if (!mine && !can(session, "employee.edit")) return fail("That task is not assigned to you.");

  const checklist = (await rawClient().execute({ sql: "SELECT employee_id FROM pa_checklist WHERE id = ?", args: [Number(task.checklist_id)] })).rows[0];
  const employeeId = checklist ? Number(checklist.employee_id) : null;

  const at = new Date().toISOString();
  const actor = actorOf(session);
  const claimed = await rawClient().execute({
    sql: "UPDATE pa_task SET status = 'Done', done_by_user_id = ?, done_at = ? WHERE id = ? AND status = 'Pending'",
    args: [session.userId, at, id],
  });
  if (claimed.rowsAffected === 0) return fail("That task is already done.");
  const logged = changeStatement(actor, {
    entity: "pa_task",
    entityId: id,
    subjectEmployeeId: employeeId,
    action: "update",
    before: { status: "Pending" },
    after: { status: "Done" },
  });
  if (logged) await rawClient().execute(logged);
  await completeChecklistIfDone(rawClient(), actor, Number(task.checklist_id));
  await kickJobs();
  revalidateEmployee(employeeId ?? undefined);
  return OK;
}

/* ------------------------------------------------------------- probation */

export async function confirmProbationAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const session = await requirePermission("employee.edit");
  const id = num(form.get("id"));
  const row = (await rawClient().execute({ sql: "SELECT employee_id FROM pa_it0019_monitoring WHERE id = ?", args: [id] })).rows[0];
  if (row) {
    const guard = await guardEmployee(session, Number(row.employee_id));
    if (guard) return fail(guard);
  }
  const r = await confirmProbation(actorOf(session), id, opt(form.get("note")), session.username);
  if (!r.ok) return fail(r.error);
  revalidateEmployee();
  return OK;
}

export async function extendProbationAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const session = await requirePermission("employee.edit");
  const id = num(form.get("id"));
  const newDate = str(form.get("newDate"));
  if (!dateish.safeParse(newDate).success) return fail("Enter the new review date.");
  const row = (await rawClient().execute({ sql: "SELECT employee_id FROM pa_it0019_monitoring WHERE id = ?", args: [id] })).rows[0];
  if (row) {
    const guard = await guardEmployee(session, Number(row.employee_id));
    if (guard) return fail(guard);
  }
  const r = await extendProbation(actorOf(session), id, newDate, opt(form.get("note")), session.username);
  if (!r.ok) return fail(r.error);
  revalidateEmployee();
  return OK;
}

export async function endProbationAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const session = await requirePermission("employee.edit");
  const id = num(form.get("id"));
  const effectiveDate = str(form.get("effectiveDate"));
  if (!dateish.safeParse(effectiveDate).success) return fail("Enter the last working day.");
  const note = opt(form.get("note"));
  if (!note) return fail("Say why, for the record.");
  const row = (await rawClient().execute({ sql: "SELECT employee_id FROM pa_it0019_monitoring WHERE id = ?", args: [id] })).rows[0];
  if (row) {
    const guard = await guardEmployee(session, Number(row.employee_id));
    if (guard) return fail(guard);
  }
  const r = await endProbation(actorOf(session), id, effectiveDate, note, session.username);
  if (!r.ok) return fail(r.error);
  revalidateEmployee();
  return OK;
}

/* -------------------------------------------------- transfer / promotion */

const TransferInput = z.object({
  employeeId: z.number().int().positive(),
  effectiveDate: dateish,
  companyCode: z.string().min(1, "Choose a company."),
  areaCode: z.string().nullable(),
  orgUnitCode: z.string().min(1, "Choose a department."),
  positionCode: z.string().min(1, "Choose a position."),
  costCenter: z.string().nullable(),
  reason: z.string().nullable(),
});

export async function transferEmployeeAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const session = await requirePermission("employee.edit");
  const parsed = TransferInput.safeParse({
    employeeId: num(form.get("employeeId")),
    effectiveDate: str(form.get("effectiveDate")),
    companyCode: str(form.get("companyCode")),
    areaCode: opt(form.get("areaCode")),
    orgUnitCode: str(form.get("orgUnitCode")),
    positionCode: str(form.get("positionCode")),
    costCenter: opt(form.get("costCenter")),
    reason: opt(form.get("reason")),
  });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the form and try again.");
  const guard = await guardEmployee(session, parsed.data.employeeId);
  if (guard) return fail(guard);

  const r = await transferEmployee(actorOf(session), parsed.data, session.username);
  if (!r.ok) return fail(r.error);
  await kickJobs();
  revalidateEmployee(parsed.data.employeeId);
  revalidatePath("/org", "layout");
  return OK;
}

const PromotionInput = z.object({
  employeeId: z.number().int().positive(),
  effectiveDate: dateish,
  positionCode: z.string().min(1, "Choose the new position."),
  payScaleGroup: z.string().nullable(),
  amount: z.number().positive("Enter the new basic salary."),
  currency: z.string().default("INR"),
  reason: z.string().nullable(),
});

export async function promoteEmployeeAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const session = await requirePermission("employee.edit", "pay.view");
  const parsed = PromotionInput.safeParse({
    employeeId: num(form.get("employeeId")),
    effectiveDate: str(form.get("effectiveDate")),
    positionCode: str(form.get("positionCode")),
    payScaleGroup: opt(form.get("payScaleGroup")),
    amount: num(form.get("amount")),
    currency: str(form.get("currency")) || "INR",
    reason: opt(form.get("reason")),
  });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the form and try again.");
  const guard = await guardEmployee(session, parsed.data.employeeId);
  if (guard) return fail(guard);

  const r = await promoteEmployee(
    actorOf(session),
    {
      employeeId: parsed.data.employeeId,
      effectiveDate: parsed.data.effectiveDate,
      positionCode: parsed.data.positionCode,
      payScaleGroup: parsed.data.payScaleGroup,
      amountPaise: toPaise(parsed.data.amount),
      currency: parsed.data.currency,
      reason: parsed.data.reason,
    },
    session.username,
  );
  if (!r.ok) return fail(r.error);
  await kickJobs();
  revalidateEmployee(parsed.data.employeeId);
  revalidatePath("/org", "layout");
  return OK;
}

/* ------------------------------------------------------------------ letters */

export async function saveLetterTemplate(_prev: ActionState, form: FormData): Promise<ActionState> {
  const session = await requirePermission("employee.edit");
  const kind = str(form.get("kind"));
  const body = str(form.get("body"));
  if (!kind) return fail("Name the kind of letter, such as \"Appointment\".");
  if (body.length < 20) return fail("Write the letter's body.");

  const version = await rawClient().execute({ sql: "SELECT COALESCE(MAX(version), 0) AS v FROM pa_letter_template WHERE kind = ?", args: [kind] });
  const next = Number(version.rows[0].v) + 1;
  const at = new Date().toISOString();
  await rawClient().batch(
    [
      { sql: "UPDATE pa_letter_template SET is_active = 0 WHERE kind = ?", args: [kind] },
      {
        sql: "INSERT INTO pa_letter_template (kind, version, is_active, body, created_by, created_at) VALUES (?, ?, 1, ?, ?, ?)",
        args: [kind, next, body, session.username, at],
      },
    ],
    "write",
  );
  const logged = changeStatement(actorOf(session), { entity: "pa_letter_template", entityId: kind, action: "create", after: { kind, version: next } });
  if (logged) await rawClient().execute(logged);
  revalidatePath("/core-hr/letter-templates");
  return OK;
}

export async function issueLetterAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const session = await requirePermission("employee.edit");
  const employeeId = num(form.get("employeeId"));
  const templateId = num(form.get("templateId"));
  const issueDate = str(form.get("issueDate")) || new Date().toISOString().slice(0, 10);
  if (!dateish.safeParse(issueDate).success) return fail("Enter the date the letter is issued.");
  const guard = await guardEmployee(session, employeeId);
  if (guard) return fail(guard);

  const r = await issueLetter(actorOf(session), { employeeId, templateId, issueDate }, session.username);
  if (!r.ok) return fail(r.error);
  revalidateEmployee(employeeId);
  return OK;
}
