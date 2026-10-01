import { can, getAccess } from "@/lib/access";
import { logAccess } from "@/lib/access-log";
import { getOutboxMessage } from "@/lib/email";
import { renderAttachment } from "@/lib/email-attachments";

/**
 * An email's attachment, exactly as it is sent — a payslip protected with
 * its employee's password, or a scheduled report. For checking the Outbox;
 * opening someone's payslip also needs the right to see payroll, and a
 * report needs the right to see reports, and either is logged.
 */
export async function GET(_req: Request, ctx: RouteContext<"/api/outbox/[id]/attachments/[n]">) {
  const session = await getAccess();
  if (!session) return new Response("Sign in first.", { status: 401 });

  const { id, n } = await ctx.params;
  const message = await getOutboxMessage(Number(id));
  const spec = message?.attachments[Number(n)];
  if (!message || !spec) return new Response("Not found.", { status: 404 });

  const allowed = can(session, "audit.view") && (spec.type === "payslip" ? can(session, "payroll.view") : can(session, "reports.view"));
  if (!allowed) return new Response("Not allowed.", { status: 403 });

  const file = await renderAttachment(spec);
  if (!file) return new Response("What it describes no longer exists.", { status: 410 });
  logAccess(session, {
    subjectEmployeeId: file.employeeId,
    resource: spec.type === "payslip" ? "emailed payslip" : "emailed report",
    resourceId: spec.type === "payslip" ? spec.resultId : spec.scheduleId,
  });
  return new Response(Buffer.from(file.bytes), {
    headers: {
      "Content-Type": file.contentType,
      "Content-Disposition": `attachment; filename="${spec.fileName}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
