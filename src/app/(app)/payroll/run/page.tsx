import Link from "next/link";
import { requirePage } from "@/lib/access";
import { asc, desc, eq } from "drizzle-orm";
import { db, rawClient } from "@/lib/db";
import { pyPayrollPeriod, pyPayrollRun } from "@/db/schema";
import { formatINR } from "@/lib/money";
import { formatDate, formatMonth, todayInIndia } from "@/lib/dates";
import { periodEnd } from "@/lib/engines/payroll";
import {
  Card,
  CardHeader,
  ButtonAnchor,
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
  Tabs,
  Tab,
} from "@/components/ui";
import { Pagination, pageFrom } from "@/components/pagination";
import { varianceFor, VARIANCE_THRESHOLD } from "@/lib/repositories/variance";
import { Calculator, Download, TriangleAlert } from "lucide-react";
import { PayrollTabs } from "../tabs";
import { RunForm, OffCycleForm, type OffCycleCandidate } from "./form";

/** PY-03 — run payroll, gross to net, and pay anything owed off-cycle. */
export default async function RunPage(props: {
  searchParams: Promise<{ period?: string; run?: string; page?: string }>;
}) {
  await requirePage(["payroll.view"], "/payroll/my-payslips");

  const params = await props.searchParams;
  const periods = await db
    .select()
    .from(pyPayrollPeriod)
    .orderBy(desc(pyPayrollPeriod.year), desc(pyPayrollPeriod.month), asc(pyPayrollPeriod.areaCode));

  const runnable = periods.filter((p) => p.status === "Locked");
  const selectedId = Number(params.period) || runnable[0]?.id || periods[0]?.id;
  const selected = periods.find((p) => p.id === selectedId);

  const runs = selected
    ? await db
        .select()
        .from(pyPayrollRun)
        .where(eq(pyPayrollRun.periodId, selected.id))
        .orderBy(asc(pyPayrollRun.runAt))
    : [];
  const regular = runs.find((r) => r.runType === "Regular");
  const run =
    runs.find((r) => r.id === Number(params.run)) ??
    (regular?.status === "Completed" ? regular : runs.findLast((r) => r.status === "Completed"));
  const inProgress = regular && regular.status !== "Completed" ? regular.id : null;

  const { page, limit, offset } = pageFrom(params.page);
  const [results, total] = run
    ? await resultsPage(run.id, run.periodId, limit, offset)
    : [[], 0];

  // Before the month's regular run, anything owed this month is paid by it.
  const offCycleOpen =
    selected !== undefined &&
    (selected.status === "Posted" || (selected.status === "Locked" && regular?.status === "Completed"));
  const candidates = offCycleOpen ? await offCycleCandidates(selected.year, selected.month) : [];
  const variance =
    run && run.runType === "Regular" && run.status === "Completed" ? await varianceFor(run.id) : null;

  const monthLabel = selected ? formatMonth(selected.year, selected.month) : "";

  return (
    <>
      <PayrollTabs />
      <PageHeader
        title="Run payroll"
        subtitle="Pays the days each person was employed, prorated for unpaid absence, with allowances, payments and any arrears, less provident fund and tax."
      />

      <RunForm
        periods={periods.map((p) => ({
          value: String(p.id),
          label: `${formatMonth(p.year, p.month)}, ${p.areaCode} (${p.status.toLowerCase()})`,
          runnable: p.status === "Locked",
        }))}
        selectedId={selectedId ? String(selectedId) : ""}
        inProgressRunId={inProgress}
      />

      {selected && selected.status === "Open" ? (
        <div className="mt-6">
          <Notice>
            {monthLabel} is still open. Release it on the periods tab before running payroll.
          </Notice>
        </div>
      ) : null}

      {inProgress ? (
        <div className="mt-6">
          <Notice>
            The {monthLabel} run stopped part way through. Resume it to finish; nobody is
            calculated twice.
          </Notice>
        </div>
      ) : null}

      {runs.length > 1 ? (
        <div className="mt-6">
          <Tabs>
            {runs.map((r) => (
              <Tab
                key={r.id}
                href={`/payroll/run?period=${selectedId}&run=${r.id}`}
                active={run?.id === r.id}
              >
                {r.runType === "Regular" ? "Regular run" : `Off-cycle: ${r.reason ?? "payment"}`}
              </Tab>
            ))}
          </Tabs>
        </div>
      ) : null}

      {run ? (
        <>
          <div className={runs.length > 1 ? "" : "mt-6"}>
            <FigureRow>
              <Figure label="People" value={run.employeeCount} hint={run.runType === "Regular" ? "in this run" : "paid off-cycle"} />
              <Figure label="Gross" value={formatINR(run.grossTotalPaise)} hint="before deductions" />
              <Figure label="Net" value={formatINR(run.netTotalPaise)} hint={run.payDate ? `paid ${formatDate(run.payDate)}` : "payable"} />
              <Figure
                label="Errors"
                value={run.errorCount}
                hint={run.errorCount === 0 ? "none" : "could not be paid"}
                problem={run.errorCount > 0}
              />
            </FigureRow>
          </div>

          {run.errorCount > 0 ? (
            <div className="mt-6">
              <Notice problem icon={<TriangleAlert />}>
                {run.errorCount} {run.errorCount === 1 ? "person" : "people"} could not be paid.
                Fix the records named below and run again.
              </Notice>
            </div>
          ) : null}

          {variance && variance.checked > 0 ? (
            <div className="mt-6">
              <Card>
                <CardHeader
                  title="Changes since last month"
                  description={
                    variance.flagged.length === 0
                      ? `Nobody's net pay moved by ${VARIANCE_THRESHOLD * 100}% or more since their last regular run.`
                      : `${variance.flagged.length} of ${variance.checked} people are new or moved by ${VARIANCE_THRESHOLD * 100}% or more. Check them before posting.`
                  }
                />
                {variance.flagged.length > 0 ? (
                  <Table>
                    <thead>
                      <tr>
                        <Th>Employee</Th>
                        <Th numeric>Last run</Th>
                        <Th numeric>This run</Th>
                        <Th numeric>Change</Th>
                        <Th>Likely because</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {variance.flagged.map((v) => (
                        <Tr key={v.resultId}>
                          <Td>
                            <Link href={`/payroll/payslip/${v.resultId}`} className="hover:underline">
                              <TwoLine value={v.name} sub={v.number} />
                            </Link>
                          </Td>
                          <Td numeric>
                            {v.previousNetPaise === null ? (
                              <span className="text-decor">&mdash;</span>
                            ) : (
                              formatINR(v.previousNetPaise)
                            )}
                          </Td>
                          <Td numeric>{formatINR(v.netPaise)}</Td>
                          <Td numeric>
                            {v.change === null ? (
                              <span className="text-muted">new</span>
                            ) : (
                              <span className="font-medium text-ink">
                                {v.change > 0 ? "+" : ""}
                                {(v.change * 100).toFixed(1)}%
                              </span>
                            )}
                          </Td>
                          <Td>
                            <span className="text-secondary">{v.reasons.join(", ")}</span>
                          </Td>
                        </Tr>
                      ))}
                    </tbody>
                  </Table>
                ) : null}
              </Card>
            </div>
          ) : null}

          <div className="mt-6">
            <Card>
              <CardHeader
                title="Results"
                description="Errors first, then everyone by employee number."
                actions={
                  <ButtonAnchor href={`/api/export/payroll-run/${run.id}`} download size="sm">
                    <Download />
                    Export CSV
                  </ButtonAnchor>
                }
              />
              <Table>
                <thead>
                  <tr>
                    <Th>Employee</Th>
                    <Th numeric>Gross</Th>
                    <Th numeric>Deductions</Th>
                    <Th numeric>Net</Th>
                    <Th>Days paid</Th>
                    <Th>Status</Th>
                    <Th>
                      <span className="sr-only">Payslip</span>
                    </Th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((r) => {
                    const failed = r.status === "Error";
                    const dash = <span className="text-decor">&mdash;</span>;
                    const partial = r.employedDays < r.workingDays || r.unpaidDays > 0;
                    return (
                      <Tr key={r.id}>
                        <Td>
                          <TwoLine value={r.name} sub={r.number} />
                        </Td>
                        <Td numeric>{failed ? dash : formatINR(r.grossPaise)}</Td>
                        <Td numeric>{failed ? dash : formatINR(r.deductionsPaise)}</Td>
                        <Td numeric>
                          {failed ? dash : <span className="font-medium text-ink">{formatINR(r.netPaise)}</span>}
                        </Td>
                        <Td>
                          {failed || run.runType !== "Regular" ? (
                            dash
                          ) : (
                            <span className={partial ? "tabular text-ink" : "tabular text-secondary"}>
                              {r.employedDays - r.unpaidDays} of {r.workingDays}
                            </span>
                          )}
                        </Td>
                        <Td>
                          {failed ? (
                            <Status tone="problem">{r.errorMessage ?? "Error"}</Status>
                          ) : (
                            <Status tone="done">Calculated</Status>
                          )}
                        </Td>
                        <Td className="text-right">
                          {failed ? null : (
                            <Link
                              href={`/payroll/payslip/${r.id}`}
                              className="text-[13px] font-medium text-ink hover:underline"
                            >
                              Payslip
                            </Link>
                          )}
                        </Td>
                      </Tr>
                    );
                  })}
                </tbody>
              </Table>
              <Pagination
                page={page}
                total={total}
                path="/payroll/run"
                params={{ period: String(selectedId), run: String(run.id) }}
                noun="results"
              />
            </Card>
          </div>
        </>
      ) : !inProgress ? (
        <div className="mt-6">
          <Card>
            <EmptyState icon={<Calculator />} title="This period has not been run">
              Release the period, then run payroll to produce results and payslips.
            </EmptyState>
          </Card>
        </div>
      ) : null}

      {selected && candidates.length > 0 ? (
        <div className="mt-6">
          <OffCycleForm
            periodId={selected.id}
            candidates={candidates}
            primary={selected.status === "Posted"}
            defaultPayDate={todayInIndia()}
          />
        </div>
      ) : null}
    </>
  );
}

type ResultRow = {
  id: number;
  name: string;
  number: string;
  grossPaise: number;
  deductionsPaise: number;
  netPaise: number;
  unpaidDays: number;
  workingDays: number;
  employedDays: number;
  status: string;
  errorMessage: string | null;
};

/** One page of a run's results, with names, in a single read. Errors first. */
async function resultsPage(
  runId: number,
  periodId: number,
  limit: number,
  offset: number,
): Promise<[ResultRow[], number]> {
  const period = await db.query.pyPayrollPeriod.findFirst({ where: eq(pyPayrollPeriod.id, periodId) });
  const asOf = period ? periodEnd(period.year, period.month) : todayInIndia();
  const client = rawClient();
  const [rows, count] = await client.batch(
    [
      {
        sql: `SELECT r.id, r.gross_paise, r.deductions_paise, r.net_paise, r.unpaid_days,
                     r.working_days, r.employed_days, r.status, r.error_message,
                     e.employee_number,
                     COALESCE(p.first_name || ' ' || p.last_name, e.employee_number) AS name
              FROM py_payroll_result r
              JOIN pa_employee e ON e.id = r.employee_id
              LEFT JOIN pa_it0002_personal_data p
                ON p.employee_id = e.id AND p.valid_from <= ?2 AND p.valid_to >= ?2
              WHERE r.run_id = ?1
              ORDER BY r.status = 'Calculated', e.employee_number
              LIMIT ?3 OFFSET ?4`,
        args: [runId, asOf, limit, offset],
      },
      { sql: "SELECT COUNT(*) AS n FROM py_payroll_result WHERE run_id = ?", args: [runId] },
    ],
    "read",
  );
  return [
    rows.rows.map((r) => ({
      id: Number(r.id),
      name: String(r.name),
      number: String(r.employee_number),
      grossPaise: Number(r.gross_paise),
      deductionsPaise: Number(r.deductions_paise),
      netPaise: Number(r.net_paise),
      unpaidDays: Number(r.unpaid_days),
      workingDays: Number(r.working_days),
      employedDays: Number(r.employed_days),
      status: String(r.status),
      errorMessage: r.error_message === null ? null : String(r.error_message),
    })),
    Number(count.rows[0].n),
  ];
}

/** People owed one-off payments that no run has paid yet, up to the month's end. */
async function offCycleCandidates(year: number, month: number): Promise<OffCycleCandidate[]> {
  const to = periodEnd(year, month);
  const fyStart = month >= 4 ? `${year}-04-01` : `${year - 1}-04-01`;
  const r = await rawClient().execute({
    sql: `SELECT a.employee_id, e.employee_number,
                 COALESCE(p.first_name || ' ' || p.last_name, e.employee_number) AS name,
                 SUM(CASE WHEN w.kind = 'Earning' THEN a.amount_paise ELSE -a.amount_paise END) AS owed,
                 COUNT(*) AS payments
          FROM py_it0015_additional_payment a
          JOIN pa_employee e ON e.id = a.employee_id
          JOIN py_wage_type w ON w.code = a.wage_type_code
          LEFT JOIN pa_it0002_personal_data p
            ON p.employee_id = e.id AND p.valid_from <= ?2 AND p.valid_to >= ?2
          WHERE a.paid_run_id IS NULL AND a.payment_date BETWEEN ?1 AND ?2
          GROUP BY a.employee_id
          ORDER BY e.employee_number`,
    args: [fyStart, to],
  });
  return r.rows.map((row) => ({
    employeeId: Number(row.employee_id),
    name: String(row.name),
    number: String(row.employee_number),
    owedPaise: Number(row.owed),
    payments: Number(row.payments),
  }));
}
