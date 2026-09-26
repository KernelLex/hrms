import "server-only";
import { randomUUID } from "node:crypto";
import type { InStatement } from "@libsql/client";
import { rawClient } from "@/lib/db";

/**
 * The job table: work done in the background.
 *
 * Enqueueing is a plain insert, so it can join the caller's own batch or
 * transaction — the job exists if and only if the change that asked for it
 * committed. A dedupe key makes enqueueing the same work twice a no-op.
 * Claiming is one conditional update, so two workers can never run the same
 * job, and a worker that dies mid-job leaves a lock that goes stale and is
 * taken over.
 */

export type JobRow = {
  id: number;
  kind: string;
  payload: unknown;
  attempts: number;
  maxAttempts: number;
  lockToken: string;
};

/** A job left running this long is assumed dead and taken over. */
const STALE_AFTER_MS = 5 * 60_000;

const iso = (d: Date) => d.toISOString();

export function enqueueStatement(
  kind: string,
  payload: unknown = null,
  opts: { dedupeKey?: string; runAfter?: Date; maxAttempts?: number } = {},
): InStatement {
  const now = new Date();
  return {
    sql: `INSERT INTO app_job (kind, payload, dedupe_key, status, attempts, max_attempts, run_after, created_at)
          VALUES (?, ?, ?, 'queued', 0, ?, ?, ?)
          ON CONFLICT (dedupe_key) DO NOTHING`,
    args: [
      kind,
      payload === null ? null : JSON.stringify(payload),
      opts.dedupeKey ?? null,
      opts.maxAttempts ?? 5,
      iso(opts.runAfter ?? now),
      iso(now),
    ],
  };
}

export async function enqueueJob(
  kind: string,
  payload: unknown = null,
  opts: { dedupeKey?: string; runAfter?: Date; maxAttempts?: number } = {},
): Promise<void> {
  await rawClient().execute(enqueueStatement(kind, payload, opts));
}

/** Takes the next due job, or a stale one, for this worker alone. */
export async function claimJob(): Promise<JobRow | null> {
  const now = new Date();
  const token = randomUUID();
  const r = await rawClient().execute({
    sql: `UPDATE app_job
          SET status = 'running', locked_at = ?1, lock_token = ?2, attempts = attempts + 1
          WHERE id = (
            SELECT id FROM app_job
            WHERE (status = 'queued' AND run_after <= ?1)
               OR (status = 'running' AND locked_at < ?3)
            ORDER BY run_after, id
            LIMIT 1
          )
          RETURNING id, kind, payload, attempts, max_attempts`,
    args: [iso(now), token, iso(new Date(now.getTime() - STALE_AFTER_MS))],
  });
  const row = r.rows[0];
  if (!row) return null;
  return {
    id: Number(row.id),
    kind: String(row.kind),
    payload: row.payload === null ? null : JSON.parse(String(row.payload)),
    attempts: Number(row.attempts),
    maxAttempts: Number(row.max_attempts),
    lockToken: token,
  };
}

export async function completeJob(job: JobRow): Promise<void> {
  await rawClient().execute({
    sql: `UPDATE app_job SET status = 'done', finished_at = ?, lock_token = NULL, last_error = NULL
          WHERE id = ? AND lock_token = ?`,
    args: [iso(new Date()), job.id, job.lockToken],
  });
}

/** Puts a job back to continue later, without counting it as a failure. */
export async function continueJob(job: JobRow, delayMs = 0): Promise<void> {
  await rawClient().execute({
    sql: `UPDATE app_job SET status = 'queued', run_after = ?, attempts = attempts - 1,
                             locked_at = NULL, lock_token = NULL
          WHERE id = ? AND lock_token = ?`,
    args: [iso(new Date(Date.now() + delayMs)), job.id, job.lockToken],
  });
}

/** Retries with growing gaps — 30s, 1m, 2m, 4m, up to an hour — then gives up. */
export async function failJob(job: JobRow, error: string): Promise<"retry" | "failed"> {
  const final = job.attempts >= job.maxAttempts;
  const delay = Math.min(60 * 60_000, 30_000 * 2 ** (job.attempts - 1));
  await rawClient().execute({
    sql: `UPDATE app_job SET status = ?, run_after = ?, last_error = ?, locked_at = NULL, lock_token = NULL,
                             finished_at = ?
          WHERE id = ? AND lock_token = ?`,
    args: [
      final ? "failed" : "queued",
      iso(new Date(Date.now() + delay)),
      error.slice(0, 2000),
      final ? iso(new Date()) : null,
      job.id,
      job.lockToken,
    ],
  });
  return final ? "failed" : "retry";
}

export async function hasDueJobs(): Promise<boolean> {
  const r = await rawClient().execute({
    sql: "SELECT 1 FROM app_job WHERE status = 'queued' AND run_after <= ? LIMIT 1",
    args: [iso(new Date())],
  });
  return r.rows.length > 0;
}

/**
 * Queues a keyed job, or puts a finished one with that key back in the
 * queue. A job still queued or running is left alone, so there is never more
 * than one job for the key — a payroll run is worked by one job at a time.
 */
export async function requeueJob(kind: string, payload: unknown, dedupeKey: string): Promise<void> {
  const now = new Date().toISOString();
  await rawClient().execute({
    sql: `INSERT INTO app_job (kind, payload, dedupe_key, status, attempts, max_attempts, run_after, created_at)
          VALUES (?1, ?2, ?3, 'queued', 0, 5, ?4, ?4)
          ON CONFLICT (dedupe_key) DO UPDATE
            SET status = 'queued', attempts = 0, run_after = ?4, last_error = NULL,
                finished_at = NULL, locked_at = NULL, lock_token = NULL, payload = ?2
            WHERE app_job.status IN ('done', 'failed')`,
    args: [kind, payload === null ? null : JSON.stringify(payload), dedupeKey, now],
  });
}
