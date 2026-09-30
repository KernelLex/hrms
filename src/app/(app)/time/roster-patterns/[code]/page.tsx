import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { requirePage } from "@/lib/access";
import { db } from "@/lib/db";
import { ptRosterPattern, ptRosterPatternDay, ptShift } from "@/db/schema";
import { PageHeader } from "@/components/ui";
import { TimeTabs } from "../../tabs";
import { PatternDaysForm } from "./form";

export default async function RosterPatternDaysPage(props: { params: Promise<{ code: string }> }) {
  await requirePage(["time.manage"], "/time/my-attendance");
  const { code } = await props.params;

  const [pattern, days, shifts] = await Promise.all([
    db.query.ptRosterPattern.findFirst({ where: eq(ptRosterPattern.code, code) }),
    db.select().from(ptRosterPatternDay).where(eq(ptRosterPatternDay.patternCode, code)),
    db.select().from(ptShift).where(eq(ptShift.isActive, true)).orderBy(asc(ptShift.code)),
  ]);
  if (!pattern) notFound();

  const shiftOf = new Map(days.map((d) => [d.dayIndex, d.shiftCode]));
  const initial = Array.from({ length: pattern.cycleLengthDays }, (_, i) => shiftOf.get(i) ?? null);

  return (
    <>
      <TimeTabs />
      <PageHeader title={`${pattern.name} (${pattern.code})`} subtitle={`A ${pattern.cycleLengthDays}-day rotation.`} />
      <PatternDaysForm
        patternCode={pattern.code}
        cycleLengthDays={pattern.cycleLengthDays}
        shifts={shifts.map((s) => ({ value: s.code, label: `${s.name} (${s.startTime}–${s.endTime})` }))}
        initial={initial}
      />
    </>
  );
}
