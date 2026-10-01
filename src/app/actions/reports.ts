"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/access";
import { actorOf, recordCreated, recordDeleted } from "@/lib/change-log";
import { rpSchedule, now } from "@/db/schema";
import { REPORT_NAMES } from "@/lib/reports";

export type ActionState = { error?: string; ok?: boolean };

const OK: ActionState = { ok: true };
const fail = (error: string): ActionState => ({ error });
const str = (v: FormDataEntryValue | null) => (typeof v === "string" ? v.trim() : "");

/** A report, rendered to CSV and emailed to its recipients on the 1st of every month. */
export async function saveReportSchedule(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requirePermission("reports.view");
  const actor = actorOf(session);
  const reportName = str(form.get("reportName"));
  if (!(REPORT_NAMES as readonly string[]).includes(reportName)) return fail("Choose a report.");
  const recipients = str(form.get("recipients"));
  if (!recipients) return fail("Enter at least one email address.");
  const addresses = recipients.split(",").map((r) => r.trim()).filter(Boolean);
  if (addresses.some((a) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a))) return fail("Check the email addresses: one of them is not valid.");

  await recordCreated(
    actor,
    "rp_schedule",
    await db.insert(rpSchedule).values({ reportName, recipients: addresses.join(","), createdBy: session.displayName, createdAt: now() }).returning(),
  );

  revalidatePath("/reports", "layout");
  return OK;
}

export async function deleteReportSchedule(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const actor = actorOf(await requirePermission("reports.view"));
  const id = Number(str(form.get("id")));
  await recordDeleted(actor, "rp_schedule", await db.delete(rpSchedule).where(eq(rpSchedule.id, id)).returning());
  revalidatePath("/reports", "layout");
  return OK;
}
