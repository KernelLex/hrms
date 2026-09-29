"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAnyPermission } from "@/lib/access";
import { actorOf } from "@/lib/change-log";
import { submitHeadcountRequest } from "@/lib/services/headcount";
import { toPaise } from "@/lib/money";
import { kickJobs } from "@/lib/jobs/runner";

/** Asking for a new position: a manager's own request, or HR filing one directly. */

export type ActionState = { error?: string; ok?: boolean };

const OK: ActionState = { ok: true };
const fail = (error: string): ActionState => ({ error });
const str = (v: FormDataEntryValue | null) => (typeof v === "string" ? v.trim() : "");
const opt = (v: FormDataEntryValue | null) => str(v) || null;

const Input = z.object({
  orgUnitCode: z.string().min(1, "Choose a department."),
  jobCode: z.string().min(1, "Choose a job."),
  title: z.string().min(1, "Name the position."),
  grade: z.string().nullable(),
  budget: z.number().positive("Enter the monthly budget."),
  reason: z.string().nullable(),
});

function revalidateHeadcount() {
  revalidatePath("/headcount-requests");
  revalidatePath("/approvals");
}

export async function requestHeadcount(_prev: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireAnyPermission("employee.view_team", "org.edit");
  const parsed = Input.safeParse({
    orgUnitCode: str(form.get("orgUnitCode")),
    jobCode: str(form.get("jobCode")),
    title: str(form.get("title")),
    grade: opt(form.get("grade")),
    budget: Number(str(form.get("budget"))),
    reason: opt(form.get("reason")),
  });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the form and try again.");
  const v = parsed.data;

  const requester = {
    userId: session.userId,
    username: session.username,
    displayName: session.displayName,
    employeeId: session.employeeId,
  };
  const r = await submitHeadcountRequest(requester, actorOf(session), {
    orgUnitCode: v.orgUnitCode,
    jobCode: v.jobCode,
    title: v.title,
    grade: v.grade,
    budgetPaise: toPaise(v.budget),
    reason: v.reason,
  });
  if (!r.ok) return fail(r.error);
  await kickJobs();
  revalidateHeadcount();
  return OK;
}
