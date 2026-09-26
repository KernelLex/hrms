import { redirect } from "next/navigation";
import { asc, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { pyPayrollPeriod, pyPayrollRun, omPersonnelArea } from "@/db/schema";
import { getSession, hasRole } from "@/lib/auth";
import { formatINR } from "@/lib/money";
import {
  Card,
  PageHeader,
  Table,
  Th,
  Tr,
  Td,
  Status,
  TwoLine,
  EmptyState,
  Notice,
} from "@/components/ui";
import { CalendarRange } from "lucide-react";
import { PayrollTabs } from "../tabs";
import { PeriodActions, NewPeriodForm } from "./actions";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** PY-01 — the payroll control record. */
export default async function PeriodsPage() {
  const session = await getSession();
  if (!hasRole(session, "HR_ADMIN")) redirect("/payroll/my-payslips");

  const [periods, areas, runs] = await Promise.all([
    db
      .select()
      .from(pyPayrollPeriod)
      .orderBy(desc(pyPayrollPeriod.year), desc(pyPayrollPeriod.month)),
    db.select().from(omPersonnelArea).orderBy(asc(omPersonnelArea.code)),
    db.select().from(pyPayrollRun),
  ]);

  const areaName = new Map(areas.map((a) => [a.code, a.name]));
  const runByPeriod = new Map(runs.map((r) => [r.periodId, r]));

  return (
    <>
      <PayrollTabs />
      <PageHeader
        title="Payroll periods"
        subtitle="Open accepts changes, locked allows the run, posted is final. This is what stops someone editing the inputs to a month that has already been paid."
      />

      <Notice>
        A period must be released before payroll can run, and can only be posted
        once a run exists.
      </Notice>

      <div className="mt-6">
        <NewPeriodForm
          areas={areas.map((a) => ({ value: a.code, label: `${a.code} — ${a.name}` }))}
        />
      </div>

      <div className="mt-6">
        <Card>
          {periods.length === 0 ? (
            <EmptyState icon={<CalendarRange />} title="No payroll periods yet">
              Create a period for a personnel area to begin.
            </EmptyState>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Period</Th>
                  <Th>Personnel area</Th>
                  <Th>Status</Th>
                  <Th>Pay date</Th>
                  <Th numeric>Net total</Th>
                  <Th>
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {periods.map((p) => {
                  const run = runByPeriod.get(p.id);
                  return (
                    <Tr key={p.id}>
                      <Td>
                        <TwoLine
                          value={`${MONTHS[p.month - 1]} ${p.year}`}
                          sub={run ? `run by ${run.runBy}` : "not run"}
                        />
                      </Td>
                      <Td>
                        <span className="text-secondary">
                          {areaName.get(p.areaCode) ?? p.areaCode}
                        </span>
                      </Td>
                      <Td>
                        <Status
                          tone={
                            p.status === "Posted"
                              ? "done"
                              : p.status === "Locked"
                                ? "action"
                                : "waiting"
                          }
                        >
                          {p.status}
                        </Status>
                      </Td>
                      <Td>
                        {p.payDate ? (
                          <span className="tabular text-secondary">{p.payDate}</span>
                        ) : (
                          <span className="text-decor">&mdash;</span>
                        )}
                      </Td>
                      <Td numeric>
                        {run ? formatINR(run.netTotalPaise) : <span className="text-decor">&mdash;</span>}
                      </Td>
                      <Td className="text-right whitespace-nowrap">
                        <PeriodActions id={p.id} status={p.status} hasRun={Boolean(run)} />
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
