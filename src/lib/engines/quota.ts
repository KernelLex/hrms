import "server-only";
import type { InStatement } from "@libsql/client";
import { and, eq, gte, lte } from "drizzle-orm";
import { db, rawClient } from "@/lib/db";
import { ptHoliday, ptAbsenceQuota, ptQuotaType, ptAbsenceType, now } from "@/db/schema";
import { changeStatement, type Actor } from "@/lib/change-log";
import type { LedgerEntryType } from "@/db/schema";

/**
 * Leave quotas and working-day arithmetic.
 *
 * Balances are held in half-day units rather than fractional days, because a
 * half day is the smallest thing anyone books and storing 0.5 as a float in
 * SQLite invites the same drift that ruins money. One day is two units.
 *
 * Every credit and debit is a ledger entry (`pt_quota_ledger`); the balance
 * on `pt_it2006_absence_quota` is kept as a running total for a fast read,
 * written in the same statement as the ledger row that explains it, never
 * on its own. That is what keeps "a balance always equals its ledger sum"
 * true by construction rather than by convention.
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

/** "That needs 2 days, but only 1 day remains." */
export function shortfall(neededUnits: number, remainingUnits: number): string {
  const days = (units: number) => {
    const text = formatDays(Math.max(0, units));
    return `${text} ${text === "1" ? "day" : "days"}`;
  };
  const left = Math.max(0, remainingUnits);
  return `That needs ${days(neededUnits)}, but only ${days(left)} ${left === 2 ? "remains" : "remain"}.`;
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

export function isWeekend(date: string): boolean {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

export function calendarDaysBetween(from: string, to: string): number {
  if (to < from) return 0;
  return eachDate(from, to).length;
}

/* -------------------------------------------------------------- calendars */

const DEFAULT_CALENDAR = "NATIONAL";

/** The holiday calendar an employee's current (or as-of-date) area sits on. */
export async function calendarFor(employeeId: number, asOf?: string): Promise<string> {
  const date = asOf ?? new Date().toISOString().slice(0, 10);
  const r = await rawClient().execute({
    sql: `SELECT a.calendar_code FROM pa_it0001_org_assignment o
          JOIN om_personnel_area a ON a.code = o.area_code
          WHERE o.employee_id = ? AND o.valid_from <= ? AND o.valid_to >= ?
          ORDER BY o.valid_from DESC LIMIT 1`,
    args: [employeeId, date, date],
  });
  return r.rows[0] ? String(r.rows[0].calendar_code) : DEFAULT_CALENDAR;
}

/**
 * Public holidays in a range, on one calendar, as a set of ISO dates.
 *
 * Optional holidays are left out everywhere a holiday means "nobody works
 * today": they are working days until an employee chooses one, and choosing
 * it is recorded as a paid absence against them alone.
 */
export async function holidaysBetween(from: string, to: string, calendarCode: string): Promise<Set<string>> {
  const rows = await db
    .select({ date: ptHoliday.date })
    .from(ptHoliday)
    .where(
      and(
        eq(ptHoliday.calendarCode, calendarCode),
        eq(ptHoliday.isOptional, false),
        gte(ptHoliday.date, from),
        lte(ptHoliday.date, to),
      ),
    );
  return new Set(rows.map((r) => r.date));
}

/** Every calendar's holidays in a range at once, for batch work over many employees. */
export async function holidaysByCalendar(from: string, to: string): Promise<Map<string, Set<string>>> {
  const rows = await db
    .select({ date: ptHoliday.date, calendarCode: ptHoliday.calendarCode })
    .from(ptHoliday)
    .where(and(eq(ptHoliday.isOptional, false), gte(ptHoliday.date, from), lte(ptHoliday.date, to)));
  const out = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!out.has(r.calendarCode)) out.set(r.calendarCode, new Set());
    out.get(r.calendarCode)!.add(r.date);
  }
  return out;
}

/**
 * Working days in a range, excluding weekends and public holidays.
 *
 * This is what leave actually costs someone: a Friday-to-Monday absence spans
 * four calendar days but two working days, and booking it against a quota at
 * calendar length would quietly overcharge every employee.
 */
export async function workingDaysBetween(from: string, to: string, calendarCode: string): Promise<number> {
  if (to < from) return 0;
  const holidays = await holidaysBetween(from, to, calendarCode);
  return eachDate(from, to).filter((d) => !isWeekend(d) && !holidays.has(d)).length;
}

/** The working dates themselves, for callers that need to walk them. */
export function workingDatesIn(from: string, to: string, holidays: Set<string>): string[] {
  return eachDate(from, to).filter((d) => !isWeekend(d) && !holidays.has(d));
}

/* ------------------------------------------------------------------ ledger */

type Executor = { execute: (s: InStatement) => Promise<{ rows: unknown[]; rowsAffected: number }> };

export type LedgerPost = {
  employeeId: number;
  quotaTypeCode: string;
  year: number;
  entryType: LedgerEntryType;
  /** Signed: positive credits, negative debits. */
  halfDays: number;
  note?: string | null;
  refType?: string | null;
  refId?: string | number | null;
  createdBy: string;
  actor: Actor;
};

/**
 * Writes one ledger entry and moves the summary by the same amount, in the
 * caller's transaction. The one place either table is touched, so the two
 * can never drift apart.
 */
export async function postLedger(tx: Executor, post: LedgerPost): Promise<void> {
  const { employeeId, quotaTypeCode, year, entryType, halfDays, createdBy, actor } = post;
  const at = now();
  await tx.execute({
    sql: `INSERT INTO pt_quota_ledger (employee_id, quota_type_code, year, entry_type, half_days, note, ref_type, ref_id, created_by, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [employeeId, quotaTypeCode, year, entryType, halfDays, post.note ?? null, post.refType ?? null, post.refId ?? null, createdBy, at],
  });

  const existing = await tx.execute({
    sql: "SELECT * FROM pt_it2006_absence_quota WHERE employee_id = ? AND quota_type_code = ? AND year = ?",
    args: [employeeId, quotaTypeCode, year],
  });
  const row = existing.rows[0] as unknown as Record<string, unknown> | undefined;
  const credit = Math.max(0, halfDays);
  const debit = Math.max(0, -halfDays);

  if (!row) {
    const inserted = await tx.execute({
      sql: `INSERT INTO pt_it2006_absence_quota (employee_id, quota_type_code, year, entitled_half_days, used_half_days, created_at)
            VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
      args: [employeeId, quotaTypeCode, year, credit, debit, at],
    });
    const logged = changeStatement(actor, {
      entity: "pt_it2006_absence_quota",
      entityId: Number((inserted.rows[0] as Record<string, unknown>).id),
      subjectEmployeeId: employeeId,
      action: "create",
      after: { employeeId, quotaTypeCode, year, entitledHalfDays: credit, usedHalfDays: debit },
      reason: post.note ?? entryType,
    });
    if (logged) await tx.execute(logged);
    return;
  }

  const before = { entitledHalfDays: Number(row.entitled_half_days), usedHalfDays: Number(row.used_half_days) };
  const after = { entitledHalfDays: before.entitledHalfDays + credit, usedHalfDays: before.usedHalfDays + debit };
  await tx.execute({
    sql: `UPDATE pt_it2006_absence_quota SET entitled_half_days = ?, used_half_days = ? WHERE id = ?`,
    args: [after.entitledHalfDays, after.usedHalfDays, Number(row.id)],
  });
  const logged = changeStatement(actor, {
    entity: "pt_it2006_absence_quota",
    entityId: Number(row.id),
    subjectEmployeeId: employeeId,
    action: "update",
    before,
    after,
    reason: post.note ?? entryType,
  });
  if (logged) await tx.execute(logged);
}

/** The balance on record right now: entitled less used, from the summary. */
export type QuotaBalance = {
  quotaTypeCode: string;
  quotaTypeName: string;
  year: number;
  entitledUnits: number;
  usedUnits: number;
  balanceUnits: number;
};

export async function balancesFor(employeeId: number, year: number): Promise<QuotaBalance[]> {
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

/** The ledger behind one balance, newest first — "why do I have 11.5 days". */
export async function ledgerFor(employeeId: number, quotaTypeCode: string, year: number) {
  const r = await rawClient().execute({
    sql: `SELECT * FROM pt_quota_ledger WHERE employee_id = ? AND quota_type_code = ? AND year = ? ORDER BY created_at DESC, id DESC`,
    args: [employeeId, quotaTypeCode, year],
  });
  return r.rows.map((l) => ({
    id: Number(l.id),
    entryType: String(l.entry_type) as LedgerEntryType,
    halfDays: Number(l.half_days),
    note: l.note === null ? null : String(l.note),
    refType: l.ref_type === null ? null : String(l.ref_type),
    refId: l.ref_id === null ? null : String(l.ref_id),
    createdBy: String(l.created_by),
    createdAt: String(l.created_at),
  }));
}

/* ---------------------------------------------------------- consumption */

/**
 * Takes units from a quota, refusing to overdraw it, inside the caller's
 * transaction. Returns an explanation rather than throwing: the caller is a
 * form (or an approval), and the message needs to reach whoever is filling
 * it in.
 */
export async function consumeQuota(
  tx: Executor,
  opts: { employeeId: number; quotaTypeCode: string; year: number; units: number; refType: string; refId: string | number; createdBy: string; actor: Actor },
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const { employeeId, quotaTypeCode, year, units } = opts;
  if (units <= 0) return { ok: true };

  const quotaRow = await tx.execute({
    sql: "SELECT * FROM pt_it2006_absence_quota WHERE employee_id = ? AND quota_type_code = ? AND year = ?",
    args: [employeeId, quotaTypeCode, year],
  });
  const quota = quotaRow.rows[0] as unknown as Record<string, unknown> | undefined;
  if (!quota) {
    return { ok: false, reason: `No ${quotaTypeCode} entitlement exists for ${year} yet.` };
  }
  const remaining = Number(quota.entitled_half_days) - Number(quota.used_half_days);
  if (units > remaining) {
    return { ok: false, reason: shortfall(units, remaining) };
  }

  // One conditional update, so two consumptions at once cannot overdraw.
  const taken = await tx.execute({
    sql: `UPDATE pt_it2006_absence_quota SET used_half_days = used_half_days + ?1
          WHERE id = ?2 AND entitled_half_days - used_half_days >= ?1`,
    args: [units, Number(quota.id)],
  });
  if (taken.rowsAffected === 0) {
    return { ok: false, reason: "The balance changed a moment ago. Try again." };
  }
  await tx.execute({
    sql: `INSERT INTO pt_quota_ledger (employee_id, quota_type_code, year, entry_type, half_days, ref_type, ref_id, created_by, created_at)
          VALUES (?, ?, ?, 'Use', ?, ?, ?, ?, ?)`,
    args: [employeeId, quotaTypeCode, year, -units, opts.refType, String(opts.refId), opts.createdBy, now()],
  });
  const logged = changeStatement(opts.actor, {
    entity: "pt_it2006_absence_quota",
    entityId: Number(quota.id),
    subjectEmployeeId: employeeId,
    action: "update",
    before: { usedHalfDays: Number(quota.used_half_days) },
    after: { usedHalfDays: Number(quota.used_half_days) + units },
  });
  if (logged) await tx.execute(logged);
  return { ok: true };
}

/** Puts units back, used when an approved leave is cancelled or deleted. */
export async function restoreQuota(
  tx: Executor,
  opts: { employeeId: number; quotaTypeCode: string; year: number; units: number; refType: string; refId: string | number; createdBy: string; actor: Actor },
): Promise<void> {
  const { employeeId, quotaTypeCode, year, units } = opts;
  if (units <= 0) return;

  const quotaRow = await tx.execute({
    sql: "SELECT * FROM pt_it2006_absence_quota WHERE employee_id = ? AND quota_type_code = ? AND year = ?",
    args: [employeeId, quotaTypeCode, year],
  });
  const quota = quotaRow.rows[0] as unknown as Record<string, unknown> | undefined;
  if (!quota) return;

  const restored = Math.min(units, Number(quota.used_half_days));
  if (restored <= 0) return;
  await tx.execute({
    sql: `UPDATE pt_it2006_absence_quota SET used_half_days = max(0, used_half_days - ?) WHERE id = ?`,
    args: [restored, Number(quota.id)],
  });
  await tx.execute({
    sql: `INSERT INTO pt_quota_ledger (employee_id, quota_type_code, year, entry_type, half_days, ref_type, ref_id, created_by, created_at)
          VALUES (?, ?, ?, 'Restore', ?, ?, ?, ?, ?)`,
    args: [employeeId, quotaTypeCode, year, restored, opts.refType, String(opts.refId), opts.createdBy, now()],
  });
  const logged = changeStatement(opts.actor, {
    entity: "pt_it2006_absence_quota",
    entityId: Number(quota.id),
    subjectEmployeeId: employeeId,
    action: "update",
    before: { usedHalfDays: Number(quota.used_half_days) },
    after: { usedHalfDays: Number(quota.used_half_days) - restored },
  });
  if (logged) await tx.execute(logged);
}

/* ---------------------------------------------------------------- policy */

export type LeavePolicyRow = {
  code: string;
  name: string;
  quotaTypeCode: string;
  appliesToGrade: string | null;
  appliesToAreaCode: string | null;
  entitlementHalfDaysPerYear: number;
  accrualFrequency: "Monthly" | "Yearly";
  proRataForJoiners: boolean;
  carryForwardCapHalfDays: number;
  lapseOn: string;
  encashableHalfDaysPerYear: number;
  maxRequestHalfDays: number | null;
  sandwichRule: boolean;
  isActive: boolean;
};

export function rowToPolicy(r: Record<string, unknown>): LeavePolicyRow {
  return {
    code: String(r.code),
    name: String(r.name),
    quotaTypeCode: String(r.quota_type_code),
    appliesToGrade: r.applies_to_grade === null ? null : String(r.applies_to_grade),
    appliesToAreaCode: r.applies_to_area_code === null ? null : String(r.applies_to_area_code),
    entitlementHalfDaysPerYear: Number(r.entitlement_half_days_per_year),
    accrualFrequency: String(r.accrual_frequency) as "Monthly" | "Yearly",
    proRataForJoiners: Number(r.pro_rata_for_joiners) === 1,
    carryForwardCapHalfDays: Number(r.carry_forward_cap_half_days),
    lapseOn: String(r.lapse_on),
    encashableHalfDaysPerYear: Number(r.encashable_half_days_per_year),
    maxRequestHalfDays: r.max_request_half_days === null ? null : Number(r.max_request_half_days),
    sandwichRule: Number(r.sandwich_rule) === 1,
    isActive: Number(r.is_active) === 1,
  };
}

/**
 * Among policies already narrowed to one quota type, the one that governs a
 * grade and area: the one whose grade and area both match beats one that
 * matches on area alone, which beats one that applies to everyone. A policy
 * naming a grade or area the employee does not have never matches. Pure and
 * synchronous, so a batch job can resolve hundreds of employees against
 * facts it already read, rather than one query per employee.
 */
export function matchPolicy(candidates: LeavePolicyRow[], grade: string | null, areaCode: string | null): LeavePolicyRow | null {
  const matching = candidates.filter((p) => (p.appliesToGrade === null || p.appliesToGrade === grade) && (p.appliesToAreaCode === null || p.appliesToAreaCode === areaCode));
  if (matching.length === 0) return null;
  const specificity = (p: LeavePolicyRow) => (p.appliesToGrade ? 1 : 0) + (p.appliesToAreaCode ? 1 : 0);
  matching.sort((a, b) => specificity(b) - specificity(a));
  return matching[0];
}

/** The policy that applies to one employee for a quota type, as of a date. */
export async function policyFor(employeeId: number, quotaTypeCode: string, asOf?: string): Promise<LeavePolicyRow | null> {
  const date = asOf ?? new Date().toISOString().slice(0, 10);
  const facts = await rawClient().execute({
    sql: `SELECT o.area_code, p.pay_scale_group FROM pa_it0001_org_assignment o
          LEFT JOIN pa_it0008_basic_pay p ON p.employee_id = o.employee_id AND p.valid_from <= ?1 AND p.valid_to >= ?1
          WHERE o.employee_id = ?2 AND o.valid_from <= ?1 AND o.valid_to >= ?1
          ORDER BY o.valid_from DESC LIMIT 1`,
    args: [date, employeeId],
  });
  const areaCode = facts.rows[0] ? String(facts.rows[0].area_code) : null;
  const grade = facts.rows[0]?.pay_scale_group ? String(facts.rows[0].pay_scale_group) : null;

  const found = await rawClient().execute({
    sql: "SELECT * FROM pt_leave_policy WHERE quota_type_code = ? AND is_active = 1",
    args: [quotaTypeCode],
  });
  const candidates = found.rows.map((r) => rowToPolicy(r as unknown as Record<string, unknown>));
  return matchPolicy(candidates, grade, areaCode);
}

/* ---------------------------------------------------------- sandwich rule */

function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * The non-working days a sandwich-rule policy pulls into this request
 * because they sit directly between it and another request already waiting
 * or approved on the other side — taking Friday and the following Monday
 * off costs the weekend between them too, not only the two days asked for.
 */
export async function sandwichDays(employeeId: number, absenceTypeCode: string, fromDate: string, toDate: string, calendarCode: string): Promise<number> {
  const type = await db.query.ptAbsenceType.findFirst({ where: eq(ptAbsenceType.code, absenceTypeCode) });
  if (!type?.quotaTypeCode) return 0;
  const policy = await policyFor(employeeId, type.quotaTypeCode, fromDate);
  if (!policy?.sandwichRule) return 0;

  const holidays = await holidaysBetween(shiftDate(fromDate, -14), shiftDate(toDate, 14), calendarCode);
  const isOff = (d: string) => isWeekend(d) || holidays.has(d);

  const gap = async (edge: string, direction: 1 | -1): Promise<number> => {
    let cursor = edge;
    let count = 0;
    while (isOff(cursor) && count < 14) {
      count += 1;
      cursor = shiftDate(cursor, direction);
    }
    if (count === 0) return 0;
    // cursor now sits on the first working day past the gap: does another
    // request of the same quota type already claim it?
    const adjacent = await rawClient().execute({
      sql: `SELECT 1 FROM pt_leave_request lr JOIN pt_absence_type t ON t.code = lr.absence_type_code
            WHERE lr.employee_id = ? AND t.quota_type_code = ? AND lr.status IN ('Pending', 'Approved')
              AND ? BETWEEN lr.from_date AND lr.to_date LIMIT 1`,
      args: [employeeId, type.quotaTypeCode, cursor],
    });
    return adjacent.rows.length > 0 ? count : 0;
  };

  const before = await gap(shiftDate(fromDate, -1), -1);
  const after = await gap(shiftDate(toDate, 1), 1);
  return before + after;
}
