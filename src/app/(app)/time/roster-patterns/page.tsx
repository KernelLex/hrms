import Link from "next/link";
import { asc, sql } from "drizzle-orm";
import { requirePage } from "@/lib/access";
import { db } from "@/lib/db";
import { ptRosterPattern, ptRosterPatternDay } from "@/db/schema";
import { MasterScreen, type Column, type FieldDef } from "@/components/master-screen";
import { saveRosterPattern, deleteRosterPattern } from "@/app/actions/attendance";
import { Status } from "@/components/ui";
import { TimeTabs } from "../tabs";

const COLUMNS: Column[] = [
  { key: "code", label: "Code" },
  { key: "name", label: "Name" },
  { key: "cycle", label: "Cycle", numeric: true },
  { key: "days", label: "Days set", numeric: true },
  { key: "status", label: "Status" },
  { key: "edit", label: "" },
];

const FIELDS: FieldDef[] = [
  { kind: "text", name: "code", label: "Code", required: true, placeholder: "THREE-SHIFT", uppercase: true },
  { kind: "text", name: "name", label: "Name", required: true, placeholder: "Rotating three-shift" },
  { kind: "text", name: "cycleLengthDays", label: "Cycle length (days)", required: true, placeholder: "21", hint: "How many days before the rotation repeats." },
  { kind: "checkbox", name: "isActive", label: "Active" },
];

/** TM-09 — a repeating rotation of shifts; each pattern's own days are set on its own page. */
export default async function RosterPatternsPage() {
  await requirePage(["time.manage"], "/time/my-attendance");
  const [patterns, dayCounts] = await Promise.all([
    db.select().from(ptRosterPattern).orderBy(asc(ptRosterPattern.code)),
    db.select({ code: ptRosterPatternDay.patternCode, n: sql<number>`count(*)` }).from(ptRosterPatternDay).groupBy(ptRosterPatternDay.patternCode),
  ]);
  const daysOf = new Map(dayCounts.map((d) => [d.code, d.n]));

  return (
    <>
      <TimeTabs />
      <MasterScreen
        title="Roster patterns"
        subtitle="A repeating rotation — a 21-day three-shift cycle, say. Add the pattern here, then set which shift each day of its cycle is."
        entity="roster pattern"
        columns={COLUMNS}
        idField="code"
        fields={FIELDS}
        saveAction={saveRosterPattern}
        deleteAction={deleteRosterPattern}
        emptyHint="Add a pattern, then set its days and assign it to a team on the Roster tab."
        rows={patterns.map((p) => ({
          id: p.code,
          describe: `${p.code} — ${p.name}`,
          cells: {
            code: <span className="font-medium text-ink">{p.code}</span>,
            name: p.name,
            cycle: <span className="tabular text-secondary">{p.cycleLengthDays}</span>,
            days: (
              <span className={`tabular ${(daysOf.get(p.code) ?? 0) < p.cycleLengthDays ? "text-muted" : "text-secondary"}`}>
                {daysOf.get(p.code) ?? 0} of {p.cycleLengthDays}
              </span>
            ),
            status: <Status tone={p.isActive ? "done" : "neutral"}>{p.isActive ? "Active" : "Inactive"}</Status>,
            edit: (
              <Link href={`/time/roster-patterns/${p.code}`} className="text-[13px] font-medium text-ink hover:underline">
                Edit days
              </Link>
            ),
          },
          values: { code: p.code, name: p.name, cycleLengthDays: String(p.cycleLengthDays), isActive: p.isActive },
        }))}
      />
    </>
  );
}
