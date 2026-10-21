import { asc, and, eq } from "drizzle-orm";
import { requirePage } from "@/lib/access";
import { db } from "@/lib/db";
import { ptHoliday, ptHolidayCalendar, ptHolidayYear } from "@/db/schema";
import { holidayAllowanceFor } from "@/lib/engines/quota";
import { PageHeader, Card, CardHeader, EmptyState, Status, Badge, Table, Th, Tr, Td } from "@/components/ui";
import { CalendarDays } from "lucide-react";
import { todayInIndia, formatDate } from "@/lib/dates";
import { TimeTabs } from "../tabs";
import { YearPicker, YearSettings, NewHoliday, DeleteHoliday, CopyLastYear } from "./year";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

type HolidayRow = { id: number; date: string; name: string; isOptional: boolean };

/** One group's days — fixed or optional — with the weekend noted. */
function List({ rows, empty }: { rows: HolidayRow[]; empty: string }) {
  if (rows.length === 0) return <p className="px-6 pb-5 text-[13px] text-muted">{empty}</p>;
  return (
    <Table>
      <thead>
        <Tr>
          <Th>Date</Th>
          <Th>Holiday</Th>
          <Th>Falls on</Th>
          <Th> </Th>
        </Tr>
      </thead>
      <tbody>
        {rows.map((h) => {
          const day = new Date(`${h.date}T00:00:00Z`).getUTCDay();
          return (
            <Tr key={h.id}>
              <Td>
                <span className="tabular font-medium text-ink">{formatDate(h.date)}</span>
              </Td>
              <Td>{h.name}</Td>
              <Td>
                <span className="text-muted">
                  {WEEKDAYS[day]}
                  {day === 0 || day === 6 ? " (already non-working)" : ""}
                </span>
              </Td>
              <Td>
                <DeleteHoliday id={h.id} describe={`${h.name} on ${formatDate(h.date)}`} />
              </Td>
            </Tr>
          );
        })}
      </tbody>
    </Table>
  );
}

/**
 * TM-05 — one calendar's year.
 *
 * A holiday list is published a year at a time, and the year carries the cap:
 * how many days off it gives altogether. Fixed days come off that cap first,
 * so what is left is how many of the optional ones each person may choose —
 * which is why the number beside "may choose" is never typed in anywhere.
 */
export default async function HolidaysPage({
  searchParams,
}: {
  searchParams: Promise<{ calendar?: string; year?: string }>;
}) {
  await requirePage(["time.manage"], "/time/my-leave");
  const q = await searchParams;

  const calendars = await db.select().from(ptHolidayCalendar).orderBy(asc(ptHolidayCalendar.code));
  if (calendars.length === 0) {
    return (
      <>
        <TimeTabs />
        <PageHeader title="Holidays" subtitle="Public holidays, published one year at a time." />
        <Card>
          <EmptyState icon={<CalendarDays />} title="No calendars yet">
            Add a holiday calendar first, then open a year on it and list its days.
          </EmptyState>
        </Card>
      </>
    );
  }

  const calendarCode = calendars.some((c) => c.code === q.calendar) ? q.calendar! : calendars[0].code;
  const years = await db
    .select()
    .from(ptHolidayYear)
    .where(eq(ptHolidayYear.calendarCode, calendarCode))
    .orderBy(asc(ptHolidayYear.year));

  const thisYear = Number(todayInIndia().slice(0, 4));
  const asked = Number(q.year);
  // A year that does not exist yet is still a year you can ask for — that is
  // how one gets opened.
  const year = Number.isInteger(asked) && asked >= 2000 && asked <= 2100
    ? asked
    : (years.find((y) => y.year === thisYear)?.year ?? years[years.length - 1]?.year ?? thisYear);
  const open = years.find((y) => y.year === year) ?? null;

  const [holidays, allowance] = await Promise.all([
    open
      ? db
          .select()
          .from(ptHoliday)
          .where(and(eq(ptHoliday.calendarCode, calendarCode), eq(ptHoliday.year, year)))
          .orderBy(asc(ptHoliday.date))
      : Promise.resolve([]),
    open ? holidayAllowanceFor(calendarCode, year) : Promise.resolve(null),
  ]);

  const fixed = holidays.filter((h) => !h.isOptional);
  const optional = holidays.filter((h) => h.isOptional);
  const calendarName = calendars.find((c) => c.code === calendarCode)?.name ?? calendarCode;

  return (
    <>
      <TimeTabs />
      <PageHeader
        title="Holidays"
        subtitle="Published one year at a time. The year's allowance covers fixed and chosen days together, so every fixed day you add takes one off what each person may choose."
        actions={open ? <NewHoliday calendarCode={calendarCode} year={year} /> : undefined}
      />

      <YearPicker
        calendars={calendars.map((c) => ({ value: c.code, label: `${c.code} — ${c.name}` }))}
        years={years.map((y) => y.year)}
        calendarCode={calendarCode}
        year={year}
      />

      {!open ? (
        <Card>
          <EmptyState icon={<CalendarDays />} title={`${calendarName} has no ${year} yet`}>
            Open the year to set how many days off it gives, then list them. Nothing can be added to a
            year that does not exist.
          </EmptyState>
          <div className="px-6 pb-6">
            <YearSettings calendarCode={calendarCode} year={year} open={null} />
          </div>
        </Card>
      ) : (
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader
              title={`${calendarName}, ${year}`}
              description="What this year gives one person, and how much of it is theirs to choose."
            />
            <div className="grid grid-cols-1 gap-px bg-soft sm:grid-cols-3">
              {[
                { label: "Days off in all", value: allowance?.total ?? 0, note: "The cap for this year" },
                { label: "Fixed", value: allowance?.mandatory ?? 0, note: "Everyone gets these" },
                {
                  label: "Each person may choose",
                  value: allowance?.optional ?? 0,
                  note: `${optional.length} offered`,
                },
              ].map((f) => (
                <div key={f.label} className="bg-surface px-6 py-4">
                  <div className="text-[13px] text-muted">{f.label}</div>
                  <div className="tabular mt-1 text-[26px] leading-tight font-semibold tracking-[-0.02em] text-ink">
                    {f.value}
                  </div>
                  <div className="mt-0.5 text-[13px] text-muted">{f.note}</div>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-3 px-6 py-4">
              <Status tone={open.isPublished ? "done" : "waiting"}>{open.isPublished ? "Published" : "Draft"}</Status>
              <span className="text-[13px] text-muted">
                {open.isPublished
                  ? "People can see this year and choose from it."
                  : "A draft year is nobody's to choose from until you publish it."}
              </span>
            </div>
            <div className="px-6 pb-6">
              <YearSettings calendarCode={calendarCode} year={year} open={open} />
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Fixed holidays"
              description="Everyone on this calendar gets these. Leave requests skip them, and payroll prorates against them."
            />
            <List rows={fixed} empty="No fixed holidays listed for this year yet." />
          </Card>

          <Card>
            <CardHeader
              title="Optional holidays"
              description="A working day for everyone until someone chooses it. Offer as many as you like — the year's allowance is what limits how many each person takes."
              actions={<Badge tone="neutral">{`${optional.length} offered, ${allowance?.optional ?? 0} each`}</Badge>}
            />
            <List rows={optional} empty="No optional holidays offered for this year yet." />
          </Card>

          <CopyLastYear calendarCode={calendarCode} year={year} years={years.map((y) => y.year)} />
        </div>
      )}
    </>
  );
}
