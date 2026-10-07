import "server-only";
import type { InStatement } from "@libsql/client";
import { rawClient } from "@/lib/db";
import { now } from "@/db/schema";
import { changeStatement, type Actor } from "@/lib/change-log";
import { calendarFor, workingDaysBetween } from "./quota";

/**
 * Shifts, rosters and punches.
 *
 * A roster is generated from a pattern — a repeating cycle of shifts, one
 * per day of it — then edited by exception. A day's punches, read against
 * that roster, become one `pt_attendance_day` row: first in, last out,
 * worked minutes, a late mark if the first punch missed the shift's grace
 * period by more than it allows, and overtime past the shift's own length.
 * A night shift's punches span midnight, so its day is read from its own
 * start to its own end, not one calendar day — and it belongs to the day
 * it started. Overtime is logged as a `pt_it2002_attendance` "Overtime" row,
 * for the record and for time evaluation's own total, and paid at double
 * the hourly rate as an IT0015 one-off payment — the same table leave
 * encashment uses, so payroll pays it through the next run with no
 * overtime-specific code of its own.
 */

type Executor = { execute: (s: InStatement) => Promise<{ rows: unknown[]; rowsAffected: number }> };
const OVERTIME_MULTIPLE = 2;

/* ------------------------------------------------------------------ shifts */

export type ShiftRow = {
  code: string;
  name: string;
  startTime: string;
  endTime: string;
  breakMinutes: number;
  isNight: boolean;
  graceMinutes: number;
  isActive: boolean;
};

function rowToShift(r: Record<string, unknown>): ShiftRow {
  return {
    code: String(r.code),
    name: String(r.name),
    startTime: String(r.start_time),
    endTime: String(r.end_time),
    breakMinutes: Number(r.break_minutes),
    isNight: Number(r.is_night) === 1,
    graceMinutes: Number(r.grace_minutes),
    isActive: Number(r.is_active) === 1,
  };
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** A shift's scheduled length, in minutes, less its break — handling a night shift's wrap past midnight. */
export function scheduledMinutes(shift: Pick<ShiftRow, "startTime" | "endTime" | "breakMinutes">): number {
  const start = toMinutes(shift.startTime);
  const end = toMinutes(shift.endTime);
  const span = end > start ? end - start : 24 * 60 - start + end;
  return Math.max(0, span - shift.breakMinutes);
}

/* ---------------------------------------------------------------- rosters */

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  return Math.round((new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86_400_000);
}

/**
 * Midnight in India, as the same UTC-normalised ISO string a stored punch
 * has — a punch's day is read the same way every other date in this system
 * is. Returned in `Z` form, not `+05:30`, because pt_punch.at is stored that
 * way and SQLite compares text, not instants: mixed formats would not sort.
 */
function istMidnight(date: string): string {
  return new Date(`${date}T00:00:00+05:30`).toISOString();
}

/**
 * Applies a pattern to a team over a date range: day 0 of the cycle is
 * `fromDate` itself, so the same team, the same pattern, generated again
 * from the same start date, writes the same roster — safe to re-run.
 */
export async function generateRoster(
  tx: Executor,
  opts: { patternCode: string; employeeIds: number[]; fromDate: string; toDate: string; createdBy: string },
): Promise<{ days: number }> {
  const { patternCode, employeeIds, fromDate, toDate, createdBy } = opts;
  if (employeeIds.length === 0 || toDate < fromDate) return { days: 0 };

  const pattern = await rawClient().execute({ sql: "SELECT cycle_length_days FROM pt_roster_pattern WHERE code = ? AND is_active = 1", args: [patternCode] });
  if (pattern.rows.length === 0) throw new Error(`No active roster pattern ${patternCode}.`);
  const cycleLength = Number(pattern.rows[0].cycle_length_days);

  const patternDays = await rawClient().execute({ sql: "SELECT day_index, shift_code FROM pt_roster_pattern_day WHERE pattern_code = ?", args: [patternCode] });
  const shiftOf = new Map(patternDays.rows.map((r) => [Number(r.day_index), r.shift_code === null ? null : String(r.shift_code)]));

  const at = now();
  let days = 0;
  for (const employeeId of employeeIds) {
    for (let d = fromDate; d <= toDate; d = addDays(d, 1)) {
      const dayIndex = ((daysBetween(fromDate, d) % cycleLength) + cycleLength) % cycleLength;
      const shiftCode = shiftOf.get(dayIndex) ?? null;
      await tx.execute({
        sql: `INSERT INTO pt_roster (employee_id, date, shift_code, pattern_code, created_by, created_at)
              VALUES (?, ?, ?, ?, ?, ?)
              ON CONFLICT (employee_id, date) DO UPDATE SET shift_code = excluded.shift_code, pattern_code = excluded.pattern_code`,
        args: [employeeId, d, shiftCode, patternCode, createdBy, at],
      });
      days += 1;
    }
  }
  return { days };
}

/** One roster day, edited by exception — a swap, a one-off day off. */
export async function setRosterDay(
  tx: Executor,
  opts: { employeeId: number; date: string; shiftCode: string | null; createdBy: string },
): Promise<void> {
  await tx.execute({
    sql: `INSERT INTO pt_roster (employee_id, date, shift_code, pattern_code, created_by, created_at)
          VALUES (?, ?, ?, NULL, ?, ?)
          ON CONFLICT (employee_id, date) DO UPDATE SET shift_code = excluded.shift_code, pattern_code = NULL`,
    args: [opts.employeeId, opts.date, opts.shiftCode, opts.createdBy, now()],
  });
}

/* ----------------------------------------------------------------- punches */

export type PunchInput = {
  employeeId: number;
  deviceCode: string;
  at: string;
  direction: "In" | "Out";
  /** Where it came from: a clock, a CSV, the app itself, or an approved correction. */
  source: "Device" | "Csv" | "Web" | "Regularised";
};

/**
 * Writes punches, skipping any already on record for that device, time and
 * employee — a re-sent batch, or a re-uploaded CSV, does nothing the second
 * time.
 */
export async function recordPunches(tx: Executor, punches: PunchInput[]): Promise<{ written: number; skipped: number }> {
  const at = now();
  let written = 0;
  for (const p of punches) {
    const r = await tx.execute({
      sql: `INSERT INTO pt_punch (employee_id, device_code, at, direction, source, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT (device_code, at, employee_id) DO NOTHING`,
      args: [p.employeeId, p.deviceCode, p.at, p.direction, p.source, at],
    });
    if (r.rowsAffected > 0) written += 1;
  }
  return { written, skipped: punches.length - written };
}

/* ------------------------------------------------------- daily attendance */

export type AttendanceDayResult = {
  employeeId: number;
  date: string;
  shiftCode: string;
  firstIn: string | null;
  lastOut: string | null;
  workedMinutes: number;
  lateMinutes: number;
  overtimeMinutes: number;
  status: "Present" | "Late" | "HalfDay" | "Absent";
};

function computeDay(shift: ShiftRow, date: string, punches: { at: string; direction: string }[]): AttendanceDayResult {
  const ins = punches.filter((p) => p.direction === "In").map((p) => p.at).sort();
  const outs = punches.filter((p) => p.direction === "Out").map((p) => p.at).sort();
  const firstIn = ins[0] ?? null;
  const lastOut = outs.length > 0 ? outs[outs.length - 1] : null;

  const scheduled = scheduledMinutes(shift);
  let workedMinutes = 0;
  if (firstIn && lastOut && lastOut > firstIn) {
    const minutes = Math.round((new Date(lastOut).getTime() - new Date(firstIn).getTime()) / 60_000);
    workedMinutes = Math.max(0, minutes - shift.breakMinutes);
  }

  let lateMinutes = 0;
  if (firstIn) {
    // The shift's own start time is India time, like every other clock time
    // in this system; +05:30 converts it to the same UTC instant a punch is
    // stored in.
    const scheduledStart = new Date(`${date}T${shift.startTime}:00+05:30`).getTime();
    const actualStart = new Date(firstIn).getTime();
    const diff = Math.round((actualStart - scheduledStart) / 60_000);
    lateMinutes = Math.max(0, diff - shift.graceMinutes);
  }

  const overtimeMinutes = Math.max(0, workedMinutes - scheduled);

  const status: AttendanceDayResult["status"] =
    !firstIn && !lastOut ? "Absent" : workedMinutes < scheduled / 2 ? "HalfDay" : lateMinutes > 0 ? "Late" : "Present";

  return { employeeId: 0, date, shiftCode: shift.code, firstIn, lastOut, workedMinutes, lateMinutes, overtimeMinutes, status };
}

/**
 * Turns punches for a batch of rostered days into `pt_attendance_day` rows,
 * everything read once up front — the roster, the shifts, the punches — so
 * this scales with how many people are due a day, not with a query each.
 * Overtime is also written as an "0800 Overtime" pt_it2002_attendance row,
 * replacing whatever this same job wrote there last time, so time evaluation
 * and payroll need no punch-specific code of their own.
 */
export async function runDailyAttendance(
  tx: Executor,
  opts: { date: string; employeeIds?: number[]; actor: Actor },
): Promise<{ finalised: number }> {
  const { date, actor } = opts;
  const only = opts.employeeIds?.length ? opts.employeeIds : null;

  const rosterR = await rawClient().execute({
    sql: `SELECT employee_id, shift_code FROM pt_roster
          WHERE date = ? AND shift_code IS NOT NULL ${only ? `AND employee_id IN (${only.map(() => "?").join(", ")})` : ""}`,
    args: only ? [date, ...only] : [date],
  });
  if (rosterR.rows.length === 0) return { finalised: 0 };

  const shiftCodes = [...new Set(rosterR.rows.map((r) => String(r.shift_code)))];
  const shiftsR = await rawClient().execute({
    sql: `SELECT * FROM pt_shift WHERE code IN (${shiftCodes.map(() => "?").join(", ")})`,
    args: shiftCodes,
  });
  const shiftOf = new Map(shiftsR.rows.map((r) => [String(r.code), rowToShift(r as unknown as Record<string, unknown>)]));

  const isNightAny = shiftsR.rows.some((r) => Number(r.is_night) === 1);
  const windowTo = isNightAny ? addDays(date, 1) : date;
  const employeeIds = rosterR.rows.map((r) => Number(r.employee_id));
  const punchesR = await rawClient().execute({
    sql: `SELECT employee_id, at, direction FROM pt_punch
          WHERE at >= ? AND at < ? AND employee_id IN (${employeeIds.map(() => "?").join(", ")})`,
    args: [istMidnight(date), istMidnight(addDays(windowTo, 1)), ...employeeIds],
  });
  const punchesOf = new Map<number, { at: string; direction: string }[]>();
  for (const r of punchesR.rows) {
    const id = Number(r.employee_id);
    if (!punchesOf.has(id)) punchesOf.set(id, []);
    punchesOf.get(id)!.push({ at: String(r.at), direction: String(r.direction) });
  }

  const finalisedAt = now();
  let finalised = 0;
  for (const r of rosterR.rows) {
    const employeeId = Number(r.employee_id);
    const shift = shiftOf.get(String(r.shift_code));
    if (!shift) continue;
    const result = computeDay(shift, date, punchesOf.get(employeeId) ?? []);
    await postAttendanceDay(tx, { ...result, employeeId }, finalisedAt, actor);
    finalised += 1;
  }
  return { finalised };
}

/** The same computation, for one employee's one day — used to re-finalise after a regularisation. */
export async function finalizeAttendanceDay(tx: Executor, employeeId: number, date: string, actor: Actor): Promise<AttendanceDayResult | null> {
  // Read through tx, not the shared connection: a caller (a regularisation
  // being approved) may have just written this day's punches in this same
  // transaction, uncommitted and so invisible anywhere else.
  const rosterR = await tx.execute({ sql: "SELECT shift_code FROM pt_roster WHERE employee_id = ? AND date = ?", args: [employeeId, date] });
  const shiftCode = (rosterR.rows[0] as Record<string, unknown> | undefined)?.shift_code;
  if (!shiftCode) return null;
  const shiftR = await tx.execute({ sql: "SELECT * FROM pt_shift WHERE code = ?", args: [String(shiftCode)] });
  if (shiftR.rows.length === 0) return null;
  const shift = rowToShift(shiftR.rows[0] as unknown as Record<string, unknown>);

  const windowTo = shift.isNight ? addDays(date, 1) : date;
  const punchesR = await tx.execute({
    sql: "SELECT at, direction FROM pt_punch WHERE employee_id = ? AND at >= ? AND at < ?",
    args: [employeeId, istMidnight(date), istMidnight(addDays(windowTo, 1))],
  });
  const result = computeDay(
    shift,
    date,
    (punchesR.rows as unknown as Record<string, unknown>[]).map((r) => ({ at: String(r.at), direction: String(r.direction) })),
  );
  await postAttendanceDay(tx, { ...result, employeeId }, now(), actor);
  return { ...result, employeeId };
}

async function postAttendanceDay(tx: Executor, r: AttendanceDayResult, finalisedAt: string, actor: Actor): Promise<void> {
  const before = await tx.execute({ sql: "SELECT * FROM pt_attendance_day WHERE employee_id = ? AND date = ?", args: [r.employeeId, r.date] });
  const beforeRow = before.rows[0] as unknown as Record<string, unknown> | undefined;

  const inserted = await tx.execute({
    sql: `INSERT INTO pt_attendance_day (employee_id, date, shift_code, first_in, last_out, worked_minutes, late_minutes, overtime_minutes, status, finalised_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (employee_id, date) DO UPDATE SET
            shift_code = excluded.shift_code, first_in = excluded.first_in, last_out = excluded.last_out,
            worked_minutes = excluded.worked_minutes, late_minutes = excluded.late_minutes,
            overtime_minutes = excluded.overtime_minutes, status = excluded.status, finalised_at = excluded.finalised_at
          RETURNING id`,
    args: [r.employeeId, r.date, r.shiftCode, r.firstIn, r.lastOut, r.workedMinutes, r.lateMinutes, r.overtimeMinutes, r.status, finalisedAt],
  });
  const id = Number((inserted.rows[0] as Record<string, unknown>).id);
  const logged = changeStatement(actor, {
    entity: "pt_attendance_day",
    entityId: id,
    subjectEmployeeId: r.employeeId,
    action: beforeRow ? "update" : "create",
    before: beforeRow,
    after: { employeeId: r.employeeId, date: r.date, status: r.status, workedMinutes: r.workedMinutes, lateMinutes: r.lateMinutes, overtimeMinutes: r.overtimeMinutes },
  });
  if (logged) await tx.execute(logged);

  // Logged for the record, and for time evaluation's own total: replace
  // whatever this job wrote here last time with what the punches say now.
  await tx.execute({
    sql: "DELETE FROM pt_it2002_attendance WHERE employee_id = ? AND date = ? AND attendance_type_code = '0800' AND remarks = 'Auto: from punches'",
    args: [r.employeeId, r.date],
  });
  // Not yet paid: a run that already paid this day's overtime keeps what it paid.
  await tx.execute({
    sql: "DELETE FROM py_it0015_additional_payment WHERE employee_id = ? AND payment_date = ? AND wage_type_code = 'OT' AND paid_run_id IS NULL",
    args: [r.employeeId, r.date],
  });
  if (r.overtimeMinutes > 0) {
    await tx.execute({
      sql: `INSERT INTO pt_it2002_attendance (employee_id, attendance_type_code, date, hours, remarks, created_by, created_at)
            VALUES (?, '0800', ?, ?, 'Auto: from punches', 'system', ?)`,
      args: [r.employeeId, r.date, Math.round(r.overtimeMinutes / 60), finalisedAt],
    });

    const rate = await hourlyRatePaise(r.employeeId, r.date);
    const amountPaise = Math.round((rate * OVERTIME_MULTIPLE * r.overtimeMinutes) / 60);
    if (amountPaise > 0) {
      await tx.execute({
        sql: `INSERT INTO py_it0015_additional_payment (employee_id, wage_type_code, amount_paise, payment_date, created_at)
              VALUES (?, 'OT', ?, ?, ?)`,
        args: [r.employeeId, amountPaise, r.date, finalisedAt],
      });
    }
  }
}

/** Basic pay over a month's working days, over an 8-hour day — the same reference an overtime multiple is quoted against. */
async function hourlyRatePaise(employeeId: number, date: string): Promise<number> {
  const basic = await rawClient().execute({
    sql: "SELECT amount_paise FROM pa_it0008_basic_pay WHERE employee_id = ? AND valid_from <= ? AND valid_to >= ? ORDER BY valid_from DESC LIMIT 1",
    args: [employeeId, date, date],
  });
  const basicPaise = basic.rows[0] ? Number(basic.rows[0].amount_paise) : 0;
  if (basicPaise === 0) return 0;

  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const monthStart = monthStartOf(year, month);
  const monthEnd = monthEndOf(year, month);
  const calendarCode = await calendarFor(employeeId, date);
  const workingDays = await workingDaysBetween(monthStart, monthEnd, calendarCode);
  return workingDays > 0 ? Math.round(basicPaise / workingDays / 8) : 0;
}

function monthStartOf(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}-01`;
}
function monthEndOf(year: number, month: number): string {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
}
