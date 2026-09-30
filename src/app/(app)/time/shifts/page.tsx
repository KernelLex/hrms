import { asc } from "drizzle-orm";
import { requirePage } from "@/lib/access";
import { db } from "@/lib/db";
import { ptShift } from "@/db/schema";
import { MasterScreen, type Column, type FieldDef } from "@/components/master-screen";
import { saveShift, deleteShift } from "@/app/actions/attendance";
import { Status } from "@/components/ui";
import { TimeTabs } from "../tabs";

const COLUMNS: Column[] = [
  { key: "code", label: "Code" },
  { key: "name", label: "Name" },
  { key: "hours", label: "Hours" },
  { key: "night", label: "Night" },
  { key: "grace", label: "Grace", numeric: true },
  { key: "status", label: "Status" },
];

const FIELDS: FieldDef[] = [
  { kind: "text", name: "code", label: "Code", required: true, placeholder: "MORNING", uppercase: true },
  { kind: "text", name: "name", label: "Name", required: true, placeholder: "Morning shift" },
  { kind: "text", name: "startTime", label: "Start (HH:MM)", required: true, placeholder: "06:00" },
  { kind: "text", name: "endTime", label: "End (HH:MM)", required: true, placeholder: "14:00", hint: "Earlier than the start means it crosses midnight." },
  { kind: "text", name: "breakMinutes", label: "Break (minutes)", placeholder: "30" },
  { kind: "checkbox", name: "isNight", label: "Night shift" },
  { kind: "text", name: "graceMinutes", label: "Grace (minutes)", placeholder: "10", hint: "How late is still on time." },
  { kind: "checkbox", name: "isActive", label: "Active" },
];

/** TM-07 — the shifts a roster pattern is built from. */
export default async function ShiftsPage() {
  await requirePage(["time.manage"], "/time/my-attendance");
  const shifts = await db.select().from(ptShift).orderBy(asc(ptShift.code));

  return (
    <>
      <TimeTabs />
      <MasterScreen
        title="Shifts"
        subtitle="Start, end, break and how late is still on time. A shift whose end is earlier than its start crosses midnight, and belongs to the day it started."
        entity="shift"
        columns={COLUMNS}
        idField="code"
        fields={FIELDS}
        saveAction={saveShift}
        deleteAction={deleteShift}
        emptyHint="Add a shift, then build a roster pattern from it."
        rows={shifts.map((s) => ({
          id: s.code,
          describe: `${s.code} — ${s.name}`,
          cells: {
            code: <span className="font-medium text-ink">{s.code}</span>,
            name: s.name,
            hours: <span className="tabular text-secondary">{s.startTime}–{s.endTime}</span>,
            night: s.isNight ? <Status tone="waiting">Night</Status> : <span className="text-decor">&mdash;</span>,
            grace: <span className="tabular text-secondary">{s.graceMinutes}m</span>,
            status: <Status tone={s.isActive ? "done" : "neutral"}>{s.isActive ? "Active" : "Inactive"}</Status>,
          },
          values: {
            code: s.code,
            name: s.name,
            startTime: s.startTime,
            endTime: s.endTime,
            breakMinutes: String(s.breakMinutes),
            isNight: s.isNight,
            graceMinutes: String(s.graceMinutes),
            isActive: s.isActive,
          },
        }))}
      />
    </>
  );
}
