import { requirePage } from "@/lib/access";
import { reports } from "@/lib/repositories/reports";
import { headcountTrend, REPORT_LABEL, REPORT_NAMES } from "@/lib/reports";
import { leaveLiabilityAsOf } from "@/lib/engines/leave-policy";
import { rawClient } from "@/lib/db";
import { formatLakh, formatINR } from "@/lib/money";
import { todayInIndia } from "@/lib/dates";
import { Card, CardHeader, Figure, FigureRow, PageHeader, Table, Th, Tr, Td, EmptyState } from "@/components/ui";
import { BarList } from "@/components/charts";
import { ScheduleReportForm, DeleteScheduleButton } from "./form";

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const shortMonth = (monthKey: string) => `${MONTHS_SHORT[Number(monthKey.slice(5, 7)) - 1]} '${monthKey.slice(2, 4)}`;

/**
 * HR reports: the numbers someone asks for in a meeting — how many people,
 * where, what they cost, how much leave, how many left. One hue per §8.10:
 * ink bars on soft tracks, values at the tips.
 */
export default async function ReportsPage() {
  await requirePage(["reports.view"], "/");

  const today = todayInIndia();
  const [r, trend, liability, schedules] = await Promise.all([
    reports(today),
    headcountTrend(today),
    leaveLiabilityAsOf(today),
    rawClient().execute("SELECT * FROM rp_schedule ORDER BY id DESC"),
  ]);

  return (
    <>
      <PageHeader
        title="Reports"
        subtitle={`Headcount, cost, leave and turnover, as of today and for financial year ${r.financialYear}.`}
      />

      <FigureRow>
        <Figure label="Headcount" value={r.headcount} hint="employed today" href="/core-hr" />
        <Figure label="Joined" value={r.joiners} hint="since 1 April" />
        <Figure label="Left" value={r.leavers} hint="since 1 April" />
        <Figure
          label="Attrition"
          value={r.attrition === null ? "—" : `${(r.attrition * 100).toFixed(1)}%`}
          hint="leavers in 12 months over headcount"
        />
      </FigureRow>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Headcount by department" description="People employed today." />
          <BarList items={r.byDepartment} empty="Nobody is employed yet." />
        </Card>

        <Card>
          <CardHeader
            title="Payroll cost by department"
            description={r.payroll ? `Gross pay, ${r.payroll.month}, the latest posted month.` : "Gross pay for the latest posted month."}
          />
          <BarList
            items={r.payroll?.byDepartment ?? []}
            format={formatLakh}
            empty="Appears once a payroll month has been posted."
          />
        </Card>

        <Card>
          <CardHeader title="Leave taken this year" description="Working days, by kind of absence." />
          <BarList
            items={r.leaveByType}
            format={(n) => `${n} ${n === 1 ? "day" : "days"}`}
            empty="No absences recorded this year."
          />
        </Card>

        <Card>
          <CardHeader title="Headcount trend" description="The last 24 months, as of each month's end." />
          <BarList items={trend.map((t) => ({ label: shortMonth(t.month), value: t.value }))} empty="Builds up as the daily job runs." />
        </Card>

        <Card>
          <CardHeader title="Leave liability" description="Every encashable balance, priced at its own daily rate — what finance would owe if it were all cashed out today." />
          <div className="px-6 pb-5">
            <div className="tabular text-[28px] leading-tight font-semibold tracking-[-0.02em] text-ink">{formatINR(liability.totalPaise)}</div>
            <p className="mt-1 text-[13px] text-muted">across {liability.byEmployee.length} balance{liability.byEmployee.length === 1 ? "" : "s"}</p>
          </div>
        </Card>
      </div>

      <div className="mt-6">
        <Card>
          <CardHeader title="Scheduled reports" description="Rendered to CSV and emailed to their recipients on the 1st of every month." />
          <div className="px-6 pb-5">
            <ScheduleReportForm reportNames={[...REPORT_NAMES]} />
          </div>
          {schedules.rows.length === 0 ? (
            <EmptyState title="No reports scheduled yet" />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Report</Th>
                  <Th>Recipients</Th>
                  <Th>Last sent</Th>
                  <Th></Th>
                </tr>
              </thead>
              <tbody>
                {schedules.rows.map((s) => (
                  <Tr key={String(s.id)}>
                    <Td>
                      <span className="font-medium text-ink">{REPORT_LABEL[String(s.report_name)] ?? String(s.report_name)}</span>
                    </Td>
                    <Td>
                      <span className="text-secondary">{String(s.recipients)}</span>
                    </Td>
                    <Td>{s.last_run_at ? <span className="tabular text-secondary">{String(s.last_run_at)}</span> : <span className="text-decor">&mdash;</span>}</Td>
                    <Td>
                      <DeleteScheduleButton id={Number(s.id)} />
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
