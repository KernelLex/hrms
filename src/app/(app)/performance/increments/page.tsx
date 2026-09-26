import Link from "next/link";
import { requirePage } from "@/lib/access";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  pmIncrementRecommendation,
  pmAppraisalCycle,
  RATING_LABELS,
} from "@/db/schema";
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
import { TrendingUp } from "lucide-react";
import { PerformanceTabs } from "../tabs";
import { GenerateIncrementsForm, IncrementActions, PushAllButton } from "./actions";
import { formatDate } from "@/lib/dates";

/** PM-05 — increment recommendations, and the push into basic pay. */
export default async function IncrementsPage(props: {
  searchParams: Promise<{ cycle?: string }>;
}) {
  await requirePage(["performance.manage"], "/performance");

  const params = await props.searchParams;

  const cycles = await db
    .select()
    .from(pmAppraisalCycle)
    .orderBy(desc(pmAppraisalCycle.startDate));

  const cycleId = Number(params.cycle) || cycles[0]?.id;

  const rows = cycleId
    ? await db
        .select()
        .from(pmIncrementRecommendation)
        .where(eq(pmIncrementRecommendation.cycleId, cycleId))
        .orderBy(desc(pmIncrementRecommendation.finalRating))
    : [];

  const employees = await listEmployees();
  const name = new Map(employees.map((e) => [e.id, fullName(e)]));
  const numberOf = new Map(employees.map((e) => [e.id, e.employee_number]));

  const drafts = rows.filter((r) => r.status === "Draft");
  const approved = rows.filter((r) => r.status === "Approved");
  const pushed = rows.filter((r) => r.status === "Pushed");
  const totalIncrease = rows.reduce(
    (s, r) => s + (r.newSalaryPaise - r.currentSalaryPaise),
    0,
  );

  return (
    <>
      <PerformanceTabs />
      <PageHeader
        title="Increments"
        subtitle="A finalised rating becomes a salary. Pushing writes a new basic-pay record with an effective date, so the old figure is delimited rather than overwritten and the next payroll run picks the new one up."
      />

      <GenerateIncrementsForm
        cycles={cycles.map((c) => ({ value: String(c.id), label: c.name }))}
        selectedCycle={cycleId ? String(cycleId) : ""}
      />

      {rows.length > 0 ? (
        <div className="mt-6">
          <FigureRow>
            <Figure label="Draft" value={drafts.length} hint="not yet approved" />
            <Figure label="Approved" value={approved.length} hint="ready to push" />
            <Figure label="Pushed" value={pushed.length} hint="written to basic pay" />
            <Figure
              label="Annual cost"
              value={formatINR(totalIncrease * 12)}
              hint="increase across the cycle"
            />
          </FigureRow>
        </div>
      ) : null}

      {approved.length > 0 ? (
        <div className="mt-6 flex items-center justify-between gap-4 rounded-2xl bg-soft px-4 py-3.5">
          <p className="text-sm text-ink-hover">
            {approved.length} approved increment{approved.length === 1 ? "" : "s"} can
            be written to basic pay.
          </p>
          <PushAllButton cycleId={cycleId!} />
        </div>
      ) : null}

      <div className="mt-6">
        <Card>
          {rows.length === 0 ? (
            <EmptyState icon={<TrendingUp />} title="No recommendations yet">
              Generate them above once appraisals in this cycle have been
              finalised in calibration.
            </EmptyState>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Employee</Th>
                  <Th>Rating</Th>
                  <Th numeric>Current</Th>
                  <Th numeric>Increment</Th>
                  <Th numeric>New salary</Th>
                  <Th>Effective</Th>
                  <Th>Status</Th>
                  <Th>
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <Tr key={r.id}>
                    <Td>
                      <Link href={`/core-hr/${r.employeeId}/0008`} className="hover:underline">
                        <TwoLine
                          value={name.get(r.employeeId) ?? "—"}
                          sub={numberOf.get(r.employeeId)}
                        />
                      </Link>
                    </Td>
                    <Td>
                      <TwoLine
                        value={`${r.finalRating} of 5`}
                        sub={RATING_LABELS[r.finalRating]}
                      />
                    </Td>
                    <Td numeric>{formatINR(r.currentSalaryPaise)}</Td>
                    <Td numeric>
                      <span className="tabular">
                        {(r.incrementBasisPoints / 100).toFixed(1)}%
                      </span>
                    </Td>
                    <Td numeric>
                      <span className="font-medium text-ink">
                        {formatINR(r.newSalaryPaise)}
                      </span>
                    </Td>
                    <Td>
                      <span className="tabular text-secondary">{formatDate(r.effectiveDate)}</span>
                    </Td>
                    <Td>
                      <Status
                        tone={
                          r.status === "Pushed"
                            ? "done"
                            : r.status === "Approved"
                              ? "action"
                              : "waiting"
                        }
                      >
                        {r.status}
                      </Status>
                    </Td>
                    <Td className="text-right whitespace-nowrap">
                      <IncrementActions
                        id={r.id}
                        status={r.status}
                        employeeName={name.get(r.employeeId) ?? "this employee"}
                        currentPercent={(r.incrementBasisPoints / 100).toFixed(1)}
                        effectiveDate={r.effectiveDate}
                      />
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>

      {pushed.length > 0 ? (
        <div className="mt-6">
          <Notice>
            Pushed increments appear as a new basic-pay record on the employee,
            valid from the effective date. Open one to see the old figure
            delimited rather than replaced.
          </Notice>
        </div>
      ) : null}
    </>
  );
}
