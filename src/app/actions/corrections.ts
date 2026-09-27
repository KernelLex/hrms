"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/access";
import { actorOf } from "@/lib/change-log";
import { cancelChangeRequest, submitChangeRequest } from "@/lib/services/corrections";
import { SECTIONS, isSection } from "@/lib/corrections-values";

/**
 * Employees asking for their own record to be corrected, from My profile.
 * HR decides in the approvals inbox; the engine and the service do the rest.
 */

export type ActionState = { error?: string; ok?: boolean };

const str = (v: FormDataEntryValue | null) => (typeof v === "string" ? v.trim() : "");

function revalidate() {
  revalidatePath("/me");
  revalidatePath("/approvals");
  revalidatePath("/");
}

export async function requestChange(_prev: ActionState, form: FormData): Promise<ActionState> {
  const session = await requirePermission("self.profile");
  if (!session.employeeId) return { error: "This sign-in is not linked to an employee record." };
  const section = str(form.get("section"));
  if (!isSection(section)) return { error: "Choose what to change." };

  const file = form.get("evidence");
  const evidence = file instanceof File && file.size > 0 ? file : null;
  const values = Object.fromEntries(Object.keys(SECTIONS[section].fields).map((f) => [f, str(form.get(f))]));

  const r = await submitChangeRequest(session, actorOf(session), {
    employeeId: session.employeeId,
    section,
    subtype: str(form.get("subtype")) || null,
    values,
    effectiveDate: str(form.get("effectiveDate")),
    note: str(form.get("note")) || null,
    evidence,
    channel: "self",
  });
  if (!r.ok) return { error: r.error };
  revalidate();
  return { ok: true };
}

export async function cancelChange(_prev: ActionState, form: FormData): Promise<ActionState> {
  const session = await requirePermission("self.profile");
  const r = await cancelChangeRequest(session, actorOf(session), Number(form.get("id")));
  if (!r.ok) return { error: r.error };
  revalidate();
  return { ok: true };
}
