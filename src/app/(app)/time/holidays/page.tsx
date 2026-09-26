import { redirect } from "next/navigation";
import { asc } from "drizzle-orm";
import { db } from "@/lib/db";
import { ptHoliday } from "@/db/schema";
import { getSession, hasRole } from "@/lib/auth";
import { MasterScreen, type Column, type FieldDef } from "@/components/master-screen";
import { saveHoliday, deleteHoliday } from "@/app/actions/time";
import { TimeTabs } from "../tabs";
import { formatDate } from "@/lib/dates";

const COLUMNS: Column[] = [
  { key: "date", label: "Date" },
  { key: "name", label: "Holiday" },
  { key: "region", label: "Region" },
  { key: "weekday", label: "Falls on" },
];

const FIELDS: FieldDef[] = [
  { kind: "date", name: "date", label: "Date", required: true },
  { kind: "text", name: "name", label: "Holiday name", required: true, placeholder: "Gandhi Jayanti" },
  {
    kind: "select",
    name: "region",
    label: "Region",
    required: true,
    options: ["National", "Karnataka", "Maharashtra", "Tamil Nadu", "Delhi"].map((r) => ({
      value: r,
      label: r,
    })),
  },
];

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** TM-05 — the public holiday calendar that working-day maths reads from. */
export default async function HolidaysPage() {
  const session = await getSession();
  if (!hasRole(session, "HR_ADMIN")) redirect("/time/my-leave");

  const rows = await db.select().from(ptHoliday).orderBy(asc(ptHoliday.date));

  return (
    <>
      <TimeTabs />
      <MasterScreen
        title="Holidays"
        subtitle="Non-working days. Leave requests skip these, so a holiday inside a leave range costs nobody a day of entitlement."
        entity="holiday"
        columns={COLUMNS}
        idField="id"
        fields={FIELDS}
        allowEdit={false}
        saveAction={saveHoliday}
        deleteAction={deleteHoliday}
        emptyHint="Add the public holidays your working-day calculations should skip."
        rows={rows.map((r) => {
          const day = new Date(`${r.date}T00:00:00Z`).getUTCDay();
          return {
            id: String(r.id),
            describe: `${r.name} on ${formatDate(r.date)}`,
            cells: {
              date: <span className="tabular font-medium text-ink">{formatDate(r.date)}</span>,
              name: r.name,
              region: <span className="text-secondary">{r.region}</span>,
              weekday: (
                <span className="text-muted">
                  {WEEKDAYS[day]}
                  {day === 0 || day === 6 ? " (already non-working)" : ""}
                </span>
              ),
            },
            values: { date: r.date, name: r.name, region: r.region },
          };
        })}
      />
    </>
  );
}
