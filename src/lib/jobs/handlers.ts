import "server-only";
import type { InStatement } from "@libsql/client";
import { rawClient } from "@/lib/db";
import { deliverOutbox } from "@/lib/email";
import { processRunBatch } from "@/lib/engines/payroll";
import { hrUserIds, notificationStatements, notify, usersForEmployees, type NotificationItem } from "@/lib/notifications";
import { probationDue } from "@/lib/services/monitoring";
import { formatMonth, todayInIndia } from "@/lib/dates";
import { enqueueJob, requeueJob } from "./queue";
import { escalateOverdue } from "@/lib/workflow/engine";
import { deliverWebhooks, nextWebhookRetry, wakeDeliveryStatement } from "@/lib/api/events";
import { changeStatement, recordChanges, systemActor } from "@/lib/change-log";
import { payslipEmailStatements } from "@/lib/payslip-mail";

/**
 * What each kind of job does. A handler returns `{ again: true }` to be put
 * back and continued — a long payroll run goes a batch at a time until it is
 * done — and throws to be retried with a growing gap.
 */

export type JobContext = { jobId: number; deadline: number };
export type JobResult = void | { again: true; delayMs?: number };
export type JobHandler = (payload: unknown, ctx: JobContext) => Promise<JobResult>;

const timeLeft = (ctx: JobContext) => ctx.deadline - Date.now();

/** "2026-W39", the ISO week: one self-review reminder per person per week at most. */
export function isoWeek(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum); // the Thursday of this week
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((d.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

async function notifySelfReviews(cycleId: number | null): Promise<number> {
  const r = await rawClient().execute({
    sql: `SELECT a.id, a.employee_id, c.name AS cycle
          FROM pm_appraisal a JOIN pm_appraisal_cycle c ON c.id = a.cycle_id
          WHERE c.status = 'Active' AND a.status = 'Pending self review'
            ${cycleId === null ? "" : "AND c.id = ?"}`,
    args: cycleId === null ? [] : [cycleId],
  });
  const users = await usersForEmployees(r.rows.map((a) => Number(a.employee_id)));
  const week = isoWeek(todayInIndia());
  const items: NotificationItem[] = [];
  for (const a of r.rows) {
    const userId = users.get(Number(a.employee_id));
    if (!userId) continue;
    items.push({
      userId,
      kind: "self_review.due",
      title: `Your self review for ${a.cycle} is due`,
      body: "Rate your year against your goals, so your manager can add theirs.",
      link: "/performance/mine",
      dedupeKey: `self_review.due:${a.id}:${week}`,
    });
  }
  await notify(items);
  return items.length;
}

/** Reviews due within a week, or overdue, told to HR once each. */
async function notifyProbationDue(): Promise<number> {
  const due = (await probationDue(7)).filter((d) => !d.remindedAt);
  if (due.length === 0) return 0;
  const hrIds = await hrUserIds();
  if (hrIds.length === 0) return 0;

  const items: NotificationItem[] = [];
  for (const d of due) {
    for (const userId of hrIds) {
      items.push({
        userId,
        kind: "probation.due",
        title: d.overdue ? "A probation review is overdue" : "A probation review is due soon",
        body: `Due ${d.date}.`,
        link: "/core-hr/probation",
        dedupeKey: `probation.due:${d.id}:${userId}`,
      });
    }
  }
  await notify(items);
  await rawClient().execute({
    sql: `UPDATE pa_it0019_monitoring SET reminded_at = ? WHERE id IN (${due.map(() => "?").join(", ")})`,
    args: [new Date().toISOString(), ...due.map((d) => d.id)],
  });
  return due.length;
}

export const HANDLERS: Record<string, JobHandler> = {
  /** Sends what is due in the outbox until it is empty or time runs out. */
  async "outbox.deliver"(_payload, ctx) {
    while (timeLeft(ctx) > 1_000) {
      const handled = await deliverOutbox(25);
      if (handled === 0) return;
    }
    return { again: true };
  },

  /**
   * Sends due webhooks until none are left or time runs out. Retries not yet
   * due are picked up by a later pass: the next request that queues work,
   * or the daily tick.
   */
  async "webhooks.deliver"(_payload, ctx) {
    while (timeLeft(ctx) > 2_000) {
      const handled = await deliverWebhooks(25);
      if (handled === 0) break;
    }
    const next = await nextWebhookRetry();
    if (next !== null) return { again: true, delayMs: Math.max(0, next - Date.now()) };
  },

  /** Calculates a payroll run batch by batch, and continues until it is done. */
  async "payroll.run"(payload, ctx) {
    const { runId } = payload as { runId: number };
    while (timeLeft(ctx) > 3_000) {
      const progress = await processRunBatch(runId);
      if (progress.completed) {
        // Logged, so the ERP hears payroll.run.completed.
        await recordChanges(systemActor("payroll"), [
          { entity: "py_payroll_run", entityId: runId, action: "update", before: { status: "In progress" }, after: { status: "Completed" } },
        ]);
        const run = await rawClient().execute({
          sql: "SELECT run_type FROM py_payroll_run WHERE id = ?",
          args: [runId],
        });
        // An off-cycle payslip is ready as soon as its run is done; a
        // regular one waits for the period to be posted.
        if (run.rows[0]?.run_type === "Off-cycle") {
          await enqueueJob("payslips.notify", { runId }, { dedupeKey: `payslips.notify:${runId}` });
        }
        return;
      }
    }
    return { again: true };
  },

  /**
   * Publishes a run's payslips: each is marked published and logged (the
   * ERP hears payslip.published), the employee is told in the app, and —
   * where the period emails payslips — sent it as a protected PDF, in place
   * of the plain notification email. Safe to run twice: nothing is
   * published, told or emailed a second time.
   */
  async "payslips.notify"(payload) {
    const { runId } = payload as { runId: number };
    const r = await rawClient().execute({
      sql: `SELECT r.id, r.employee_id, r.published_at, p.year, p.month, p.email_payslips, run.run_type, run.reason
            FROM py_payroll_result r
            JOIN py_payroll_run run ON run.id = r.run_id AND run.status = 'Completed'
            JOIN py_payroll_period p ON p.id = run.period_id
            WHERE r.run_id = ? AND r.status = 'Calculated'`,
      args: [runId],
    });
    const at = new Date().toISOString();
    const actor = systemActor("payroll");

    // In chunks, so a large organisation is not one enormous batch.
    for (let i = 0; i < r.rows.length; i += 200) {
      const rows = r.rows.slice(i, i + 200);
      const fresh = rows.filter((x) => x.published_at === null);
      const publish: InStatement[] = [];
      for (const x of fresh) {
        publish.push({ sql: "UPDATE py_payroll_result SET published_at = ? WHERE id = ? AND published_at IS NULL", args: [at, Number(x.id)] });
        const logged = changeStatement(actor, {
          entity: "py_payroll_result",
          entityId: Number(x.id),
          subjectEmployeeId: Number(x.employee_id),
          action: "update",
          before: { published_at: null },
          after: { published_at: at },
        });
        if (logged) publish.push(logged);
      }

      const emailing = rows.length > 0 && Number(rows[0].email_payslips) === 1;
      const mail = emailing ? await payslipEmailStatements(rows.map((x) => Number(x.id))) : null;
      const users = await usersForEmployees(rows.map((x) => Number(x.employee_id)));
      const items: NotificationItem[] = [];
      for (const x of rows) {
        const userId = users.get(Number(x.employee_id));
        if (!userId) continue;
        const month = formatMonth(Number(x.year), Number(x.month));
        const offCycle = x.run_type === "Off-cycle";
        items.push({
          userId,
          kind: "payslip.ready",
          title: offCycle ? `Your off-cycle payslip for ${month} is ready` : `Your payslip for ${month} is ready`,
          body: offCycle && x.reason ? `For ${x.reason}.` : "Open it to see each line of your pay.",
          link: `/payroll/payslip/${x.id}`,
          dedupeKey: `payslip.ready:${x.id}`,
          // Emailed with the PDF instead.
          email: mail?.emailed.has(Number(x.employee_id)) ? false : undefined,
        });
      }
      const statements = [...publish, ...(mail?.statements ?? []), ...(await notificationStatements(items))];
      if (statements.length > 0) await rawClient().batch(statements, "write");
    }
  },

  /** When a cycle opens: everyone with a self review to write. */
  async "self_review.notify"(payload) {
    const { cycleId } = payload as { cycleId: number };
    await notifySelfReviews(cycleId);
  },

  /**
   * Once a day: weekly self-review reminders, overdue approvals escalated,
   * any payroll run left without a job, and housekeeping.
   */
  async "daily"() {
    await notifySelfReviews(null);
    await notifyProbationDue();

    // Approval steps that have waited longer than their flow allows.
    await escalateOverdue();

    // A run whose job failed or vanished is picked up again; one still
    // being worked is left alone.
    const unfinished = await rawClient().execute(
      "SELECT id FROM py_payroll_run WHERE status = 'In progress'",
    );
    for (const run of unfinished.rows) {
      await requeueJob("payroll.run", { runId: Number(run.id) }, `payroll.run:${run.id}`);
    }

    // An email that arrived as the delivery job was finishing is sent now.
    const waiting = await rawClient().execute(
      "SELECT 1 FROM app_outbox WHERE status IN ('queued', 'sending') LIMIT 1",
    );
    if (waiting.rows.length > 0) await requeueJob("outbox.deliver", null, "outbox.deliver");

    // Webhook retries that were waiting for a pass.
    const hooks = await rawClient().execute(
      "SELECT 1 FROM app_outbox WHERE channel = 'webhook' AND status IN ('queued', 'sending') LIMIT 1",
    );
    if (hooks.rows.length > 0) await rawClient().execute(wakeDeliveryStatement());

    const month = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const week = new Date(Date.now() - 7 * 86_400_000).toISOString();
    await rawClient().batch(
      [
        { sql: "DELETE FROM app_job WHERE status = 'done' AND finished_at < ?", args: [month] },
        { sql: "DELETE FROM app_job_run WHERE started_at < ?", args: [month] },
        // API housekeeping, as API.md promises: calls kept 30 days, idempotency keys 7.
        { sql: "DELETE FROM int_request_log WHERE at < ?", args: [month] },
        { sql: "DELETE FROM int_idempotency WHERE created_at < ?", args: [week] },
      ],
      "write",
    );
  },
};

/** Jobs queued once a day, keyed by the date in India. */
export const DAILY = ["daily"] as const;
