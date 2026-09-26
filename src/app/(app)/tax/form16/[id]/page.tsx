import { notFound, redirect } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { tdsForm16, tdsDeductionRegister } from "@/db/schema";
import { getSession, hasRole } from "@/lib/auth";
import { logAccess } from "@/lib/access-log";
import { getEmployee, fullName } from "@/lib/repositories/employees";
import { Card, PageHeader } from "@/components/ui";
import { Form16 } from "@/components/form16";
import { PrintButton } from "@/components/print-button";

/** The certificate itself, Parts A and B on one page. */
export default async function Form16CertificatePage(props: {
  params: Promise<{ id: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/sign-in");

  const { id } = await props.params;
  const certificateId = Number(id);
  if (!Number.isInteger(certificateId)) notFound();

  const certificate = await db.query.tdsForm16.findFirst({
    where: eq(tdsForm16.id, certificateId),
  });
  if (!certificate) notFound();

  // An employee may only open their own certificate.
  if (!hasRole(session, "HR_ADMIN") && session.employeeId !== certificate.employeeId) {
    redirect("/tax/form16");
  }

  logAccess(session, {
    subjectEmployeeId: certificate.employeeId,
    resource: "Form 16",
    resourceId: certificate.financialYear,
  });

  const [quarters, employee] = await Promise.all([
    db
      .select()
      .from(tdsDeductionRegister)
      .where(
        and(
          eq(tdsDeductionRegister.employeeId, certificate.employeeId),
          eq(tdsDeductionRegister.financialYear, certificate.financialYear),
        ),
      )
      .orderBy(asc(tdsDeductionRegister.quarter)),
    getEmployee(certificate.employeeId),
  ]);

  return (
    <>
      <PageHeader
        back={{ href: "/tax/form16", label: "Form 16" }}
        title="Form 16"
        subtitle={`${employee ? fullName(employee) : "Employee"}, financial year ${certificate.financialYear}.`}
        actions={<PrintButton label="Print or save as PDF" />}
        screenOnly
      />

      <Card className="overflow-hidden print:rounded-none print:border-0">
        <Form16
          data={{
            certificateNo: certificate.certificateNo,
            financialYear: certificate.financialYear,
            regime: certificate.regime,
            employerName: certificate.employerName,
            employerTan: certificate.employerTan,
            employerPan: certificate.employerPan,
            employeeName: employee ? fullName(employee) : "Employee",
            employeeNumber: employee?.employee_number ?? "—",
            employeePan: certificate.employeePan,
            grossSalaryPaise: certificate.grossSalaryPaise,
            section10ExemptPaise: certificate.section10ExemptPaise,
            standardDeductionPaise: certificate.standardDeductionPaise,
            chapterViaPaise: certificate.chapterViaPaise,
            taxableIncomePaise: certificate.taxableIncomePaise,
            taxOnIncomePaise: certificate.taxOnIncomePaise,
            rebate87aPaise: certificate.rebate87aPaise,
            cessPaise: certificate.cessPaise,
            totalTaxPaise: certificate.totalTaxPaise,
            tdsDeductedPaise: certificate.tdsDeductedPaise,
            balancePaise: certificate.balancePaise,
            generatedAt: certificate.generatedAt,
          }}
          quarters={quarters.map((q) => ({
            quarter: q.quarter,
            grossPaidPaise: q.grossPaidPaise,
            tdsDeductedPaise: q.tdsDeductedPaise,
            challanBsr: q.challanBsr,
            depositDate: q.depositDate,
            receipt24q: q.receipt24q,
          }))}
        />
      </Card>
    </>
  );
}
