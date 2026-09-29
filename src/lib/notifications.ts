import "server-only";
import type { InStatement } from "@libsql/client";
import { rawClient } from "@/lib/db";
import { today } from "@/db/schema/_shared";
import { queueEmailStatement, renderEmail } from "@/lib/email";
import { requeueStatement } from "@/lib/jobs/queue";

/**
 * Notifications: what the system tells a person, in their inbox and — if
 * they want it — by email.
 *
 * `notificationStatements` returns plain inserts, so a caller with its own
 * transaction puts the notification in the same commit as the change that
 * caused it. Every notification and every email has a dedupe key built from
 * the event and the person, so an event that is retried cannot tell anyone
 * twice.
 */

export const NOTIFICATION_KINDS = {
  "leave.submitted": {
    label: "Leave requests from my team",
    description: "When someone who reports to you asks for leave.",
  },
  "approval.waiting": {
    label: "Approvals waiting for me",
    description: "When a request reaches you at a later approval step, or is overdue and escalated to you.",
  },
  "leave.decided": {
    label: "Decisions on my leave",
    description: "When your manager approves or rejects a request.",
  },
  "payslip.ready": {
    label: "Payslips",
    description: "When a month is posted and your payslip is ready. By email, it comes as a protected PDF where the company emails payslips.",
  },
  "self_review.due": {
    label: "Self review reminders",
    description: "When an appraisal cycle opens, and weekly while your self review is due.",
  },
  "rating.finalised": {
    label: "My final rating",
    description: "When calibration finalises your appraisal rating.",
  },
  "change_request.decided": {
    label: "Decisions on my change requests",
    description: "When HR approves or rejects a change you asked for to your record.",
  },
  "interview.assigned": {
    label: "Interviews I am asked to take",
    description: "When someone schedules you to interview a candidate, or moves your interview.",
  },
  "application.received": {
    label: "Applications from the careers page",
    description: "When a candidate applies for an open role. Only for people who run recruitment.",
  },
  "probation.due": {
    label: "Probation reviews due",
    description: "When someone's probation review is due soon, or overdue. Sent to HR.",
  },
} as const;

export type NotificationKind = keyof typeof NOTIFICATION_KINDS;

export type NotificationItem = {
  userId: number;
  kind: NotificationKind;
  title: string;
  body?: string | null;
  link?: string | null;
  /** The event, per person: "leave.decided:42:7". */
  dedupeKey: string;
  /** False when the person is emailed another way — a payslip with its PDF. */
  email?: boolean;
};

type Prefs = { inApp: boolean; email: boolean };

async function prefsFor(items: NotificationItem[]): Promise<Map<string, Prefs>> {
  const users = [...new Set(items.map((i) => i.userId))];
  if (users.length === 0) return new Map();
  const r = await rawClient().execute({
    sql: `SELECT user_id, kind, in_app, email FROM app_notification_pref
          WHERE user_id IN (${users.map(() => "?").join(", ")})`,
    args: users,
  });
  return new Map(
    r.rows.map((p) => [
      `${p.user_id}:${p.kind}`,
      { inApp: Number(p.in_app) === 1, email: Number(p.email) === 1 },
    ]),
  );
}

/** Each user's work email, from their communication record, if they have one. */
export async function emailsFor(userIds: number[]): Promise<Map<number, string>> {
  if (userIds.length === 0) return new Map();
  const r = await rawClient().execute({
    sql: `SELECT u.id AS user_id, (
            SELECT c.value FROM pa_it0105_communication c
            WHERE c.employee_id = u.employee_id AND c.comm_type LIKE 'Email%'
              AND c.valid_from <= ? AND c.valid_to >= ?
            ORDER BY c.comm_type = 'Email (official)' DESC LIMIT 1
          ) AS email
          FROM sec_app_user u
          WHERE u.id IN (${userIds.map(() => "?").join(", ")}) AND u.is_active = 1`,
    args: [today(), today(), ...userIds],
  });
  return new Map(
    r.rows.filter((row) => row.email).map((row) => [Number(row.user_id), String(row.email)]),
  );
}

/**
 * The inserts for a set of notifications and their emails, plus a job to
 * deliver the emails. Respects each person's preferences.
 */
export async function notificationStatements(items: NotificationItem[]): Promise<InStatement[]> {
  if (items.length === 0) return [];
  const [prefs, emails] = await Promise.all([
    prefsFor(items),
    emailsFor([...new Set(items.map((i) => i.userId))]),
  ]);
  const at = new Date().toISOString();
  const statements: InStatement[] = [];
  let anyEmail = false;

  for (const item of items) {
    const pref = prefs.get(`${item.userId}:${item.kind}`) ?? { inApp: true, email: true };
    if (pref.inApp) {
      statements.push({
        sql: `INSERT INTO app_notification (user_id, kind, title, body, link, dedupe_key, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT (dedupe_key) DO NOTHING`,
        args: [item.userId, item.kind, item.title, item.body ?? null, item.link ?? null, item.dedupeKey, at],
      });
    }
    const to = emails.get(item.userId);
    if (pref.email && to && item.email !== false) {
      const message = renderEmail({ title: item.title, body: item.body, link: item.link });
      statements.push(
        queueEmailStatement(`${item.dedupeKey}:email`, { to, ...message }, {
          kind: item.kind,
          userId: item.userId,
          dedupeKey: item.dedupeKey,
        }),
      );
      anyEmail = true;
    }
  }

  if (anyEmail) {
    // One delivery job, put back in the queue whenever it has finished. A
    // job already queued or running will reach these emails too.
    statements.push(requeueStatement("outbox.deliver", null, "outbox.deliver"));
  }
  return statements;
}

/** Writes notifications on their own, after the change that caused them. */
export async function notify(items: NotificationItem[]): Promise<void> {
  const statements = await notificationStatements(items);
  if (statements.length > 0) await rawClient().batch(statements, "write");
}

/* ------------------------------------------------------------ recipients */

/** The sign-in for each employee, where they have one. */
export async function usersForEmployees(employeeIds: number[]): Promise<Map<number, number>> {
  if (employeeIds.length === 0) return new Map();
  const r = await rawClient().execute({
    sql: `SELECT id, employee_id FROM sec_app_user
          WHERE is_active = 1 AND employee_id IN (${employeeIds.map(() => "?").join(", ")})`,
    args: employeeIds,
  });
  return new Map(r.rows.map((u) => [Number(u.employee_id), Number(u.id)]));
}

/** Everyone who can act as HR. */
export async function hrUserIds(): Promise<number[]> {
  const r = await rawClient().execute(
    `SELECT u.id FROM sec_app_user u JOIN sec_user_role ur ON ur.user_id = u.id
     WHERE ur.role_code = 'HR_ADMIN' AND u.is_active = 1`,
  );
  return r.rows.map((u) => Number(u.id));
}

/* ----------------------------------------------------------------- inbox */

export async function unreadCount(userId: number): Promise<number> {
  const r = await rawClient().execute({
    sql: "SELECT COUNT(*) AS n FROM app_notification WHERE user_id = ? AND read_at IS NULL",
    args: [userId],
  });
  return Number(r.rows[0].n);
}

export type InboxItem = {
  id: number;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  createdAt: string;
  readAt: string | null;
};

export async function listNotifications(
  userId: number,
  limit = 50,
  offset = 0,
): Promise<{ rows: InboxItem[]; total: number }> {
  const [page, count] = await Promise.all([
    rawClient().execute({
      sql: `SELECT id, kind, title, body, link, created_at, read_at FROM app_notification
            WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
      args: [userId, limit, offset],
    }),
    rawClient().execute({
      sql: "SELECT COUNT(*) AS n FROM app_notification WHERE user_id = ?",
      args: [userId],
    }),
  ]);
  return {
    total: Number(count.rows[0].n),
    rows: page.rows.map((n) => ({
      id: Number(n.id),
      kind: String(n.kind),
      title: String(n.title),
      body: n.body === null ? null : String(n.body),
      link: n.link === null ? null : String(n.link),
      createdAt: String(n.created_at),
      readAt: n.read_at === null ? null : String(n.read_at),
    })),
  };
}

/** Every kind, with this person's choice or the default of both on. */
export async function preferencesOf(
  userId: number,
): Promise<{ kind: NotificationKind; label: string; description: string; inApp: boolean; email: boolean }[]> {
  const r = await rawClient().execute({
    sql: "SELECT kind, in_app, email FROM app_notification_pref WHERE user_id = ?",
    args: [userId],
  });
  const saved = new Map(r.rows.map((p) => [String(p.kind), p]));
  return (Object.keys(NOTIFICATION_KINDS) as NotificationKind[]).map((kind) => {
    const p = saved.get(kind);
    return {
      kind,
      ...NOTIFICATION_KINDS[kind],
      inApp: p ? Number(p.in_app) === 1 : true,
      email: p ? Number(p.email) === 1 : true,
    };
  });
}
