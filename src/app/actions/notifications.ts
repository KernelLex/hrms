"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { rawClient } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { NOTIFICATION_KINDS, type NotificationKind } from "@/lib/notifications";

/**
 * The inbox: opening a notification, marking everything read, and choosing
 * what to hear about. Each works on the signed-in person's own rows only —
 * the user id comes from the session, never the form.
 */

export type ActionState = { error?: string; ok?: boolean };

function revalidateInbox() {
  // The unread count sits in the app layout.
  revalidatePath("/", "layout");
}

/** Only links inside the app: a notification never sends anyone elsewhere. */
function safeLink(link: unknown): string {
  return typeof link === "string" && link.startsWith("/") && !link.startsWith("//") ? link : "/inbox";
}

/** Marks one notification read and follows its link. */
export async function openNotification(form: FormData): Promise<void> {
  const session = await requireSession();
  const id = Number(form.get("id"));
  const r = await rawClient().execute({
    sql: `UPDATE app_notification SET read_at = COALESCE(read_at, ?)
          WHERE id = ? AND user_id = ? RETURNING link`,
    args: [new Date().toISOString(), id, session.userId],
  });
  revalidateInbox();
  redirect(safeLink(r.rows[0]?.link));
}

export async function markAllRead(): Promise<void> {
  const session = await requireSession();
  await rawClient().execute({
    sql: "UPDATE app_notification SET read_at = ? WHERE user_id = ? AND read_at IS NULL",
    args: [new Date().toISOString(), session.userId],
  });
  revalidateInbox();
}

/**
 * Saves every kind at once: a box left unticked is a kind switched off, so
 * the form sends the ones that are on.
 */
export async function saveNotificationPrefs(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireSession();
  const kinds = Object.keys(NOTIFICATION_KINDS) as NotificationKind[];
  await rawClient().batch(
    kinds.map((kind) => ({
      sql: `INSERT INTO app_notification_pref (user_id, kind, in_app, email) VALUES (?, ?, ?, ?)
            ON CONFLICT (user_id, kind) DO UPDATE SET in_app = excluded.in_app, email = excluded.email`,
      args: [
        session.userId,
        kind,
        form.get(`${kind}:inApp`) === "on" ? 1 : 0,
        form.get(`${kind}:email`) === "on" ? 1 : 0,
      ],
    })),
    "write",
  );
  revalidatePath("/inbox", "layout");
  return { ok: true };
}
