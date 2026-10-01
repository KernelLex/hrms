import { notFound, redirect } from "next/navigation";
import { can, requirePage } from "@/lib/access";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { tdsForm16, tdsDeductionRegister, tdsPerquisite, tdsArrearsRelief } from "@/db/schema";
import { logAccess } from "@/lib/access-log";
import { getEmployee, fullName } from "@/lib/repositories/employees";
import { formatINR } from "@/lib/money";
import { Card, CardHeader, PageHeader, Table, Th, Tr, Td, EmptyState } from "@/components/ui";
import { Form16 } from "@/components/form16";
import { PrintButton } from "@/components/print-button";
import { Generate12BA } from "../generate-12ba";
import { ArrearsReliefForm } from "../arrears-relief";
import { Gift } from "lucide-react";

/** The certificate itself, Parts A and B on one page. */
export default async function Form16CertificatePage(props: {
  params: Promise<{ id: string }>;
}) {
  const session = await requirePage(["self.tax", "tax.manage"]);

  const { id } = await props.params;
  const certificateId = Number(id);
  if (!Number.isInteger(certificateId)) notFound();

  const certificate = await db.query.tdsForm16.findFirst({
    where: eq(tdsForm16.id, certificateId),
  });
  if (!certificate) notFound();

  // Without the right to keep everyone's tax, only your own certificate.
  if (!can(session, "tax.manage") && session.employeeId !== certificate.employeeId) {
    redirect("/tax/form16");
  }

  logAccess(session, {
    subjectEmployeeId: certificate.employeeId,
    resource: "Form 16",
    resourceId: certificate.financialYear,
  });

  const [quarters, employee, perquisites] = await Promise.all([
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
    db
      .select()
      .from(tdsPerquisite)
      .where(and(eq(tdsPerquisite.employeeId, certificate.employeeId), eq(tdsPerquisite.financialYear, certificate.financialYear))),
  ]);
  const reliefs = can(session, "tax.manage")
    ? await db.select().from(tdsArrearsRelief).where(and(eq(tdsArrearsRelief.employeeId, certificate.employeeId), eq(tdsArrearsRelief.financialYear, certificate.financialYear)))
    : [];

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

      <div className="mt-6 print:hidden">
        <Card>
          <CardHeader
            title="Form 12BA — perquisites"
            description="Loans are the only source computed today."
            actions={can(session, "tax.manage") ? <Generate12BA employeeId={certificate.employeeId} financialYear={certificate.financialYear} /> : undefined}
          />
          {perquisites.length === 0 ? (
            <EmptyState icon={<Gift />} title="No perquisite value for this year" />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Type</Th>
                  <Th numeric>Value</Th>
                </tr>
              </thead>
              <tbody>
                {perquisites.map((p) => (
                  <Tr key={p.id}>
                    <Td>{p.perquisiteType}</Td>
                    <Td numeric>{formatINR(p.amountPaise)}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>

      {can(session, "tax.manage") ? (
        <div className="mt-6 print:hidden">
          <Card>
            <CardHeader title="Section 89 relief — Form 10E" description="For arrears this year's figures include, that relate to an earlier one already issued its own Form 16." />
            <div className="px-6 pb-5">
              <ArrearsReliefForm employeeId={certificate.employeeId} financialYear={certificate.financialYear} />
              {reliefs.length > 0 ? (
                <Table>
                  <thead>
                    <tr>
                      <Th>Relates to</Th>
                      <Th numeric>Arrears</Th>
                      <Th numeric>Relief</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {reliefs.map((r) => (
                      <Tr key={r.id}>
                        <Td>{r.relatesToYear}</Td>
                        <Td numeric>{formatINR(r.arrearsPaise)}</Td>
                        <Td numeric>{formatINR(r.reliefPaise)}</Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              ) : null}
            </div>
          </Card>
        </div>
      ) : null}
    </>
  );
}
