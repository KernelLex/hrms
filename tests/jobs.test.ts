import { describe, expect, it } from "vitest";
import { rawClient } from "@/lib/db";
import { startRunAction, setPeriodStatus } from "@/app/actions/payroll";
import { openCycle, saveCalibration } from "@/app/actions/performance";
import { claimJob, enqueueJob, requeueJob } from "@/lib/jobs/queue";
import { processJobs, signKick, verifyKick } from "@/lib/jobs/runner";
import { isoWeek } from "@/lib/jobs/handlers";
import { POST as kick } from "@/app/api/jobs/kick/route";
import { GET as tick } from "@/app/api/cron/tick/route";
import { form } from "./support/fixtures";
import { createArea, createPeriod, hireForPayroll } from "./support/payroll-fixtures";
import { createPerson } from "./support/people";

/**
 * Background jobs: work that carries on after the request that asked for it,
 * without a browser, exactly once, and retried when it fails.
 */

async function job(dedupeKey: string) {
  const r = await rawClient().execute({ sql: "SELECT * FROM app_job WHERE dedupe_key = ?", args: [dedupeKey] });
  return r.rows[0];
}

/** Works the queue until it is empty, as the runner's hand-offs would. */
async function drain(rounds = 20) {
  for (let i = 0; i < rounds; i++) {
    const { more } = await processJobs(5_000);
    if (!more) return;
  }
}

describe("the queue", () => {
  it("keeps one job per key", async () => {
    const key = `test.dedupe:${crypto.randomUUID()}`;
    await enqueueJob("test.nothing", null, { dedupeKey: key });
    await enqueueJob("test.nothing", null, { dedupeKey: key });
    const r = await rawClient().execute({ sql: "SELECT COUNT(*) AS n FROM app_job WHERE dedupe_key = ?", args: [key] });
    expect(Number(r.rows[0].n)).toBe(1);
  });

  it("retries a failing job with a growing gap, then gives up", async () => {
    const key = `test.fail:${crypto.randomUUID()}`;
    await enqueueJob("test.no-such-handler", null, { dedupeKey: key, maxAttempts: 2 });

    await processJobs(2_000);
    let row = await job(key);
    expect(row.status).toBe("queued");
    expect(String(row.last_error)).toMatch(/No handler/);
    expect(new Date(String(row.run_after)).getTime()).toBeGreaterThan(Date.now() + 20_000);

    // Due again now.
    await rawClient().execute({ sql: "UPDATE app_job SET run_after = ? WHERE dedupe_key = ?", args: [new Date(0).toISOString(), key] });
    await processJobs(2_000);
    row = await job(key);
    expect(row.status).toBe("failed");
    expect(Number(row.attempts)).toBe(2);
  });

  it("takes over a job whose worker died", async () => {
    const key = `test.stale:${crypto.randomUUID()}`;
    await rawClient().execute({
      sql: `INSERT INTO app_job (kind, dedupe_key, status, attempts, max_attempts, run_after, locked_at, lock_token, created_at)
            VALUES ('test.stale', ?, 'running', 1, 5, '2000-01-01T00:00:00.000Z', ?, 'dead-worker', ?)`,
      args: [key, new Date(Date.now() - 10 * 60_000).toISOString(), new Date().toISOString()],
    });
    // Clear anything due ahead of it.
    await drain();
    const r = await rawClient().execute({ sql: "SELECT status, lock_token FROM app_job WHERE dedupe_key = ?", args: [key] });
    expect(r.rows[0].lock_token).not.toBe("dead-worker");
    expect(["failed", "queued"]).toContain(r.rows[0].status); // no handler: it was run, and failed
  });

  it("never hands one job to two workers", async () => {
    await drain();
    const key = `test.claim:${crypto.randomUUID()}`;
    await enqueueJob("test.claim", null, { dedupeKey: key });
    const [a, b] = await Promise.all([claimJob(), claimJob()]);
    const claimed = [a, b].filter((j) => j?.kind === "test.claim");
    expect(claimed).toHaveLength(1);
  });

  it("puts a finished keyed job back in the queue, but leaves a live one alone", async () => {
    const key = `test.requeue:${crypto.randomUUID()}`;
    await requeueJob("test.requeue", { n: 1 }, key);
    await rawClient().execute({ sql: "UPDATE app_job SET status = 'running' WHERE dedupe_key = ?", args: [key] });
    await requeueJob("test.requeue", { n: 2 }, key);
    expect((await job(key)).status).toBe("running");

    await rawClient().execute({ sql: "UPDATE app_job SET status = 'done' WHERE dedupe_key = ?", args: [key] });
    await requeueJob("test.requeue", { n: 3 }, key);
    const row = await job(key);
    expect(row.status).toBe("queued");
    expect(JSON.parse(String(row.payload))).toEqual({ n: 3 });
  });
});

describe("payroll in the background", () => {
  it("finishes a run with nobody watching, and tells people when the month is posted", async () => {
    const area = await createArea();
    const people = await Promise.all(
      [1, 2, 3].map(() => hireForPayroll({ area, hireDate: "2025-01-01", pay: [{ from: "2025-01-01", amountRupees: 50_000 }] })),
    );
    const periodId = await createPeriod(area, 2026, 3);

    const started = await startRunAction({}, form({ periodId }));
    expect(started.ok).toBe(true);
    const runId = started.runId!;

    // No screen polls. The queue is worked the way after() and the hand-offs work it.
    await drain();
    const run = await rawClient().execute({ sql: "SELECT status FROM py_payroll_run WHERE id = ?", args: [runId] });
    expect(run.rows[0].status).toBe("Completed");
    const results = await rawClient().execute({ sql: "SELECT COUNT(*) AS n FROM py_payroll_result WHERE run_id = ?", args: [runId] });
    expect(Number(results.rows[0].n)).toBe(people.length);
    expect((await job(`payroll.run:${runId}`)).status).toBe("done");

    // Posting queues the payslip notices; nobody here has a login, so nobody is told.
    expect(await setPeriodStatus({}, form({ id: periodId, status: "Posted" }))).toEqual({ ok: true });
    expect((await job(`payslips.notify:${runId}`)).status).toBe("queued");
    await drain();
    expect((await job(`payslips.notify:${runId}`)).status).toBe("done");
  });
});

describe("performance notices", () => {
  it("reminds everyone with a self review due when a cycle opens, once a week", async () => {
    const person = await createPerson();
    const cycle = await rawClient().execute({
      sql: `INSERT INTO pm_appraisal_cycle (name, period_label, start_date, end_date, template_code, status, created_at)
            VALUES (?, 'FY test', '2030-04-01', '2031-03-31', 'STANDARD', 'Draft', ?) RETURNING id`,
      args: [`Cycle ${crypto.randomUUID().slice(0, 6)}`, new Date().toISOString()],
    });
    const cycleId = Number(cycle.rows[0].id);

    expect(await openCycle({}, form({ id: cycleId }))).toEqual({ ok: true });
    await drain();
    await enqueueJob("self_review.notify", { cycleId }, { dedupeKey: `self_review.notify:${cycleId}:again` });
    await drain();

    const r = await rawClient().execute({
      sql: "SELECT kind, dedupe_key FROM app_notification WHERE user_id = ? AND kind = 'self_review.due'",
      args: [person.userId],
    });
    expect(r.rows.length).toBeGreaterThanOrEqual(1);
    const forThisCycle = r.rows.filter((n) => String(n.dedupe_key).endsWith(isoWeek(new Date().toISOString().slice(0, 10))));
    expect(new Set(forThisCycle.map((n) => n.dedupe_key)).size).toBe(forThisCycle.length);

    // Finalising the rating tells the person.
    const appraisal = await rawClient().execute({
      sql: "SELECT id FROM pm_appraisal WHERE cycle_id = ? AND employee_id = ?",
      args: [cycleId, person.employeeId],
    });
    const appraisalId = Number(appraisal.rows[0].id);
    await rawClient().execute({ sql: "UPDATE pm_appraisal SET status = 'Completed', self_rating = 4, manager_rating = 4 WHERE id = ?", args: [appraisalId] });
    expect(await saveCalibration({}, form({ appraisalId, calibratedRating: 4, finalise: "1" }))).toEqual({ ok: true });
    const finalised = await rawClient().execute({
      sql: "SELECT title FROM app_notification WHERE user_id = ? AND kind = 'rating.finalised'",
      args: [person.userId],
    });
    expect(finalised.rows).toHaveLength(1);
  });
});

describe("waking the runner", () => {
  it("accepts only a fresh token signed by this deployment", () => {
    const now = Date.now();
    expect(verifyKick(signKick(now), now)).toBe(true);
    expect(verifyKick(signKick(now), now + 10 * 60_000)).toBe(false);
    expect(verifyKick(`${Math.floor(now / 1000)}.${"0".repeat(64)}`, now)).toBe(false);
    expect(verifyKick(null, now)).toBe(false);
  });

  it("refuses an unsigned hand-off", async () => {
    const refused = await kick(new Request("http://localhost/api/jobs/kick", { method: "POST" }));
    expect(refused.status).toBe(401);
    const accepted = await kick(
      new Request("http://localhost/api/jobs/kick", { method: "POST", headers: { authorization: `Bearer ${signKick()}` } }),
    );
    expect(accepted.status).toBe(202);
  });

  it("guards the daily tick with the cron secret once one is set", async () => {
    process.env.CRON_SECRET = "tick-secret";
    try {
      expect((await tick(new Request("http://localhost/api/cron/tick"))).status).toBe(401);
      const ok = await tick(new Request("http://localhost/api/cron/tick", { headers: { authorization: "Bearer tick-secret" } }));
      expect(ok.status).toBe(200);
    } finally {
      delete process.env.CRON_SECRET;
    }
  });

  it("names ISO weeks", () => {
    expect(isoWeek("2026-01-01")).toBe("2026-W01");
    expect(isoWeek("2027-01-01")).toBe("2026-W53");
    expect(isoWeek("2026-09-27")).toBe("2026-W39");
  });
});
