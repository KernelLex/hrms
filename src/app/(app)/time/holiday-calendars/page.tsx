import { asc, sql } from "drizzle-orm";
import { requirePage } from "@/lib/access";
import { db } from "@/lib/db";
import { ptHolidayCalendar, ptHoliday, omPersonnelArea } from "@/db/schema";
import { MasterScreen, type Column, type FieldDef } from "@/components/master-screen";
import { saveHolidayCalendar, deleteHolidayCalendar } from "@/app/actions/time";
import { Status } from "@/components/ui";
import { TimeTabs } from "../tabs";

const COLUMNS: Column[] = [
  { key: "code", label: "Code" },
  { key: "name", label: "Name" },
  { key: "holidays", label: "Holidays" },
  { key: "optional", label: "Optional allowed", numeric: true },
  { key: "areas", label: "Areas on it" },
  { key: "status", label: "Status" },
];

const FIELDS: FieldDef[] = [
  { kind: "text", name: "code", label: "Code", required: true, placeholder: "TAMIL_NADU", uppercase: true },
  { kind: "text", name: "name", label: "Name", required: true, placeholder: "Tamil Nadu" },
  {
    kind: "text",
    name: "optionalAllowance",
    label: "Optional holidays allowed",
    placeholder: "0",
    hint: "How many of this calendar's optional holidays one person may take in a year. 0 means none.",
  },
  { kind: "checkbox", name: "isActive", label: "Active" },
];

/** TM-05 — the holiday calendars each personnel area sits on. */
export default async function HolidayCalendarsPage() {
  await requirePage(["time.manage"], "/time/my-leave");

  const [calendars, holidayCounts, areaCounts] = await Promise.all([
    db.select().from(ptHolidayCalendar).orderBy(asc(ptHolidayCalendar.code)),
    db.select({ code: ptHoliday.calendarCode, n: sql<number>`count(*)` }).from(ptHoliday).groupBy(ptHoliday.calendarCode),
    db.select({ code: omPersonnelArea.calendarCode, n: sql<number>`count(*)` }).from(omPersonnelArea).groupBy(omPersonnelArea.calendarCode),
  ]);
  const holidaysOf = new Map(holidayCounts.map((h) => [h.code, h.n]));
  const areasOf = new Map(areaCounts.map((a) => [a.code, a.n]));

  return (
    <>
      <TimeTabs />
      <MasterScreen
        title="Holiday calendars"
        subtitle="A named set of public holidays. Assign a personnel area to one on the Personnel areas screen — Karnataka and Maharashtra get different holidays this way, and payroll prorates each against its own."
        entity="holiday calendar"
        columns={COLUMNS}
        idField="code"
        fields={FIELDS}
        saveAction={saveHolidayCalendar}
        deleteAction={deleteHolidayCalendar}
        emptyHint="Add a calendar, then its holidays on the Holidays tab."
        rows={calendars.map((c) => ({
          id: c.code,
          describe: `${c.code} — ${c.name}`,
          cells: {
            code: <span className="font-medium text-ink">{c.code}</span>,
            name: c.name,
            holidays: <span className="tabular text-secondary">{holidaysOf.get(c.code) ?? 0}</span>,
            optional: <span className="tabular text-secondary">{c.optionalAllowance}</span>,
            areas: <span className="tabular text-secondary">{areasOf.get(c.code) ?? 0}</span>,
            status: (
              <Status tone={c.isActive ? "done" : "neutral"}>{c.isActive ? "Active" : "Inactive"}</Status>
            ),
          },
          values: { code: c.code, name: c.name, optionalAllowance: String(c.optionalAllowance), isActive: c.isActive },
        }))}
      />
    </>
  );
}
