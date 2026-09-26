import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { after } from "next/server";
import { headers } from "next/headers";
import { rawClient } from "@/lib/db";
import { readEnv } from "@/lib/env";
import { todayInIndia } from "@/lib/dates";
import { HANDLERS, DAILY } from "./handlers";
import {
  claimJob,
  completeJob,
  continueJob,
  enqueueStatement,
  failJob,
  hasDueJobs,
} from "./queue";

/**
 * Running jobs, without any outside service.
 *
 * Work is processed right after the request that queued it (`after()`), for
 * a few seconds at a time so it fits any serverless limit. If work remains,
 * the runner hands off to a fresh invocation of itself through a signed
 * request, and so on until the queue is empty. A daily tick from Vercel Cron
 * catches anything left behind. Nothing depends on a browser staying open.
 */

const BUDGET_MS = 8_000;

/** Queues today's scheduled jobs; a no-op once they are queued. */
async function scheduleDue(): Promise<void> {
  const day = todayInIndia();
  await rawClient().batch(
    DAILY.map((kind) => enqueueStatement(kind, null, { dedupeKey: `schedule:${kind}:${day}` })),
    "write",
  );
}

/** Runs due jobs until the queue is empty or the time is up. */
export async function processJobs(budgetMs = BUDGET_MS): Promise<{ ran: number; more: boolean }> {
  const deadline = Date.now() + budgetMs;
  await scheduleDue();
  let ran = 0;

  while (Date.now() < deadline) {
    const job = await claimJob();
    if (!job) break;
    ran += 1;

    const started = new Date().toISOString();
    const logged = await rawClient().execute({
      sql: "INSERT INTO app_job_run (job_id, kind, started_at) VALUES (?, ?, ?) RETURNING id",
      args: [job.id, job.kind, started],
    });
    const runId = Number(logged.rows[0].id);
    const finish = (outcome: string, detail: string | null = null) =>
      rawClient().execute({
        sql: "UPDATE app_job_run SET finished_at = ?, outcome = ?, detail = ? WHERE id = ?",
        args: [new Date().toISOString(), outcome, detail, runId],
      });

    try {
      const handler = HANDLERS[job.kind];
      if (!handler) throw new Error(`No handler for jobs of kind "${job.kind}".`);
      const result = await handler(job.payload, { jobId: job.id, deadline });
      if (result && result.again) {
        await continueJob(job, result.delayMs ?? 0);
        await finish("continued");
      } else {
        await completeJob(job);
        await finish("ok");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const outcome = await failJob(job, message);
      await finish(outcome, message.slice(0, 1000));
    }
  }

  return { ran, more: await hasDueJobs() };
}

/* ----------------------------------------------------------- hand-off */

function secret(): string {
  return readEnv("AUTH_SECRET") ?? "development-only";
}

/** A short-lived token that lets the runner call itself. */
export function signKick(at = Date.now()): string {
  const ts = String(Math.floor(at / 1000));
  const mac = createHmac("sha256", secret()).update(`jobs.kick:${ts}`).digest("hex");
  return `${ts}.${mac}`;
}

export function verifyKick(token: string | null, at = Date.now()): boolean {
  if (!token) return false;
  const [ts, mac] = token.split(".");
  if (!ts || !mac) return false;
  const age = Math.abs(at / 1000 - Number(ts));
  if (!Number.isFinite(age) || age > 300) return false;
  const expected = createHmac("sha256", secret()).update(`jobs.kick:${ts}`).digest("hex");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function handOff(base: string): Promise<void> {
  try {
    await fetch(`${base}/api/jobs/kick`, {
      method: "POST",
      headers: { authorization: `Bearer ${signKick()}` },
      signal: AbortSignal.timeout(3_000),
    });
  } catch {
    // The daily tick, or the next request that queues work, picks it up.
  }
}

/** The address this request came in on, for handing off to ourselves. */
async function requestBase(): Promise<string | null> {
  try {
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host");
    if (!host) return null;
    const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
    return `${proto}://${host}`;
  } catch {
    return null;
  }
}

/**
 * Processes jobs once the current response has gone, and keeps going in
 * fresh invocations while work remains. Call it after queueing work.
 */
export async function kickJobs(base?: string | null): Promise<void> {
  const origin = base ?? (await requestBase());
  after(async () => {
    try {
      const { more } = await processJobs();
      if (more && origin) await handOff(origin);
    } catch (err) {
      console.error("Background jobs stopped", err);
    }
  });
}
