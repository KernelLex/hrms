import { readEnv } from "@/lib/env";
import { kickJobs } from "@/lib/jobs/runner";

/**
 * The daily tick (vercel.json). Queues the day's scheduled jobs and works
 * through anything left behind.
 *
 * Vercel Cron sends `Authorization: Bearer $CRON_SECRET` when CRON_SECRET is
 * set, and then nothing else is accepted. Without it the tick is open, which
 * is harmless — it only runs work that is already queued — but setting it is
 * on the phase 25 list.
 */
export async function GET(req: Request) {
  const expected = readEnv("CRON_SECRET");
  if (expected && req.headers.get("authorization") !== `Bearer ${expected}`) {
    return new Response("Not allowed.", { status: 401 });
  }
  await kickJobs(new URL(req.url).origin);
  return Response.json({ ok: true });
}
