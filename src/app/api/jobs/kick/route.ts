import { verifyKick, kickJobs } from "@/lib/jobs/runner";

/**
 * The runner calling itself to keep going: signed with a short-lived token
 * only this deployment can make. Answers at once and works after.
 */
export async function POST(req: Request) {
  const token = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? null;
  if (!verifyKick(token)) return new Response("Not allowed.", { status: 401 });
  await kickJobs(new URL(req.url).origin);
  return new Response(null, { status: 202 });
}
