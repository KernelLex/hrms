import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, rawClient } from "@/lib/db";
import { ptAbsenceQuota } from "@/db/schema";
import {
  workingDaysBetween,
  calendarDaysBetween,
  consumeQuota,
  restoreQuota,
  daysToUnits,
  formatDays,
} from "@/lib/engines/quota";

/**
 * Temporary harness for the quota engine and working-day arithmetic.
 * Creates a throwaway employee and removes it afterwards.
 */
export const dynamic = "force-dynamic";

type Check = { name: string; pass: boolean; detail: string };

export async function GET() {
  const client = rawClient();
  const checks: Check[] = [];
  let employeeId: number | undefined;
  const add = (name: string, pass: boolean, detail: string) =>
    checks.push({ name, pass, detail });

  try {
    // 2026-01-24 is a Saturday, 2026-01-26 is Republic Day (seeded).
    const fridayToMonday = await workingDaysBetween("2026-01-23", "2026-01-27");
    add(
      "weekend and holiday skipped in working days",
      fridayToMonday === 2,
      `23-27 Jan spans ${calendarDaysBetween("2026-01-23", "2026-01-27")} calendar days but ${fridayToMonday} working days`,
    );

    const weekendOnly = await workingDaysBetween("2026-01-24", "2026-01-25");
    add("a pure weekend costs nothing", weekendOnly === 0, `${weekendOnly} working days`);

    const created = await client.execute({
      sql: `INSERT INTO pa_employee (employee_number, hire_date, employment_status, created_at)
            VALUES (?, '2020-01-01', 'Active', ?) RETURNING id`,
      args: [`ZZQ${Date.now()}`, new Date().toISOString()],
    });
    employeeId = created.rows[0].id as number;

    await db.insert(ptAbsenceQuota).values({
      employeeId,
      quotaTypeCode: "ANNUAL",
      year: 2026,
      entitledHalfDays: daysToUnits(10),
      usedHalfDays: 0,
      createdAt: new Date().toISOString(),
    });

    const ok3 = await consumeQuota({
      employeeId,
      quotaTypeCode: "ANNUAL",
      year: 2026,
      units: daysToUnits(3),
    });
    let quota = await db.query.ptAbsenceQuota.findFirst({
      where: eq(ptAbsenceQuota.employeeId, employeeId),
    });
    add(
      "consuming leave decrements the balance",
      ok3.ok && quota?.usedHalfDays === daysToUnits(3),
      `used ${formatDays(quota?.usedHalfDays ?? 0)} days`,
    );

    const overdraw = await consumeQuota({
      employeeId,
      quotaTypeCode: "ANNUAL",
      year: 2026,
      units: daysToUnits(20),
    });
    quota = await db.query.ptAbsenceQuota.findFirst({
      where: eq(ptAbsenceQuota.employeeId, employeeId),
    });
    add(
      "an overdraw is refused and changes nothing",
      !overdraw.ok && quota?.usedHalfDays === daysToUnits(3),
      overdraw.ok ? "overdraw allowed" : overdraw.reason,
    );

    // A half day must be representable without floats.
    await consumeQuota({
      employeeId,
      quotaTypeCode: "ANNUAL",
      year: 2026,
      units: daysToUnits(0.5),
    });
    quota = await db.query.ptAbsenceQuota.findFirst({
      where: eq(ptAbsenceQuota.employeeId, employeeId),
    });
    add(
      "half days are exact",
      quota?.usedHalfDays === 7,
      `used ${formatDays(quota?.usedHalfDays ?? 0)} days as ${quota?.usedHalfDays} half-day units`,
    );

    await restoreQuota({
      employeeId,
      quotaTypeCode: "ANNUAL",
      year: 2026,
      units: daysToUnits(3.5),
    });
    quota = await db.query.ptAbsenceQuota.findFirst({
      where: eq(ptAbsenceQuota.employeeId, employeeId),
    });
    add(
      "restoring puts the days back",
      quota?.usedHalfDays === 0,
      `used ${formatDays(quota?.usedHalfDays ?? 0)} days`,
    );

    const missing = await consumeQuota({
      employeeId,
      quotaTypeCode: "ANNUAL",
      year: 2099,
      units: daysToUnits(1),
    });
    add(
      "consuming a quota that was never granted is refused",
      !missing.ok,
      missing.ok ? "allowed" : missing.reason,
    );
  } catch (err) {
    add("engine threw", false, err instanceof Error ? err.message : String(err));
  } finally {
    if (employeeId) {
      await client.execute({
        sql: "DELETE FROM pa_employee WHERE id = ?",
        args: [employeeId],
      });
    }
  }

  const passed = checks.filter((c) => c.pass).length;
  return NextResponse.json(
    { ok: passed === checks.length, passed, total: checks.length, checks },
    { status: passed === checks.length ? 200 : 500 },
  );
}
