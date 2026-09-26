import { notFound, redirect } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  pyPayrollResult,
  pyPayrollResultLine,
  pyPayrollRun,
  pyPayrollPeriod,
  omCompany,
} from "@/db/schema";
import { getSession, hasRole } from "@/lib/auth";
import { getEmployee, fullName } from "@/lib/repositories/employees";
import { Card, PageHeader } from "@/components/ui";
import { Payslip } from "@/components/payslip";
import { PrintButton } from "@/components/print-button";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** PY-04 — the remuneration statement, rendered from the stored result lines. */
export default async function PayslipPage(props: {
  params: Promise<{ id: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/sign-in");

  const { id } = await props.params;
  const resultId = Number(id);
  if (!Number.isInteger(resultId)) notFound();

  const result = await db.query.pyPayrollResult.findFirst({
    where: eq(pyPayrollResult.id, resultId),
  });
  if (!result) notFound();

  // An employee may only open their own payslip.
  if (!hasRole(session, "HR_ADMIN") && session.employeeId !== result.employeeId) {
    redirect("/payroll/my-payslips");
  }

  const [lines, run, employee, companies] = await Promise.all([
    db
      .select()
      .from(pyPayrollResultLine)
      .where(eq(pyPayrollResultLine.resultId, resultId))
      .orderBy(asc(pyPayrollResultLine.sortOrder)),
    db.query.pyPayrollRun.findFirst({ where: eq(pyPayrollRun.id, result.runId) }),
    getEmployee(result.employeeId),
    db.select().from(omCompany),
  ]);

  const period = run
    ? await db.query.pyPayrollPeriod.findFirst({
        where: eq(pyPayrollPeriod.id, run.periodId),
      })
    : undefined;

  const company =
    companies.find((c) => c.code === employee?.company_code) ?? companies[0];

  const periodLabel = period
    ? `${MONTHS[period.month - 1]} ${period.year}`
    : "Payroll period";

  return (
    <>
      <PageHeader
        back={
          hasRole(session, "HR_ADMIN")
            ? { href: "/payroll/run", label: "Run payroll" }
            : { href: "/payroll/my-payslips", label: "My payslips" }
        }
        title="Payslip"
        subtitle={`${employee ? fullName(employee) : "Employee"}, ${periodLabel}.`}
        actions={<PrintButton />}
      />

      <Card className="overflow-hidden print:border-0">
        <Payslip
          employer={company?.name ?? "Company"}
          employerAddress={
            company ? [company.address, company.city].filter(Boolean).join(" · ") : undefined
          }
          employeeName={employee ? fullName(employee) : "Employee"}
          employeeNumber={employee?.employee_number ?? "—"}
          position={employee?.position_title ?? undefined}
          period={periodLabel}
          payDate={period?.payDate}
          lines={lines}
          grossPaise={result.grossPaise}
          deductionsPaise={result.deductionsPaise}
          netPaise={result.netPaise}
          unpaidDays={result.unpaidDays}
          workingDays={result.workingDays}
        />
      </Card>
    </>
  );
}
