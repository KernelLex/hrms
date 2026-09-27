import { Download } from "lucide-react";
import { notFound, redirect } from "next/navigation";
import { can, requirePage } from "@/lib/access";
import { getPayslip } from "@/lib/repositories/payslips";
import { logAccess } from "@/lib/access-log";
import { ButtonAnchor, Card, PageHeader } from "@/components/ui";
import { Payslip } from "@/components/payslip";
import { PrintButton } from "@/components/print-button";
import { ResendPayslip } from "./resend";

/**
 * PY-04 — the remuneration statement, rendered from the stored result lines,
 * with the year to date, and the same payslip as a PDF.
 */
export default async function PayslipPage(props: { params: Promise<{ id: string }> }) {
  const session = await requirePage(["self.pay", "payroll.view"]);

  const resultId = Number((await props.params).id);
  if (!Number.isInteger(resultId)) notFound();
  const p = await getPayslip(resultId);
  if (!p) notFound();

  // Without the right to see payroll: only your own, and only once it is published.
  if (!can(session, "payroll.view") && (session.employeeId !== p.employeeId || !p.published)) {
    redirect("/payroll/my-payslips");
  }

  logAccess(session, { subjectEmployeeId: p.employeeId, resource: "payslip", resourceId: p.resultId });

  return (
    <>
      <PageHeader
        back={
          can(session, "payroll.view")
            ? { href: "/payroll/run", label: "Run payroll" }
            : { href: "/payroll/my-payslips", label: "My payslips" }
        }
        title={p.offCycleReason ? "Off-cycle payslip" : "Payslip"}
        subtitle={`${p.employeeName}, ${p.periodLabel}.`}
        actions={
          <>
            {can(session, "payroll.post") && p.published ? <ResendPayslip resultId={p.resultId} /> : null}
            <ButtonAnchor href={`/api/payroll/payslip/${p.resultId}/pdf`} download>
              <Download />
              Download PDF
            </ButtonAnchor>
            <PrintButton label="Print" />
          </>
        }
        screenOnly
      />

      <Card className="overflow-hidden print:rounded-none print:border-0">
        <Payslip p={p} />
      </Card>
    </>
  );
}
