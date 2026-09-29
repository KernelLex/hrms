import { rawClient } from "@/lib/db";
import { can, getAccess, inScope } from "@/lib/access";
import { logAccess } from "@/lib/access-log";
import { renderIssuedLetter } from "@/lib/services/letters";

/**
 * A letter as a PDF download, re-rendered from its stored merged text each
 * time. HR (or anyone whose scope covers the employee) may open any letter;
 * an employee may open their own.
 */
export async function GET(_req: Request, ctx: RouteContext<"/api/letters/[id]/pdf">) {
  const session = await getAccess();
  if (!session) return new Response("Sign in first.", { status: 401 });

  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) return new Response("Not found.", { status: 404 });
  const row = (await rawClient().execute({ sql: "SELECT * FROM pa_letter WHERE id = ?", args: [id] })).rows[0];
  if (!row) return new Response("Not found.", { status: 404 });
  const employeeId = Number(row.employee_id);

  const mine = session.employeeId === employeeId;
  const mayRead = mine || (can(session, "employee.view_all") && (await inScope(session, employeeId)));
  if (!mayRead) return new Response("Not found.", { status: 404 });

  logAccess(session, { subjectEmployeeId: employeeId, resource: "letter PDF", resourceId: id });
  const pdf = await renderIssuedLetter({
    employeeId,
    kind: String(row.kind),
    issueDate: String(row.issue_date),
    mergedText: String(row.merged_text),
  });
  const fileName = `${String(row.kind).toLowerCase().replace(/\s+/g, "-")}-letter-${id}.pdf`;
  return new Response(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${fileName}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
