import "server-only";
import { rawClient } from "@/lib/db";
import { deliverOutbox } from "@/lib/email";
import { processRunBatch } from "@/lib/engines/payroll";
import { notify, usersForEmployees, type NotificationItem } from "@/lib/notifications";
import { formatMonth, todayInIndia } from "@/lib/dates";
import { enqueueJob, requeueJob } from "./queue";

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

export const HANDLERS: Record<string, JobHandler> = {
  /** Sends what is due in the outbox until it is empty or time runs out. */
  async "outbox.deliver"(_payload, ctx) {
    while (timeLeft(ctx) > 1_000) {
      const handled = await deliverOutbox(25);
      if (handled === 0) return;
    }
    return { again: true };
  },

  /** Calculates a payroll run batch by batch, and continues until it is done. */
  async "payroll.run"(payload, ctx) {
    const { runId } = payload as { runId: number };
    while (timeLeft(ctx) > 3_000) {
      const progress = await processRunBatch(runId);
      if (progress.completed) {
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

  /** Tells everyone paid in a run that their payslip is ready. */
  async "payslips.notify"(payload) {
    const { runId } = payload as { runId: number };
    const r = await rawClient().execute({
      sql: `SELECT r.id, r.employee_id, p.year, p.month, run.run_type, run.reason
            FROM py_payroll_result r
            JOIN py_payroll_run run ON run.id = r.run_id AND run.status = 'Completed'
            JOIN py_payroll_period p ON p.id = run.period_id
            WHERE r.run_id = ? AND r.status = 'Calculated'`,
      args: [runId],
    });
    const users = await usersForEmployees(r.rows.map((x) => Number(x.employee_id)));
    const items: NotificationItem[] = [];
    for (const x of r.rows) {
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
      });
    }
    // In chunks, so a large organisation is not one enormous batch.
    for (let i = 0; i < items.length; i += 200) await notify(items.slice(i, i + 200));
  },

  /** When a cycle opens: everyone with a self review to write. */
  async "self_review.notify"(payload) {
    const { cycleId } = payload as { cycleId: number };
    await notifySelfReviews(cycleId);
  },

  /**
   * Once a day: weekly self-review reminders, any payroll run left without
   * a job, and housekeeping.
   */
  async "daily"() {
    await notifySelfReviews(null);

    // A run whose job failed or vanished is picked up again; one still
    // being worked is left alone.
    const unfinished = await rawClient().execute(
      "SELECT id FROM py_payroll_run WHERE status = 'In progress'",
    );
    for (const run of unfinished.rows) {
      await requeueJob("payroll.run", { runId: Number(run.id) }, `payroll.run:${run.id}`);
    }

    const month = new Date(Date.now() - 30 * 86_400_000).toISOString();
    await rawClient().batch(
      [
        { sql: "DELETE FROM app_job WHERE status = 'done' AND finished_at < ?", args: [month] },
        { sql: "DELETE FROM app_job_run WHERE started_at < ?", args: [month] },
      ],
      "write",
    );
  },
};

/** Jobs queued once a day, keyed by the date in India. */
export const DAILY = ["daily"] as const;
