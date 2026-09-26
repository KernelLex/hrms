import "server-only";
import { and, eq, gte, lte } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  ptAbsence,
  ptAbsenceType,
  ptAttendance,
  ptAttendanceType,
  ptTimeEvaluation,
  paEmployee,
  now,
} from "@/db/schema";
import { workingDaysBetween } from "./quota";

/**
 * Time evaluation, equivalent to SAP's PT60.
 *
 * Turns raw absence and attendance records into the per-period totals payroll
 * needs. The number that matters downstream is `unpaidDays` — payroll prorates
 * basic pay against it, so an unpaid absence actually costs the employee money
 * rather than just appearing on a report.
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

function monthRange(year: number, month: number): { from: string; to: string } {
  const from = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const to = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return { from, to };
}

/** Overlap between an absence and the period, in working days. */
async function absentWorkingDaysInPeriod(
  absenceStart: string,
  absenceEnd: string,
  periodFrom: string,
  periodTo: string,
): Promise<number> {
  const from = absenceStart > periodFrom ? absenceStart : periodFrom;
  const to = absenceEnd < periodTo ? absenceEnd : periodTo;
  if (to < from) return 0;
  return workingDaysBetween(from, to);
}

export async function evaluatePeriod(opts: {
  year: number;
  month: number;
  employeeIds?: number[];
  persist?: boolean;
}): Promise<EvaluationRow[]> {
  const { year, month, persist = true } = opts;
  const { from, to } = monthRange(year, month);
  const workingDays = await workingDaysBetween(from, to);

  const employees = await db
    .select({ id: paEmployee.id, number: paEmployee.employeeNumber })
    .from(paEmployee);
  const targets = opts.employeeIds?.length
    ? employees.filter((e) => opts.employeeIds!.includes(e.id))
    : employees;

  const results: EvaluationRow[] = [];
  const evaluatedAt = now();

  for (const e of targets) {
    const absences = await db
      .select({
        startDate: ptAbsence.startDate,
        endDate: ptAbsence.endDate,
        isHalfDay: ptAbsence.isHalfDay,
        isPaid: ptAbsenceType.isPaid,
      })
      .from(ptAbsence)
      .innerJoin(ptAbsenceType, eq(ptAbsenceType.code, ptAbsence.absenceTypeCode))
      .where(
        and(
          eq(ptAbsence.employeeId, e.id),
          lte(ptAbsence.startDate, to),
          gte(ptAbsence.endDate, from),
        ),
      );

    let absentDays = 0;
    let unpaidDays = 0;
    for (const a of absences) {
      const days = a.isHalfDay
        ? 0.5
        : await absentWorkingDaysInPeriod(a.startDate, a.endDate, from, to);
      absentDays += days;
      if (!a.isPaid) unpaidDays += days;
    }

    const overtime = await db
      .select({ hours: ptAttendance.hours, isOvertime: ptAttendanceType.isOvertime })
      .from(ptAttendance)
      .innerJoin(
        ptAttendanceType,
        eq(ptAttendanceType.code, ptAttendance.attendanceTypeCode),
      )
      .where(
        and(
          eq(ptAttendance.employeeId, e.id),
          gte(ptAttendance.date, from),
          lte(ptAttendance.date, to),
        ),
      );

    const overtimeHours = overtime
      .filter((o) => o.isOvertime)
      .reduce((sum, o) => sum + o.hours, 0);

    const row: EvaluationRow = {
      employeeId: e.id,
      employeeNumber: e.number,
      workingDays,
      presentDays: Math.max(0, workingDays - absentDays),
      absentDays,
      unpaidDays,
      overtimeHours,
    };
    results.push(row);

    if (persist) {
      const existing = await db.query.ptTimeEvaluation.findFirst({
        where: and(
          eq(ptTimeEvaluation.employeeId, e.id),
          eq(ptTimeEvaluation.periodYear, year),
          eq(ptTimeEvaluation.periodMonth, month),
        ),
      });
      const values = {
        employeeId: e.id,
        periodYear: year,
        periodMonth: month,
        workingDays,
        presentDays: Math.round(row.presentDays),
        absentDays: Math.round(row.absentDays),
        unpaidDays: Math.round(row.unpaidDays),
        overtimeHours,
        evaluatedAt,
      };
      if (existing) {
        await db
          .update(ptTimeEvaluation)
          .set(values)
          .where(eq(ptTimeEvaluation.id, existing.id));
      } else {
        await db.insert(ptTimeEvaluation).values(values);
      }
    }
  }

  return results;
}

/** Unpaid working days in a period — what payroll prorates against. */
export async function unpaidDaysInPeriod(
  employeeId: number,
  year: number,
  month: number,
): Promise<{ unpaidDays: number; workingDays: number }> {
  const [row] = await evaluatePeriod({
    year,
    month,
    employeeIds: [employeeId],
    persist: false,
  });
  return row
    ? { unpaidDays: row.unpaidDays, workingDays: row.workingDays }
    : { unpaidDays: 0, workingDays: 0 };
}
