import Link from "next/link";
import { redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { pyPayrollPeriod, pyPayrollRun, pyPayrollResult } from "@/db/schema";
import { getSession, hasRole } from "@/lib/auth";
import { listEmployees, fullName } from "@/lib/repositories/employees";
import { formatINR } from "@/lib/money";
import {
  Card,
  PageHeader,
  Table,
  Th,
  Tr,
  Td,
  TwoLine,
  Status,
  FigureRow,
  Figure,
  EmptyState,
  Notice,
} from "@/components/ui";
import { Calculator, TriangleAlert } from "lucide-react";
import { PayrollTabs } from "../tabs";
import { RunForm } from "./form";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** PY-03 — run payroll, gross to net. */
export default async function RunPage(props: {
  searchParams: Promise<{ period?: string }>;
}) {
  const session = await getSession();
  if (!hasRole(session, "HR_ADMIN")) redirect("/payroll/my-payslips");

  const params = await props.searchParams;
  const periods = await db
    .select()
    .from(pyPayrollPeriod)
    .orderBy(desc(pyPayrollPeriod.year), desc(pyPayrollPeriod.month));

  const runnable = periods.filter((p) => p.status === "Locked");
  const selectedId = Number(params.period) || runnable[0]?.id || periods[0]?.id;
  const selected = periods.find((p) => p.id === selectedId);

  const run = selected
    ? await db.query.pyPayrollRun.findFirst({
        where: eq(pyPayrollRun.periodId, selected.id),
        orderBy: [desc(pyPayrollRun.runAt)],
      })
    : undefined;

  const results = run
    ? await db
        .select()
        .from(pyPayrollResult)
        .where(eq(pyPayrollResult.runId, run.id))
        .orderBy(desc(pyPayrollResult.netPaise))
    : [];

  const employees = await listEmployees();
  const name = new Map(employees.map((e) => [e.id, fullName(e)]));
  const numberOf = new Map(employees.map((e) => [e.id, e.employee_number]));

  const errors = results.filter((r) => r.status === "Error");

  return (
    <>
      <PayrollTabs />
      <PageHeader
        title="Run payroll"
        subtitle="Reads basic pay valid in the period, prorates it for unpaid absence, adds allowances and payments, then deducts provident fund and tax."
      />

      <RunForm
        periods={periods.map((p) => ({
          value: String(p.id),
          label: `${MONTHS[p.month - 1]} ${p.year} — ${p.areaCode} (${p.status.toLowerCase()})`,
          runnable: p.status === "Locked",
        }))}
        selectedId={selectedId ? String(selectedId) : ""}
      />

      {selected && selected.status === "Open" ? (
        <div className="mt-6">
          <Notice>
            {MONTHS[selected.month - 1]} {selected.year} is still open. Release it
            on the periods tab before running payroll.
          </Notice>
        </div>
      ) : null}

      {run ? (
        <>
          <div className="mt-6">
            <FigureRow>
              <Figure label="Employees" value={run.employeeCount} hint="in this run" />
              <Figure label="Gross" value={formatINR(run.grossTotalPaise)} hint="before deductions" />
              <Figure label="Net" value={formatINR(run.netTotalPaise)} hint="payable" />
              <Figure
                label="Errors"
                value={run.errorCount}
                hint={run.errorCount === 0 ? "none" : "could not be paid"}
                problem={run.errorCount > 0}
              />
            </FigureRow>
          </div>

          {errors.length > 0 ? (
            <div className="mt-6">
              <Notice problem icon={<TriangleAlert />}>
                {errors.length} employee{errors.length === 1 ? "" : "s"} could not be
                paid. Fix the records named below and run again.
              </Notice>
            </div>
          ) : null}

          <div className="mt-6">
            <Card>
              <Table>
                <thead>
                  <tr>
                    <Th>Employee</Th>
                    <Th numeric>Gross</Th>
                    <Th numeric>Deductions</Th>
                    <Th numeric>Net</Th>
                    <Th>Unpaid days</Th>
                    <Th>Status</Th>
                    <Th>
                      <span className="sr-only">Payslip</span>
                    </Th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((r) => (
                    <Tr key={r.id}>
                      <Td>
                        <TwoLine
                          value={name.get(r.employeeId) ?? "—"}
                          sub={numberOf.get(r.employeeId)}
                        />
                      </Td>
                      <Td numeric>
                        {r.status === "Error" ? (
                          <span className="text-decor">&mdash;</span>
                        ) : (
                          formatINR(r.grossPaise)
                        )}
                      </Td>
                      <Td numeric>
                        {r.status === "Error" ? (
                          <span className="text-decor">&mdash;</span>
                        ) : (
                          formatINR(r.deductionsPaise)
                        )}
                      </Td>
                      <Td numeric>
                        {r.status === "Error" ? (
                          <span className="text-decor">&mdash;</span>
                        ) : (
                          <span className="font-medium text-ink">{formatINR(r.netPaise)}</span>
                        )}
                      </Td>
                      <Td>
                        {r.unpaidDays > 0 ? (
                          <span className="tabular text-secondary">
                            {r.unpaidDays} of {r.workingDays}
                          </span>
                        ) : (
                          <span className="text-decor">&mdash;</span>
                        )}
                      </Td>
                      <Td>
                        {r.status === "Error" ? (
                          <Status tone="problem">{r.errorMessage ?? "Error"}</Status>
                        ) : (
                          <Status tone="done">Calculated</Status>
                        )}
                      </Td>
                      <Td className="text-right">
                        {r.status === "Calculated" ? (
                          <Link
                            href={`/payroll/payslip/${r.id}`}
                            className="text-[13px] font-medium text-ink hover:underline"
                          >
                            Payslip
                          </Link>
                        ) : null}
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          </div>
        </>
      ) : (
        <div className="mt-6">
          <Card>
            <EmptyState icon={<Calculator />} title="This period has not been run">
              Release the period, then run payroll to produce results and payslips.
            </EmptyState>
          </Card>
        </div>
      )}
    </>
  );
}
