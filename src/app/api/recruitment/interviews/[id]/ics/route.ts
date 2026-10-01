import { can, getAccess } from "@/lib/access";
import { getInterview } from "@/lib/repositories/recruitment";
import { buildInterviewIcs } from "@/lib/recruitment";

/**
 * The round as a calendar file, for whoever can already see it: the
 * interviewer assigned to it, or anyone who runs recruitment.
 */
export async function GET(_req: Request, ctx: RouteContext<"/api/recruitment/interviews/[id]/ics">) {
  const session = await getAccess();
  if (!session) return new Response("Sign in first.", { status: 401 });

  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) return new Response("Not found.", { status: 404 });
  const i = await getInterview(id);
  const manages = can(session, "recruitment.manage");
  const own = Boolean(i && session.employeeId !== null && i.interviewerEmployeeId === session.employeeId);
  if (!i || (!own && !manages)) return new Response("Not found.", { status: 404 });

  const ics = buildInterviewIcs(
    { id: i.id, round: i.round, scheduledDate: i.scheduledDate, scheduledTime: i.scheduledTime, durationMinutes: i.durationMinutes, location: i.location, createdAt: new Date().toISOString() },
    i.roleTitle,
    i.candidateName,
  );
  if (!ics) return new Response("This round has no time set yet.", { status: 404 });

  return new Response(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="interview-${id}.ics"`,
      "Cache-Control": "private, no-store",
    },
  });
}
