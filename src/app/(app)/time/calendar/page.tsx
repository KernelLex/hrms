import Link from "next/link";
import { can, requirePage } from "@/lib/access";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { listDirectReports } from "@/lib/repositories/employees";
import { teamCalendar, type DayState } from "@/lib/repositories/calendar";
import { formatMonth, todayInIndia } from "@/lib/dates";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui";
import { Pagination, pageFrom } from "@/components/pagination";
import { cn } from "@/lib/utils";
import { TimeTabs } from "../tabs";

/**
 * Who is away, day by day — HANDOVER.md §8.10's availability grid.
 *
 * Day cells are 14 by 28 pixels, 2 apart, with a 3px radius. Every cell has a
 * plain-text tooltip, every state is distinct in greyscale, and each person's
 * row also reads as one sentence for a screen reader.
 */

const CELL: Record<DayState, string> = {
  working: "bg-soft",
  away: "bg-ink",
  half: "bg-muted",
  requested: "bg-surface ring-1 ring-inset ring-decor hatch-ink",
  off: "bg-control hatch-white",
};

const LEGEND: { state: DayState; label: string }[] = [
  { state: "working", label: "Working" },
  { state: "away", label: "Away" },
  { state: "half", label: "Away half the day" },
  { state: "requested", label: "Requested, awaiting a decision" },
  { state: "off", label: "Weekend or holiday" },
];

function shift(year: number, month: number, by: number) {
  const d = new Date(Date.UTC(year, month - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function summary(days: { state: DayState; note: string }[]): string {
  const away = days.filter((d) => d.state === "away" || d.state === "half" || d.state === "requested");
  if (away.length === 0) return "Working every working day this month.";
  return away.map((d) => d.note.replace(/^[A-Z][a-z]{2} /, "")).join("; ") + ".";
}

export default async function TeamCalendarPage(props: {
  searchParams: Promise<{ month?: string; page?: string }>;
}) {
  const session = await requirePage(["time.team_calendar"], "/time/my-leave");
  // Whoever may see every employee sees everyone; a manager, their team.
  const isHr = can(session, "employee.view_all");

  const params = await props.searchParams;
  const m = /^(\d{4})-(\d{2})$/.exec(params.month ?? "") ?? /^(\d{4})-(\d{2})/.exec(todayInIndia())!;
  const year = Number(m[1]);
  const month = Math.min(12, Math.max(1, Number(m[2])));
  const { page, limit, offset } = pageFrom(params.page);

  const onlyIds = isHr
    ? undefined
    : session.employeeId
      ? (await listDirectReports(session.employeeId)).map((e) => e.id)
      : [];
  const cal = await teamCalendar({ year, month, onlyIds, limit, offset });
  const monthKey = `${year}-${String(month).padStart(2, "0")}`;

  return (
    <>
      {can(session, "time.manage") ? <TimeTabs /> : null}
      <PageHeader
        title="Team calendar"
        subtitle={
          isHr
            ? "Who is away on which day, from recorded absences and requests still waiting on a decision."
            : "Who in your team is away on which day, including requests waiting on you."
        }
        actions={
          <div className="flex items-center gap-1">
            <Link
              href={`/time/calendar?month=${shift(year, month, -1)}`}
              aria-label="Previous month"
              className="flex size-9 items-center justify-center rounded-full text-secondary transition-colors duration-150 hover:bg-soft hover:text-ink"
            >
              <ChevronLeft className="size-4" />
            </Link>
            <span className="tabular min-w-[132px] text-center text-sm font-medium text-ink">
              {formatMonth(year, month)}
            </span>
            <Link
              href={`/time/calendar?month=${shift(year, month, 1)}`}
              aria-label="Next month"
              className="flex size-9 items-center justify-center rounded-full text-secondary transition-colors duration-150 hover:bg-soft hover:text-ink"
            >
              <ChevronRight className="size-4" />
            </Link>
          </div>
        }
      />

      <Card>
        <CardHeader title={formatMonth(year, month)} description={`${cal.total} ${cal.total === 1 ? "person" : "people"}`} />
        {cal.people.length === 0 ? (
          <EmptyState icon={<CalendarDays />} title={isHr ? "Nobody employed this month" : "Nobody reports to you yet"}>
            People appear here once they are employed in the month.
          </EmptyState>
        ) : (
          <div className="overflow-x-auto px-6 pb-5" tabIndex={0} role="region" aria-label={`Team calendar, ${formatMonth(year, month)}`}>
            <table className="border-separate border-spacing-0">
              <thead>
                <tr>
                  <th scope="col" className="sticky left-0 z-10 bg-surface pr-4 pb-2 text-left text-[13px] font-normal text-muted">
                    Person
                  </th>
                  {cal.days.map((d) => (
                    <th
                      key={d.date}
                      scope="col"
                      className="w-4 px-px pb-2 text-center text-[10px] font-normal text-muted tabular"
                      aria-label={`${d.weekday} ${d.day}${d.holiday ? `, ${d.holiday}` : ""}`}
                    >
                      {d.day}
                    </th>
                  ))}
                  <th scope="col" className="pb-2 pl-4 text-right text-[13px] font-normal text-muted">
                    Days away
                  </th>
                </tr>
              </thead>
              <tbody>
                {cal.people.map((p) => (
                  <tr key={p.id}>
                    <th scope="row" className="sticky left-0 z-10 bg-surface py-1.5 pr-4 text-left font-normal">
                      <div className="max-w-[180px] truncate text-sm font-medium text-ink">{p.name}</div>
                      <div className="text-xs text-muted">{p.number}</div>
                      <span className="sr-only">{summary(p.days)}</span>
                    </th>
                    {p.days.map((d, i) => (
                      <td key={i} className="px-px py-1.5" aria-hidden>
                        <div title={d.note} className={cn("h-7 w-3.5 rounded-[3px]", CELL[d.state])} />
                      </td>
                    ))}
                    <td className="tabular py-1.5 pl-4 text-right text-sm text-ink">{p.awayDays}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex flex-wrap gap-x-5 gap-y-2 border-t border-soft px-6 py-4" aria-label="Legend">
          {LEGEND.map((l) => (
            <span key={l.state} className="inline-flex items-center gap-2 text-xs text-muted">
              <span className={cn("h-3.5 w-2 rounded-[3px]", CELL[l.state])} aria-hidden />
              {l.label}
            </span>
          ))}
        </div>
        <Pagination page={page} total={cal.total} path="/time/calendar" params={{ month: monthKey }} noun="people" />
      </Card>
    </>
  );
}
