import { requirePage } from "@/lib/access";
import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { pyPayrollPeriod, pyPayrollRun, omOrgUnit, omLevelType } from "@/db/schema";
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
import { PeriodActions, NewPeriodForm, PeriodEmailToggle } from "./actions";
import { formatDate } from "@/lib/dates";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** PY-01 — the payroll control record. */
export default async function PeriodsPage() {
  await requirePage(["payroll.view"], "/payroll/my-payslips");

  const [periods, groups, runs] = await Promise.all([
    db
      .select()
      .from(pyPayrollPeriod)
      .orderBy(desc(pyPayrollPeriod.year), desc(pyPayrollPeriod.month)),
    db
      .select({ code: omOrgUnit.code, name: omOrgUnit.name })
      .from(omOrgUnit)
      .innerJoin(omLevelType, eq(omLevelType.code, omOrgUnit.levelTypeCode))
      .where(and(eq(omLevelType.isPayrollGroup, true), eq(omOrgUnit.isActive, true)))
      .orderBy(asc(omOrgUnit.code)),
    db.select().from(pyPayrollRun),
  ]);

  const groupName = new Map(groups.map((a) => [a.code, a.name]));
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
          groups={groups.map((a) => ({ value: a.code, label: `${a.code} — ${a.name}` }))}
        />
      </div>

      <div className="mt-6">
        <Card>
          {periods.length === 0 ? (
            <EmptyState icon={<CalendarRange />} title="No payroll periods yet">
              Create a period for a payroll group to begin.
            </EmptyState>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Period</Th>
                  <Th>Payroll group</Th>
                  <Th>Status</Th>
                  <Th>Pay date</Th>
                  <Th numeric>Net total</Th>
                  <Th>Email payslips</Th>
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
                          {groupName.get(p.nodeCode) ?? p.nodeCode}
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
                          <span className="tabular text-secondary">{formatDate(p.payDate)}</span>
                        ) : (
                          <span className="text-decor">&mdash;</span>
                        )}
                      </Td>
                      <Td numeric>
                        {run ? formatINR(run.netTotalPaise) : <span className="text-decor">&mdash;</span>}
                      </Td>
                      <Td>
                        <PeriodEmailToggle id={p.id} on={p.emailPayslips} posted={p.status === "Posted"} />
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
