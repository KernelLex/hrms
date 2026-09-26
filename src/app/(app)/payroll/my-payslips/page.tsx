import Link from "next/link";
import { redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { pyPayrollResult, pyPayrollRun, pyPayrollPeriod } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { formatINR } from "@/lib/money";
import {
  Card,
  PageHeader,
  Table,
  Th,
  Tr,
  Td,
  EmptyState,
  Notice,
  FigureRow,
  Figure,
} from "@/components/ui";
import { FileText } from "lucide-react";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Employee self-service: your own payslips. */
export default async function MyPayslipsPage() {
  const session = await getSession();
  if (!session) redirect("/sign-in");

  if (!session.employeeId) {
    return (
      <>
        <PageHeader title="My payslips" subtitle="Your monthly remuneration statements." />
        <Notice>
          This sign-in is not linked to an employee record, so there are no
          payslips to show.
        </Notice>
      </>
    );
  }

  const rows = await db
    .select({
      id: pyPayrollResult.id,
      grossPaise: pyPayrollResult.grossPaise,
      deductionsPaise: pyPayrollResult.deductionsPaise,
      netPaise: pyPayrollResult.netPaise,
      status: pyPayrollResult.status,
      year: pyPayrollPeriod.year,
      month: pyPayrollPeriod.month,
      payDate: pyPayrollPeriod.payDate,
      periodStatus: pyPayrollPeriod.status,
    })
    .from(pyPayrollResult)
    .innerJoin(pyPayrollRun, eq(pyPayrollRun.id, pyPayrollResult.runId))
    .innerJoin(pyPayrollPeriod, eq(pyPayrollPeriod.id, pyPayrollRun.periodId))
    .where(eq(pyPayrollResult.employeeId, session.employeeId))
    .orderBy(desc(pyPayrollPeriod.year), desc(pyPayrollPeriod.month));

  // Only show what has actually been paid, not a run still being corrected.
  const visible = rows.filter((r) => r.status === "Calculated" && r.periodStatus === "Posted");
  const latest = visible[0];
  const ytdNet = visible.reduce((s, r) => s + r.netPaise, 0);

  return (
    <>
      <PageHeader
        title="My payslips"
        subtitle="Payslips appear once the period has been posted."
      />

      {visible.length > 0 ? (
        <FigureRow>
          <Figure
            label="Latest net pay"
            value={formatINR(latest.netPaise)}
            hint={`${MONTHS[latest.month - 1]} ${latest.year}`}
          />
          <Figure label="Latest gross" value={formatINR(latest.grossPaise)} hint="before deductions" />
          <Figure label="Latest deductions" value={formatINR(latest.deductionsPaise)} hint="tax and provident fund" />
          <Figure label="Paid to date" value={formatINR(ytdNet)} hint={`${visible.length} payslips`} />
        </FigureRow>
      ) : null}

      <div className={visible.length > 0 ? "mt-6" : ""}>
        <Card>
          {visible.length === 0 ? (
            <EmptyState icon={<FileText />} title="No payslips yet">
              Your payslip appears here once payroll has run and the period is
              posted.
            </EmptyState>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Period</Th>
                  <Th>Pay date</Th>
                  <Th numeric>Gross</Th>
                  <Th numeric>Deductions</Th>
                  <Th numeric>Net</Th>
                  <Th>
                    <span className="sr-only">Open</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => (
                  <Tr key={r.id}>
                    <Td>
                      <span className="font-medium text-ink">
                        {MONTHS[r.month - 1]} {r.year}
                      </span>
                    </Td>
                    <Td>
                      {r.payDate ? (
                        <span className="tabular text-secondary">{r.payDate}</span>
                      ) : (
                        <span className="text-decor">&mdash;</span>
                      )}
                    </Td>
                    <Td numeric>{formatINR(r.grossPaise)}</Td>
                    <Td numeric>{formatINR(r.deductionsPaise)}</Td>
                    <Td numeric>
                      <span className="font-medium text-ink">{formatINR(r.netPaise)}</span>
                    </Td>
                    <Td className="text-right">
                      <Link
                        href={`/payroll/payslip/${r.id}`}
                        className="text-[13px] font-medium text-ink hover:underline"
                      >
                        Open
                      </Link>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
