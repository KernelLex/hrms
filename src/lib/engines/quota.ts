import "server-only";
import { and, eq, gte, lte } from "drizzle-orm";
import { db } from "@/lib/db";
import { ptHoliday, ptAbsenceQuota, ptQuotaType, paEmployee, now } from "@/db/schema";

/**
 * Leave quotas and working-day arithmetic.
 *
 * Balances are held in half-day units rather than fractional days, because a
 * half day is the smallest thing anyone books and storing 0.5 as a float in
 * SQLite invites the same drift that ruins money. One day is two units.
 */

export const UNITS_PER_DAY = 2;

export function daysToUnits(days: number): number {
  return Math.round(days * UNITS_PER_DAY);
}

export function unitsToDays(units: number): number {
  return units / UNITS_PER_DAY;
}

/** Formats a half-day count the way people say it: "3", "3.5", "0.5". */
export function formatDays(units: number): string {
  const days = unitsToDays(units);
  return Number.isInteger(days) ? String(days) : days.toFixed(1);
}

function eachDate(from: string, to: string): string[] {
  const out: string[] = [];
  const cursor = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (cursor <= end) {
    out.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

function isWeekend(date: string): boolean {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

/** Public holidays in a range, as a set of ISO dates. */
export async function holidaysBetween(from: string, to: string): Promise<Set<string>> {
  const rows = await db
    .select({ date: ptHoliday.date })
    .from(ptHoliday)
    .where(and(gte(ptHoliday.date, from), lte(ptHoliday.date, to)));
  return new Set(rows.map((r) => r.date));
}

/**
 * Working days in a range, excluding weekends and public holidays.
 *
 * This is what leave actually costs someone: a Friday-to-Monday absence spans
 * four calendar days but two working days, and booking it against a quota at
 * calendar length would quietly overcharge every employee.
 */
export async function workingDaysBetween(from: string, to: string): Promise<number> {
  if (to < from) return 0;
  const holidays = await holidaysBetween(from, to);
  return eachDate(from, to).filter((d) => !isWeekend(d) && !holidays.has(d)).length;
}

export function calendarDaysBetween(from: string, to: string): number {
  if (to < from) return 0;
  return eachDate(from, to).length;
}

/* ------------------------------------------------------------- generation */

/**
 * Grants entitlement for a year. Re-running is safe: an existing quota keeps
 * whatever has already been used and only its entitlement is adjusted.
 */
export async function generateQuotas(opts: {
  year: number;
  quotaTypeCode: string;
  entitlementDays: number;
  employeeIds?: number[];
}): Promise<number> {
  const { year, quotaTypeCode, entitlementDays } = opts;

  const employees = await db.select({ id: paEmployee.id }).from(paEmployee);
  const wanted = opts.employeeIds;
  const targets = wanted?.length ? employees.filter((e) => wanted.includes(e.id)) : employees;

  const createdAt = now();
  let affected = 0;

  for (const e of targets) {
    const existing = await db.query.ptAbsenceQuota.findFirst({
      where: and(
        eq(ptAbsenceQuota.employeeId, e.id),
        eq(ptAbsenceQuota.quotaTypeCode, quotaTypeCode),
        eq(ptAbsenceQuota.year, year),
      ),
    });

    if (existing) {
      await db
        .update(ptAbsenceQuota)
        .set({ entitledHalfDays: daysToUnits(entitlementDays) })
        .where(eq(ptAbsenceQuota.id, existing.id));
    } else {
      await db.insert(ptAbsenceQuota).values({
        employeeId: e.id,
        quotaTypeCode,
        year,
        entitledHalfDays: daysToUnits(entitlementDays),
        usedHalfDays: 0,
        createdAt,
      });
    }
    affected += 1;
  }

  return affected;
}

/* ---------------------------------------------------------- consumption */

export type QuotaBalance = {
  quotaTypeCode: string;
  quotaTypeName: string;
  year: number;
  entitledUnits: number;
  usedUnits: number;
  balanceUnits: number;
};

export async function balancesFor(
  employeeId: number,
  year: number,
): Promise<QuotaBalance[]> {
  const rows = await db
    .select({
      quotaTypeCode: ptAbsenceQuota.quotaTypeCode,
      quotaTypeName: ptQuotaType.name,
      year: ptAbsenceQuota.year,
      entitled: ptAbsenceQuota.entitledHalfDays,
      used: ptAbsenceQuota.usedHalfDays,
    })
    .from(ptAbsenceQuota)
    .innerJoin(ptQuotaType, eq(ptQuotaType.code, ptAbsenceQuota.quotaTypeCode))
    .where(and(eq(ptAbsenceQuota.employeeId, employeeId), eq(ptAbsenceQuota.year, year)));

  return rows.map((r) => ({
    quotaTypeCode: r.quotaTypeCode,
    quotaTypeName: r.quotaTypeName,
    year: r.year,
    entitledUnits: r.entitled,
    usedUnits: r.used,
    balanceUnits: r.entitled - r.used,
  }));
}

/**
 * Takes units from a quota, refusing to overdraw it.
 *
 * Returns an explanation rather than throwing, because the caller is a form
 * and the message needs to reach the person filling it in.
 */
export async function consumeQuota(opts: {
  employeeId: number;
  quotaTypeCode: string;
  year: number;
  units: number;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const { employeeId, quotaTypeCode, year, units } = opts;
  if (units <= 0) return { ok: true };

  const quota = await db.query.ptAbsenceQuota.findFirst({
    where: and(
      eq(ptAbsenceQuota.employeeId, employeeId),
      eq(ptAbsenceQuota.quotaTypeCode, quotaTypeCode),
      eq(ptAbsenceQuota.year, year),
    ),
  });

  if (!quota) {
    return {
      ok: false,
      reason: `No ${quotaTypeCode} entitlement exists for ${year}. Generate the quota first.`,
    };
  }

  const remaining = quota.entitledHalfDays - quota.usedHalfDays;
  if (units > remaining) {
    return {
      ok: false,
      reason: `That needs ${formatDays(units)} days but only ${formatDays(remaining)} remain.`,
    };
  }

  await db
    .update(ptAbsenceQuota)
    .set({ usedHalfDays: quota.usedHalfDays + units })
    .where(eq(ptAbsenceQuota.id, quota.id));

  return { ok: true };
}

/** Puts units back, used when an approved leave is cancelled or deleted. */
export async function restoreQuota(opts: {
  employeeId: number;
  quotaTypeCode: string;
  year: number;
  units: number;
}): Promise<void> {
  const { employeeId, quotaTypeCode, year, units } = opts;
  if (units <= 0) return;

  const quota = await db.query.ptAbsenceQuota.findFirst({
    where: and(
      eq(ptAbsenceQuota.employeeId, employeeId),
      eq(ptAbsenceQuota.quotaTypeCode, quotaTypeCode),
      eq(ptAbsenceQuota.year, year),
    ),
  });
  if (!quota) return;

  await db
    .update(ptAbsenceQuota)
    .set({ usedHalfDays: Math.max(0, quota.usedHalfDays - units) })
    .where(eq(ptAbsenceQuota.id, quota.id));
}
