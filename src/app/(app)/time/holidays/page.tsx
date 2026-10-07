import { requirePage } from "@/lib/access";
import { asc } from "drizzle-orm";
import { db } from "@/lib/db";
import { ptHoliday, ptHolidayCalendar } from "@/db/schema";
import { MasterScreen, type Column, type FieldDef } from "@/components/master-screen";
import { saveHoliday, deleteHoliday } from "@/app/actions/time";
import { TimeTabs } from "../tabs";
import { formatDate } from "@/lib/dates";

const COLUMNS: Column[] = [
  { key: "date", label: "Date" },
  { key: "name", label: "Holiday" },
  { key: "calendar", label: "Calendar" },
  { key: "weekday", label: "Falls on" },
  { key: "kind", label: "Kind" },
];

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** TM-05 — the public holidays working-day maths reads from, one list per calendar. */
export default async function HolidaysPage() {
  await requirePage(["time.manage"], "/time/my-leave");

  const [rows, calendars] = await Promise.all([
    db.select().from(ptHoliday).orderBy(asc(ptHoliday.date)),
    db.select().from(ptHolidayCalendar).orderBy(asc(ptHolidayCalendar.code)),
  ]);
  const calendarName = new Map(calendars.map((c) => [c.code, c.name]));

  const FIELDS: FieldDef[] = [
    { kind: "date", name: "date", label: "Date", required: true },
    { kind: "text", name: "name", label: "Holiday name", required: true, placeholder: "Gandhi Jayanti" },
    {
      kind: "select",
      name: "calendarCode",
      label: "Calendar",
      required: true,
      options: calendars.map((c) => ({ value: c.code, label: c.name })),
    },
    { kind: "checkbox", name: "isOptional", label: "Optional — people choose this one for themselves" },
  ];

  return (
    <>
      <TimeTabs />
      <MasterScreen
        title="Holidays"
        subtitle="Non-working days, one full list per calendar. Leave requests skip these, so a holiday inside a leave range costs nobody a day of entitlement. An optional holiday is a working day until an employee chooses it on My leave."
        entity="holiday"
        columns={COLUMNS}
        idField="id"
        fields={FIELDS}
        allowEdit={false}
        saveAction={saveHoliday}
        deleteAction={deleteHoliday}
        emptyHint="Add a calendar first, then the public holidays it observes."
        rows={rows.map((r) => {
          const day = new Date(`${r.date}T00:00:00Z`).getUTCDay();
          return {
            id: String(r.id),
            describe: `${r.name} on ${formatDate(r.date)}`,
            cells: {
              date: <span className="tabular font-medium text-ink">{formatDate(r.date)}</span>,
              name: r.name,
              calendar: <span className="text-secondary">{calendarName.get(r.calendarCode) ?? r.calendarCode}</span>,
              weekday: (
                <span className="text-muted">
                  {WEEKDAYS[day]}
                  {day === 0 || day === 6 ? " (already non-working)" : ""}
                </span>
              ),
              kind: r.isOptional ? "Optional" : "Everyone",
            },
            values: { date: r.date, name: r.name, calendarCode: r.calendarCode, isOptional: r.isOptional ? "1" : "0" },
          };
        })}
      />
    </>
  );
}
