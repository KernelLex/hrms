"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/access";
import { actorOf, recordChanges } from "@/lib/change-log";
import { rawClient } from "@/lib/db";
import { submitExitRequest, withdrawExitRequest, recordExitInterview, settleExit, DEFAULT_NOTICE_DAYS } from "@/lib/services/exits";
import { kickJobs } from "@/lib/jobs/runner";

export type ActionState = { error?: string; ok?: boolean };

const OK: ActionState = { ok: true };
const fail = (error: string): ActionState => ({ error });
const str = (v: FormDataEntryValue | null) => (typeof v === "string" ? v.trim() : "");
const opt = (v: FormDataEntryValue | null) => str(v) || null;
const num = (v: FormDataEntryValue | null) => Number(str(v));
const bool = (v: FormDataEntryValue | null) => v === "on" || v === "true" || v === "1";

function revalidate() {
  revalidatePath("/exits", "layout");
  revalidatePath("/exit");
  revalidatePath("/");
}

export async function submitExit(_prev: ActionState, form: FormData): Promise<ActionState> {
  const session = await requirePermission("self.exit");
  const r = await submitExitRequest(
    { userId: session.userId, username: session.username, displayName: session.displayName, employeeId: session.employeeId },
    actorOf(session),
    {
      exitType: (str(form.get("exitType")) || "Resignation") as "Resignation" | "Termination" | "Retirement",
      requestedLastDay: str(form.get("requestedLastDay")),
      reason: opt(form.get("reason")),
      noticeDays: form.has("noticeDays") ? num(form.get("noticeDays")) : DEFAULT_NOTICE_DAYS,
    },
  );
  if (!r.ok) return fail(r.error);
  await kickJobs();
  revalidate();
  revalidatePath("/approvals");
  return OK;
}

export async function withdrawExit(_prev: ActionState, form: FormData): Promise<ActionState> {
  const session = await requirePermission("self.exit");
  const r = await withdrawExitRequest(
    { userId: session.userId, username: session.username, displayName: session.displayName, employeeId: session.employeeId },
    actorOf(session),
    num(form.get("id")),
  );
  if (!r.ok) return fail(r.error);
  revalidate();
  return OK;
}

export async function submitExitInterview(_prev: ActionState, form: FormData): Promise<ActionState> {
  const session = await requirePermission("self.exit");
  const r = await recordExitInterview(actorOf(session), {
    exitId: num(form.get("exitId")),
    primaryReason: opt(form.get("primaryReason")),
    wouldRecommend: form.has("wouldRecommend") ? bool(form.get("wouldRecommend")) : null,
    comments: opt(form.get("comments")),
    submittedBy: session.username,
  });
  if (!r.ok) return fail(r.error);
  revalidate();
  return OK;
}

/** HR waives a notice shortfall instead of it being recovered when the exit is settled. */
export async function waiveNoticeAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const session = await requirePermission("employee.edit");
  const id = num(form.get("id"));
  const waived = bool(form.get("waived"));
  await rawClient().execute({ sql: "UPDATE pa_exit SET notice_waived = ? WHERE id = ? AND status = 'Approved'", args: [waived ? 1 : 0, id] });
  await recordChanges(actorOf(session), [{ entity: "pa_exit", entityId: id, action: "update", after: { noticeWaived: waived }, reason: waived ? "Notice waived" : "Notice shortfall will be recovered" }]);
  revalidate();
  return OK;
}

/** A manual trigger for the same settlement the daily job runs automatically once the last day arrives. */
export async function settleExitAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const session = await requirePermission("payroll.run");
  const r = await settleExit(actorOf(session), num(form.get("id")));
  if (!r.ok) return fail(r.error);
  revalidate();
  revalidatePath("/payroll/run");
  return OK;
}
