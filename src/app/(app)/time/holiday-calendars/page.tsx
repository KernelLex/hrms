import { asc, sql } from "drizzle-orm";
import { requirePage } from "@/lib/access";
import { db } from "@/lib/db";
import { ptHolidayCalendar, ptHoliday, ptHolidayYear, omOrgUnit } from "@/db/schema";
import { MasterScreen, type Column, type FieldDef } from "@/components/master-screen";
import { saveHolidayCalendar, deleteHolidayCalendar } from "@/app/actions/time";
import { Status } from "@/components/ui";
import { TimeTabs } from "../tabs";

const COLUMNS: Column[] = [
  { key: "code", label: "Code" },
  { key: "name", label: "Name" },
  { key: "years", label: "Years" },
  { key: "holidays", label: "Days listed" },
  { key: "units", label: "Org units on it" },
  { key: "status", label: "Status" },
];

const FIELDS: FieldDef[] = [
  { kind: "text", name: "code", label: "Code", required: true, placeholder: "TAMIL_NADU", uppercase: true },
  { kind: "text", name: "name", label: "Name", required: true, placeholder: "Tamil Nadu" },
  { kind: "checkbox", name: "isActive", label: "Active" },
];

/** TM-05 — the holiday calendars org units sit on. */
export default async function HolidayCalendarsPage() {
  await requirePage(["time.manage"], "/time/my-leave");

  const [calendars, holidayCounts, yearCounts, unitCounts] = await Promise.all([
    db.select().from(ptHolidayCalendar).orderBy(asc(ptHolidayCalendar.code)),
    db.select({ code: ptHoliday.calendarCode, n: sql<number>`count(*)` }).from(ptHoliday).groupBy(ptHoliday.calendarCode),
    db
      .select({ code: ptHolidayYear.calendarCode, n: sql<number>`count(*)` })
      .from(ptHolidayYear)
      .groupBy(ptHolidayYear.calendarCode),
    db.select({ code: omOrgUnit.calendarCode, n: sql<number>`count(*)` }).from(omOrgUnit).groupBy(omOrgUnit.calendarCode),
  ]);
  const holidaysOf = new Map(holidayCounts.map((h) => [h.code, h.n]));
  const yearsOf = new Map(yearCounts.map((y) => [y.code, y.n]));
  const unitsOf = new Map(unitCounts.map((a) => [a.code, a.n]));

  return (
    <>
      <TimeTabs />
      <MasterScreen
        title="Holiday calendars"
        subtitle="A named set of public holidays, published a year at a time. Put an org unit on one from the Org units screen and everything beneath it follows — Karnataka and Maharashtra get different holidays this way, and payroll prorates each against its own."
        entity="holiday calendar"
        columns={COLUMNS}
        idField="code"
        fields={FIELDS}
        saveAction={saveHolidayCalendar}
        deleteAction={deleteHolidayCalendar}
        emptyHint="Add a calendar, then open a year for it on the Holidays tab."
        rows={calendars.map((c) => ({
          id: c.code,
          describe: `${c.code} — ${c.name}`,
          cells: {
            code: <span className="font-medium text-ink">{c.code}</span>,
            name: c.name,
            years: <span className="tabular text-secondary">{yearsOf.get(c.code) ?? 0}</span>,
            holidays: <span className="tabular text-secondary">{holidaysOf.get(c.code) ?? 0}</span>,
            units: <span className="tabular text-secondary">{unitsOf.get(c.code) ?? 0}</span>,
            status: (
              <Status tone={c.isActive ? "done" : "neutral"}>{c.isActive ? "Active" : "Inactive"}</Status>
            ),
          },
          values: { code: c.code, name: c.name, isActive: c.isActive },
        }))}
      />
    </>
  );
}
