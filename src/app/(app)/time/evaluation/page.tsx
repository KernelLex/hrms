import { requirePage } from "@/lib/access";
import { desc, eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { ptTimeEvaluation } from "@/db/schema";
import { listEmployees, fullName } from "@/lib/repositories/employees";
import {
  Card,
  PageHeader,
  Table,
  Th,
  Tr,
  Td,
  TwoLine,
  EmptyState,
  Notice,
} from "@/components/ui";
import { Gauge } from "lucide-react";
import { TimeTabs } from "../tabs";
import { RunEvaluationForm } from "./form";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** TM-04 — time evaluation, equivalent to SAP's PT60. */
export default async function EvaluationPage(props: {
  searchParams: Promise<{ year?: string; month?: string }>;
}) {
  await requirePage(["time.manage"], "/time/my-leave");

  const params = await props.searchParams;
  const nowDate = new Date();
  const year = Number(params.year) || nowDate.getUTCFullYear();
  const month = Number(params.month) || nowDate.getUTCMonth() + 1;

  const [rows, employees] = await Promise.all([
    db
      .select()
      .from(ptTimeEvaluation)
      .where(
        and(
          eq(ptTimeEvaluation.periodYear, year),
          eq(ptTimeEvaluation.periodMonth, month),
        ),
      )
      .orderBy(desc(ptTimeEvaluation.unpaidDays)),
    listEmployees(),
  ]);

  const name = new Map(employees.map((e) => [e.id, fullName(e)]));
  const numberOf = new Map(employees.map((e) => [e.id, e.employee_number]));
  const anyUnpaid = rows.some((r) => r.unpaidDays > 0);

  return (
    <>
      <TimeTabs />
      <PageHeader
        title="Time evaluation"
        subtitle="Turns absence and attendance records into the per-period totals payroll reads. Unpaid days are what reduce pay."
      />

      <RunEvaluationForm year={year} month={month} />

      {anyUnpaid ? (
        <div className="mt-6">
          <Notice>
            Some employees have unpaid days this period. Payroll will prorate
            their basic pay against the working days in the period.
          </Notice>
        </div>
      ) : null}

      <div className="mt-6">
        <Card>
          {rows.length === 0 ? (
            <EmptyState
              icon={<Gauge />}
              title={`${MONTHS[month - 1]} ${year} has not been evaluated`}
            >
              Run the evaluation above to produce the time statement for this period.
            </EmptyState>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Employee</Th>
                  <Th numeric>Working days</Th>
                  <Th numeric>Present</Th>
                  <Th numeric>Absent</Th>
                  <Th numeric>Unpaid</Th>
                  <Th numeric>Overtime hours</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <Tr key={r.id}>
                    <Td>
                      <TwoLine
                        value={name.get(r.employeeId) ?? "—"}
                        sub={numberOf.get(r.employeeId)}
                      />
                    </Td>
                    <Td numeric>{r.workingDays}</Td>
                    <Td numeric>{r.presentDays}</Td>
                    <Td numeric>{r.absentDays}</Td>
                    <Td numeric>
                      {/* Unpaid days cost the employee money — the one place
                          red is earned on this screen. */}
                      {r.unpaidDays > 0 ? (
                        <span className="font-medium text-danger">{r.unpaidDays}</span>
                      ) : (
                        <span className="text-decor">&mdash;</span>
                      )}
                    </Td>
                    <Td numeric>
                      {r.overtimeHours > 0 ? r.overtimeHours : <span className="text-decor">&mdash;</span>}
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
