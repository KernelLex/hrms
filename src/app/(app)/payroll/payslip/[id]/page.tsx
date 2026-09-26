import { notFound, redirect } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  pyPayrollResult,
  pyPayrollResultLine,
  pyPayrollRun,
  pyPayrollPeriod,
  paEmployee,
  omCompany,
} from "@/db/schema";
import { getSession, hasRole } from "@/lib/auth";
import { getEmployee, fullName } from "@/lib/repositories/employees";
import { logAccess } from "@/lib/access-log";
import { formatMonth } from "@/lib/dates";
import { periodEnd, periodStart } from "@/lib/engines/payroll";
import { Card, PageHeader } from "@/components/ui";
import { Payslip } from "@/components/payslip";
import { PrintButton } from "@/components/print-button";

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

  logAccess(session, {
    subjectEmployeeId: result.employeeId,
    resource: "payslip",
    resourceId: result.id,
  });

  const [lines, run, employee, companies, person] = await Promise.all([
    db
      .select()
      .from(pyPayrollResultLine)
      .where(eq(pyPayrollResultLine.resultId, resultId))
      .orderBy(asc(pyPayrollResultLine.sortOrder)),
    db.query.pyPayrollRun.findFirst({ where: eq(pyPayrollRun.id, result.runId) }),
    getEmployee(result.employeeId),
    db.select().from(omCompany),
    db.query.paEmployee.findFirst({ where: eq(paEmployee.id, result.employeeId) }),
  ]);

  const period = run
    ? await db.query.pyPayrollPeriod.findFirst({
        where: eq(pyPayrollPeriod.id, run.periodId),
      })
    : undefined;

  const company =
    companies.find((c) => c.code === employee?.company_code) ?? companies[0];

  const periodLabel = period ? formatMonth(period.year, period.month) : "Payroll period";
  const from = period ? periodStart(period.year, period.month) : "";
  const to = period ? periodEnd(period.year, period.month) : "";
  const joinedOn =
    person && person.hireDate >= from && person.hireDate <= to ? person.hireDate : null;
  const leftOn =
    person?.terminationDate && person.terminationDate >= from && person.terminationDate <= to
      ? person.terminationDate
      : null;
  const offCycleReason = run?.runType === "Off-cycle" ? (run.reason ?? "Off-cycle payment") : null;

  return (
    <>
      <PageHeader
        back={
          hasRole(session, "HR_ADMIN")
            ? { href: "/payroll/run", label: "Run payroll" }
            : { href: "/payroll/my-payslips", label: "My payslips" }
        }
        title={offCycleReason ? "Off-cycle payslip" : "Payslip"}
        subtitle={`${employee ? fullName(employee) : "Employee"}, ${periodLabel}.`}
        actions={<PrintButton label="Print or save as PDF" />}
        screenOnly
      />

      <Card className="overflow-hidden print:rounded-none print:border-0">
        <Payslip
          employer={company?.name ?? "Company"}
          employerAddress={
            company ? [company.address, company.city].filter(Boolean).join(" · ") : undefined
          }
          employeeName={employee ? fullName(employee) : "Employee"}
          employeeNumber={employee?.employee_number ?? "—"}
          position={employee?.position_title ?? undefined}
          period={periodLabel}
          payDate={run?.payDate ?? period?.payDate}
          lines={lines}
          grossPaise={result.grossPaise}
          deductionsPaise={result.deductionsPaise}
          netPaise={result.netPaise}
          unpaidDays={result.unpaidDays}
          workingDays={result.workingDays}
          employedDays={result.employedDays}
          joinedOn={joinedOn}
          leftOn={leftOn}
          offCycleReason={offCycleReason}
        />
      </Card>
    </>
  );
}
