import "server-only";
import { sql } from "drizzle-orm";
import { db, rawClient } from "@/lib/db";
import { ptTimeEvaluation, now } from "@/db/schema";

/**
 * Time evaluation, equivalent to SAP's PT60.
 *
 * Turns raw absence and attendance records into the per-period totals a
 * manager or payroll clerk reads: working days, days present and absent,
 * unpaid days and overtime. Payroll computes its own unpaid days from the same
 * absences, date by date, so the two always agree.
 *
 * Working days come from each employee's own holiday calendar, by their
 * personnel area at the end of the period — a plant in Maharashtra and the
 * head office in Karnataka can have a different working-day count for the
 * same month. The whole period is still read in a handful of statements,
 * however many calendars are in play, and written back in one upsert.
 */

export type EvaluationRow = {
  employeeId: number;
  employeeNumber: string;
  workingDays: number;
  presentDays: number;
  absentDays: number;
  unpaidDays: number;
  overtimeHours: number;
};

const DEFAULT_CALENDAR = "NATIONAL";

function monthRange(year: number, month: number): { from: string; to: string } {
  const from = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const to = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return { from, to };
}

function workingDates(from: string, to: string, holidays: Set<string>): string[] {
  const out: string[] = [];
  const cursor = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (cursor <= end) {
    const d = cursor.toISOString().slice(0, 10);
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6 && !holidays.has(d)) out.push(d);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

export async function evaluatePeriod(opts: {
  year: number;
  month: number;
  employeeIds?: number[];
  persist?: boolean;
}): Promise<EvaluationRow[]> {
  const { year, month, persist = true } = opts;
  const { from, to } = monthRange(year, month);
  const only = opts.employeeIds?.length ? opts.employeeIds : null;
  const filter = only ? `AND employee_id IN (${only.map(() => "?").join(", ")})` : "";
  const ids = only ?? [];

  const [calendars, holidays, employees, absences, attendance] = await rawClient().batch(
    [
      {
        sql: `SELECT o.employee_id, a.calendar_code FROM pa_it0001_org_assignment o
              JOIN om_personnel_area a ON a.code = o.area_code
              WHERE o.valid_from <= ? AND o.valid_to >= ? ${only ? `AND o.employee_id IN (${only.map(() => "?").join(", ")})` : ""}`,
        args: [to, to, ...ids],
      },
      { sql: "SELECT date, calendar_code FROM pt_holiday WHERE is_optional = 0 AND date BETWEEN ? AND ?", args: [from, to] },
      {
        // Everyone employed at some point in the month.
        sql: `SELECT id, employee_number, hire_date, termination_date FROM pa_employee
              WHERE hire_date <= ? AND (termination_date IS NULL OR termination_date >= ?)
              ${only ? `AND id IN (${only.map(() => "?").join(", ")})` : ""}
              ORDER BY employee_number`,
        args: [to, from, ...ids],
      },
      {
        sql: `SELECT a.employee_id, a.start_date, a.end_date, a.is_half_day, t.is_paid
              FROM pt_it2001_absence a JOIN pt_absence_type t ON t.code = a.absence_type_code
              WHERE a.start_date <= ? AND a.end_date >= ? ${filter.replace("employee_id", "a.employee_id")}`,
        args: [to, from, ...ids],
      },
      {
        sql: `SELECT a.employee_id, SUM(a.hours) AS hours
              FROM pt_it2002_attendance a
              JOIN pt_attendance_type t ON t.code = a.attendance_type_code AND t.is_overtime = 1
              WHERE a.date BETWEEN ? AND ? ${filter.replace("employee_id", "a.employee_id")}
              GROUP BY a.employee_id`,
        args: [from, to, ...ids],
      },
    ],
    "read",
  );

  const calendarOf = new Map(calendars.rows.map((r) => [Number(r.employee_id), String(r.calendar_code)]));
  const holidaysByCalendar = new Map<string, Set<string>>();
  for (const h of holidays.rows) {
    const code = String(h.calendar_code);
    if (!holidaysByCalendar.has(code)) holidaysByCalendar.set(code, new Set());
    holidaysByCalendar.get(code)!.add(String(h.date));
  }
  const datesByCalendar = new Map<string, string[]>();
  const workingDatesFor = (calendarCode: string): string[] => {
    if (!datesByCalendar.has(calendarCode)) {
      datesByCalendar.set(calendarCode, workingDates(from, to, holidaysByCalendar.get(calendarCode) ?? new Set()));
    }
    return datesByCalendar.get(calendarCode)!;
  };

  const overtimeOf = new Map(attendance.rows.map((r) => [Number(r.employee_id), Number(r.hours)]));
  const absencesOf = new Map<number, typeof absences.rows>();
  for (const a of absences.rows) {
    const list = absencesOf.get(Number(a.employee_id)) ?? [];
    list.push(a);
    absencesOf.set(Number(a.employee_id), list);
  }

  const results: EvaluationRow[] = employees.rows.map((e) => {
    const id = Number(e.id);
    const periodDates = workingDatesFor(calendarOf.get(id) ?? DEFAULT_CALENDAR);
    const windowFrom = String(e.hire_date) > from ? String(e.hire_date) : from;
    const windowTo =
      e.termination_date && String(e.termination_date) < to ? String(e.termination_date) : to;
    const employed = periodDates.filter((d) => d >= windowFrom && d <= windowTo);

    // Each working day counts once, however many absences cover it.
    const absent = new Map<string, { share: number; unpaid: boolean }>();
    for (const a of absencesOf.get(id) ?? []) {
      const start = String(a.start_date);
      const end = String(a.end_date);
      const half = Number(a.is_half_day) === 1;
      for (const d of employed) {
        if (d < start || d > end || (half && d !== start)) continue;
        const prev = absent.get(d);
        absent.set(d, {
          share: Math.min(1, (prev?.share ?? 0) + (half ? 0.5 : 1)),
          unpaid: (prev?.unpaid ?? false) || Number(a.is_paid) !== 1,
        });
      }
    }
    const absentDays = [...absent.values()].reduce((s, v) => s + v.share, 0);
    const unpaidDays = [...absent.values()].filter((v) => v.unpaid).reduce((s, v) => s + v.share, 0);

    return {
      employeeId: id,
      employeeNumber: String(e.employee_number),
      workingDays: employed.length,
      presentDays: Math.max(0, employed.length - absentDays),
      absentDays,
      unpaidDays,
      overtimeHours: overtimeOf.get(id) ?? 0,
    };
  });

  if (persist && results.length > 0) {
    const evaluatedAt = now();
    await db
      .insert(ptTimeEvaluation)
      .values(
        results.map((r) => ({
          employeeId: r.employeeId,
          periodYear: year,
          periodMonth: month,
          workingDays: r.workingDays,
          presentDays: Math.round(r.presentDays),
          absentDays: Math.round(r.absentDays),
          unpaidDays: Math.round(r.unpaidDays),
          overtimeHours: r.overtimeHours,
          evaluatedAt,
        })),
      )
      .onConflictDoUpdate({
        target: [ptTimeEvaluation.employeeId, ptTimeEvaluation.periodYear, ptTimeEvaluation.periodMonth],
        set: {
          workingDays: sql`excluded.working_days`,
          presentDays: sql`excluded.present_days`,
          absentDays: sql`excluded.absent_days`,
          unpaidDays: sql`excluded.unpaid_days`,
          overtimeHours: sql`excluded.overtime_hours`,
          evaluatedAt: sql`excluded.evaluated_at`,
        },
      });
  }

  return results;
}
