import { redirect } from "next/navigation";
import { getSession, hasRole } from "@/lib/auth";
import { reports } from "@/lib/repositories/reports";
import { formatLakh } from "@/lib/money";
import { todayInIndia } from "@/lib/dates";
import { Card, CardHeader, Figure, FigureRow, PageHeader } from "@/components/ui";
import { BarList } from "@/components/charts";

/**
 * HR reports: the numbers someone asks for in a meeting — how many people,
 * where, what they cost, how much leave, how many left. One hue per §10:
 * ink bars on soft tracks, values at the tips.
 */
export default async function ReportsPage() {
  const session = await getSession();
  if (!hasRole(session, "HR_ADMIN")) redirect("/");

  const r = await reports(todayInIndia());

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
      </div>
    </>
  );
}
