import { redirect } from "next/navigation";
import { asc } from "drizzle-orm";
import { db } from "@/lib/db";
import { ptWorkScheduleRule } from "@/db/schema";
import { getSession, hasRole } from "@/lib/auth";
import { MasterScreen, type Column, type FieldDef } from "@/components/master-screen";
import { saveWorkSchedule, deleteWorkSchedule } from "@/app/actions/time";
import { Status } from "@/components/ui";
import { TimeTabs } from "../tabs";

const COLUMNS: Column[] = [
  { key: "code", label: "Code" },
  { key: "name", label: "Schedule" },
  { key: "hours", label: "Weekly hours", numeric: true },
  { key: "days", label: "Working days" },
  { key: "status", label: "Status" },
];

const FIELDS: FieldDef[] = [
  { kind: "text", name: "code", label: "Schedule code", required: true, placeholder: "WS01", uppercase: true },
  { kind: "text", name: "name", label: "Schedule name", required: true, placeholder: "General 9-6 (Mon-Fri)" },
  { kind: "text", name: "weeklyHours", label: "Weekly hours", required: true, placeholder: "40" },
  { kind: "text", name: "workingDays", label: "Working days", full: true, placeholder: "Mon-Fri" },
  { kind: "checkbox", name: "isActive", label: "Active" },
];

/** TM-05 — work schedule rules, assigned to employees through IT0007. */
export default async function SchedulesPage() {
  const session = await getSession();
  if (!hasRole(session, "HR_ADMIN")) redirect("/time/my-leave");

  const rows = await db
    .select()
    .from(ptWorkScheduleRule)
    .orderBy(asc(ptWorkScheduleRule.code));

  return (
    <>
      <TimeTabs />
      <MasterScreen
        title="Work schedules"
        subtitle="Shift patterns and weekly hours. Each employee is assigned one through their planned working time."
        entity="work schedule"
        columns={COLUMNS}
        idField="code"
        fields={FIELDS}
        saveAction={saveWorkSchedule}
        deleteAction={deleteWorkSchedule}
        emptyHint="Define the shift patterns your employees work."
        rows={rows.map((r) => ({
          id: r.code,
          describe: `${r.code} — ${r.name}`,
          cells: {
            code: <span className="font-medium text-ink">{r.code}</span>,
            name: r.name,
            hours: String(r.weeklyHours),
            days: r.workingDays ?? <span className="text-decor">&mdash;</span>,
            status: (
              <Status tone={r.isActive ? "done" : "neutral"}>
                {r.isActive ? "Active" : "Inactive"}
              </Status>
            ),
          },
          values: {
            code: r.code,
            name: r.name,
            weeklyHours: String(r.weeklyHours),
            workingDays: r.workingDays ?? "",
            isActive: r.isActive,
          },
        }))}
      />
    </>
  );
}
