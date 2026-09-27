"use server";

import { revalidatePath } from "next/cache";
import { rawClient } from "@/lib/db";
import { can, requireAccess } from "@/lib/access";
import { actorOf, recordChanges } from "@/lib/change-log";
import { formatDateRange, todayInIndia } from "@/lib/dates";
import { notify } from "@/lib/notifications";
import { kickJobs } from "@/lib/jobs/runner";
import { decide, getRequest } from "@/lib/workflow/engine";
import { PROCESSES, PROCESS_CODES, isProcess } from "@/lib/workflow/processes";

/**
 * The approvals inbox and "while I am away". Who may decide is the engine's
 * question — the request's assignees, their delegates, or whoever may decide
 * any request in the process — so these check only that someone is signed in.
 */

export type ActionState = { error?: string; ok?: boolean };

const OK: ActionState = { ok: true };
const fail = (error: string): ActionState => ({ error });
const str = (v: FormDataEntryValue | null) => (typeof v === "string" ? v.trim() : "");

function revalidateApprovals() {
  revalidatePath("/approvals");
  revalidatePath("/time", "layout");
  revalidatePath("/me");
  revalidatePath("/core-hr", "layout");
  revalidatePath("/");
}

/** A decision on any request in the inbox, by the engine's request id. */
export async function decideApproval(_prev: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireAccess();
  const decision = str(form.get("decision"));
  if (decision !== "Approved" && decision !== "Rejected") {
    return fail("That decision is not recognised.");
  }
  const request = await getRequest(Number(form.get("requestId")));
  if (!request) return fail("That request no longer exists.");

  const result = await decide({
    requestId: request.id,
    actor: session,
    decision,
    comment: str(form.get("comment")) || null,
    canOverride: can(session, PROCESSES[request.process].overridePermission),
  });
  if ("error" in result) return fail(result.error);

  await kickJobs();
  revalidateApprovals();
  return OK;
}

/**
 * "While I am away, send my approvals to…". The delegate decides what is
 * assigned to this person between the dates, and each decision records on
 * whose behalf it was taken.
 */
export async function saveDelegation(_prev: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireAccess();
  const toUserId = Number(form.get("toUserId"));
  const fromDate = str(form.get("fromDate"));
  const toDate = str(form.get("toDate"));
  const processes = form
    .getAll("process")
    .map((p) => String(p))
    .filter(isProcess);

  if (!Number.isInteger(toUserId) || toUserId <= 0) return fail("Choose who approves for you.");
  if (toUserId === session.userId) return fail("Choose someone other than yourself.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(toDate)) {
    return fail("Enter the first and last day you are away.");
  }
  if (toDate < fromDate) return fail("The last day falls before the first.");
  if (toDate < todayInIndia()) return fail("Those dates are already over.");

  const delegate = await rawClient().execute({
    sql: "SELECT id, display_name FROM sec_app_user WHERE id = ? AND is_active = 1",
    args: [toUserId],
  });
  if (!delegate.rows[0]) return fail("That person cannot sign in.");

  // Every process when all are ticked, so new processes are covered too.
  const all = processes.length === 0 || processes.length === PROCESS_CODES.length;
  const created = await rawClient().execute({
    sql: `INSERT INTO wf_delegation (from_user_id, to_user_id, from_date, to_date, processes, created_at)
          VALUES (?, ?, ?, ?, ?, ?) RETURNING *`,
    args: [session.userId, toUserId, fromDate, toDate, all ? null : processes.join(","), new Date().toISOString()],
  });
  const row = created.rows[0] as unknown as Record<string, unknown>;
  await recordChanges(actorOf(session), [
    { entity: "wf_delegation", entityId: Number(row.id), subjectEmployeeId: session.employeeId, action: "create", after: row },
  ]);
  await notify([
    {
      userId: toUserId,
      kind: "approval.waiting",
      title: `${session.displayName} has asked you to approve for them, ${formatDateRange(fromDate, toDate)}`,
      body: "Requests waiting for them appear in your approvals while they are away.",
      link: "/approvals",
      dedupeKey: `delegation:${String(row.id)}`,
    },
  ]);
  await kickJobs();
  revalidateApprovals();
  return OK;
}

/** Ends one of this person's own delegations now. */
export async function endDelegation(_prev: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireAccess();
  const id = Number(form.get("id"));
  const ended = await rawClient().execute({
    sql: `UPDATE wf_delegation SET ended_at = ? WHERE id = ? AND from_user_id = ? AND ended_at IS NULL
          RETURNING *`,
    args: [new Date().toISOString(), id, session.userId],
  });
  if (!ended.rows[0]) return fail("That hand-over has already ended.");
  await recordChanges(actorOf(session), [
    {
      entity: "wf_delegation",
      entityId: id,
      subjectEmployeeId: session.employeeId,
      action: "update",
      before: { ended_at: null },
      after: { ended_at: String(ended.rows[0].ended_at) },
    },
  ]);
  revalidateApprovals();
  return OK;
}
