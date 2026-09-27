import { can, getAccess } from "@/lib/access";
import { logAccess } from "@/lib/access-log";
import { getPayslip } from "@/lib/repositories/payslips";
import { payslipFileName, renderPayslipPdf } from "@/lib/documents/payslip-pdf";

/**
 * A payslip as a PDF download, made from its stored lines each time. The
 * same people who may open the payslip page may download it: whoever can
 * see payroll, and the employee once it is published. Downloaded while
 * signed in it is not password-protected; an emailed copy is.
 */
export async function GET(_req: Request, ctx: RouteContext<"/api/payroll/payslip/[id]/pdf">) {
  const session = await getAccess();
  if (!session) return new Response("Sign in first.", { status: 401 });

  const resultId = Number((await ctx.params).id);
  if (!Number.isInteger(resultId)) return new Response("Not found.", { status: 404 });
  const p = await getPayslip(resultId);
  const mayRead =
    p && (can(session, "payroll.view") || (can(session, "self.pay") && session.employeeId === p.employeeId && p.published));
  if (!p || !mayRead) return new Response("Not found.", { status: 404 });

  logAccess(session, { subjectEmployeeId: p.employeeId, resource: "payslip PDF", resourceId: p.resultId });
  const pdf = await renderPayslipPdf(p);
  return new Response(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${payslipFileName(p)}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
