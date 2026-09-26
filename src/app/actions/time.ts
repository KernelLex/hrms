"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireRole, requireSession, hasRole } from "@/lib/auth";
import {
  ptAbsence,
  ptAbsenceType,
  ptAttendance,
  ptLeaveRequest,
  ptHoliday,
  ptWorkScheduleRule,
  now,
} from "@/db/schema";
import {
  workingDaysBetween,
  calendarDaysBetween,
  consumeQuota,
  restoreQuota,
  generateQuotas,
  daysToUnits,
} from "@/lib/engines/quota";
import { evaluatePeriod } from "@/lib/engines/time-evaluation";

export type ActionState = { error?: string; ok?: boolean };

const OK: ActionState = { ok: true };
const fail = (error: string): ActionState => ({ error });
const firstIssue = (e: z.ZodError) =>
  e.issues[0]?.message ?? "Check the form and try again.";

const str = (v: FormDataEntryValue | null) => (typeof v === "string" ? v.trim() : "");
const opt = (v: FormDataEntryValue | null) => {
  const s = str(v);
  return s.length > 0 ? s : null;
};
const num = (v: FormDataEntryValue | null) => Number(str(v));
const bool = (v: FormDataEntryValue | null) => v === "on" || v === "true" || v === "1";

const dateish = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date.");

function revalidateTime() {
  revalidatePath("/time", "layout");
  revalidatePath("/");
}

/* ------------------------------------------------- TM-02 leave requests */

const RequestInput = z.object({
  absenceTypeCode: z.string().min(1, "Choose a leave type."),
  fromDate: dateish,
  toDate: dateish,
  isHalfDay: z.boolean(),
  reason: z.string().nullable(),
});

/**
 * Employee self-service: submit a leave request.
 *
 * The quota is not touched here. Requesting leave is not taking it — the
 * balance only moves when a manager approves, otherwise a pending request
 * would silently hold days an employee might never get.
 */
export async function submitLeaveRequest(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireSession();
  const employeeId = session.employeeId ?? num(form.get("employeeId"));
  if (!employeeId) {
    return fail("Your sign-in is not linked to an employee record.");
  }

  const parsed = RequestInput.safeParse({
    absenceTypeCode: str(form.get("absenceTypeCode")),
    fromDate: str(form.get("fromDate")),
    toDate: str(form.get("toDate")),
    isHalfDay: bool(form.get("isHalfDay")),
    reason: opt(form.get("reason")),
  });
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const v = parsed.data;

  if (v.toDate < v.fromDate) return fail("The end date falls before the start date.");
  if (v.isHalfDay && v.fromDate !== v.toDate) {
    return fail("A half day covers a single date.");
  }

  const workingDays = await workingDaysBetween(v.fromDate, v.toDate);
  if (workingDays === 0) {
    return fail("That range has no working days in it — it falls on weekends or holidays.");
  }
  const payrollDays = v.isHalfDay ? 0.5 : workingDays;

  await db.insert(ptLeaveRequest).values({
    employeeId,
    absenceTypeCode: v.absenceTypeCode,
    fromDate: v.fromDate,
    toDate: v.toDate,
    isHalfDay: v.isHalfDay,
    payrollDays: Math.round(payrollDays * 2) / 2,
    reason: v.reason,
    status: "Pending",
    submittedAt: now(),
  });

  revalidateTime();
  return OK;
}

/**
 * Manager decision. Approving is the transaction that matters: it writes the
 * absence record and consumes the quota together, so an approved request can
 * never exist without the days coming off the balance.
 */
export async function decideLeaveRequest(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireSession();
  if (!hasRole(session, "HR_ADMIN", "MANAGER")) {
    return fail("Only a manager or HR can decide a leave request.");
  }

  const id = num(form.get("id"));
  const decision = str(form.get("decision"));
  const note = opt(form.get("decisionNote"));

  const request = await db.query.ptLeaveRequest.findFirst({
    where: eq(ptLeaveRequest.id, id),
  });
  if (!request) return fail("That request no longer exists.");
  if (request.status !== "Pending") {
    return fail(`That request was already ${request.status.toLowerCase()}.`);
  }

  if (decision === "Rejected") {
    await db
      .update(ptLeaveRequest)
      .set({
        status: "Rejected",
        decidedAt: now(),
        decidedByEmployeeId: session.employeeId,
        decisionNote: note,
      })
      .where(eq(ptLeaveRequest.id, id));
    revalidateTime();
    return OK;
  }

  if (decision !== "Approved") return fail("That decision is not recognised.");

  const type = await db.query.ptAbsenceType.findFirst({
    where: eq(ptAbsenceType.code, request.absenceTypeCode),
  });
  if (!type) return fail("That leave type no longer exists.");

  const year = Number(request.fromDate.slice(0, 4));
  const units = daysToUnits(request.payrollDays);

  if (type.countsAgainstQuota && type.quotaTypeCode) {
    const taken = await consumeQuota({
      employeeId: request.employeeId,
      quotaTypeCode: type.quotaTypeCode,
      year,
      units,
    });
    if (!taken.ok) return fail(taken.reason);
  }

  await db.insert(ptAbsence).values({
    employeeId: request.employeeId,
    absenceTypeCode: request.absenceTypeCode,
    startDate: request.fromDate,
    endDate: request.toDate,
    payrollDays: Math.round(request.payrollDays),
    calendarDays: calendarDaysBetween(request.fromDate, request.toDate),
    isHalfDay: request.isHalfDay,
    remarks: request.reason,
    sourceRequestId: request.id,
    createdBy: session.username,
    createdAt: now(),
  });

  await db
    .update(ptLeaveRequest)
    .set({
      status: "Approved",
      decidedAt: now(),
      decidedByEmployeeId: session.employeeId,
      decisionNote: note,
    })
    .where(eq(ptLeaveRequest.id, id));

  revalidateTime();
  return OK;
}

/** An employee withdrawing their own pending request. */
export async function cancelLeaveRequest(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireSession();
  const id = num(form.get("id"));

  const request = await db.query.ptLeaveRequest.findFirst({
    where: eq(ptLeaveRequest.id, id),
  });
  if (!request) return fail("That request no longer exists.");

  const isOwner = session.employeeId === request.employeeId;
  if (!isOwner && !hasRole(session, "HR_ADMIN")) {
    return fail("You can only cancel your own requests.");
  }
  if (request.status !== "Pending") {
    return fail("Only a pending request can be cancelled.");
  }

  await db
    .update(ptLeaveRequest)
    .set({ status: "Cancelled", decidedAt: now() })
    .where(eq(ptLeaveRequest.id, id));

  revalidateTime();
  return OK;
}

/* ------------------------------------------------ TM-01 absences directly */

export async function saveAbsence(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireRole("HR_ADMIN");

  const employeeId = num(form.get("employeeId"));
  const absenceTypeCode = str(form.get("absenceTypeCode"));
  const startDate = str(form.get("startDate"));
  const endDate = str(form.get("endDate"));

  if (!employeeId) return fail("Choose an employee.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return fail("Enter a start date.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate)) return fail("Enter an end date.");
  if (endDate < startDate) return fail("The end date falls before the start date.");

  const payrollDays = await workingDaysBetween(startDate, endDate);
  if (payrollDays === 0) {
    return fail("That range has no working days in it.");
  }

  await db.insert(ptAbsence).values({
    employeeId,
    absenceTypeCode,
    startDate,
    endDate,
    payrollDays,
    calendarDays: calendarDaysBetween(startDate, endDate),
    isHalfDay: false,
    remarks: opt(form.get("remarks")),
    sourceRequestId: null,
    createdBy: session.username,
    createdAt: now(),
  });

  revalidateTime();
  return OK;
}

export async function deleteAbsence(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  await requireRole("HR_ADMIN");
  const id = num(form.get("id"));

  const absence = await db.query.ptAbsence.findFirst({ where: eq(ptAbsence.id, id) });
  if (!absence) return fail("That record no longer exists.");

  // If it came from an approved request, hand the days back.
  if (absence.sourceRequestId) {
    const type = await db.query.ptAbsenceType.findFirst({
      where: eq(ptAbsenceType.code, absence.absenceTypeCode),
    });
    if (type?.countsAgainstQuota && type.quotaTypeCode) {
      await restoreQuota({
        employeeId: absence.employeeId,
        quotaTypeCode: type.quotaTypeCode,
        year: Number(absence.startDate.slice(0, 4)),
        units: daysToUnits(absence.isHalfDay ? 0.5 : absence.payrollDays),
      });
    }
    await db
      .update(ptLeaveRequest)
      .set({ status: "Cancelled" })
      .where(eq(ptLeaveRequest.id, absence.sourceRequestId));
  }

  await db.delete(ptAbsence).where(eq(ptAbsence.id, id));
  revalidateTime();
  return OK;
}

export async function saveAttendance(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireRole("HR_ADMIN");
  const employeeId = num(form.get("employeeId"));
  const date = str(form.get("date"));
  const hours = num(form.get("hours"));

  if (!employeeId) return fail("Choose an employee.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail("Enter a date.");
  if (!Number.isFinite(hours) || hours <= 0 || hours > 24) {
    return fail("Enter hours between 1 and 24.");
  }

  await db.insert(ptAttendance).values({
    employeeId,
    attendanceTypeCode: str(form.get("attendanceTypeCode")),
    date,
    hours,
    remarks: opt(form.get("remarks")),
    createdBy: session.username,
    createdAt: now(),
  });

  revalidateTime();
  return OK;
}

export async function deleteAttendance(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  await requireRole("HR_ADMIN");
  await db.delete(ptAttendance).where(eq(ptAttendance.id, num(form.get("id"))));
  revalidateTime();
  return OK;
}

/* ------------------------------------------------------- TM-03 quotas */

export async function generateQuotaAction(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  await requireRole("HR_ADMIN");

  const year = num(form.get("year"));
  const quotaTypeCode = str(form.get("quotaTypeCode"));
  const entitlementDays = num(form.get("entitlementDays"));

  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    return fail("Enter a year between 2000 and 2100.");
  }
  if (!quotaTypeCode) return fail("Choose a quota type.");
  if (!Number.isFinite(entitlementDays) || entitlementDays < 0) {
    return fail("Enter the entitlement in days.");
  }

  const affected = await generateQuotas({ year, quotaTypeCode, entitlementDays });
  revalidateTime();
  if (affected === 0) return fail("There are no employees to generate quotas for.");
  return OK;
}

/* -------------------------------------------------- TM-04 time evaluation */

export async function runTimeEvaluation(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  await requireRole("HR_ADMIN");
  const year = num(form.get("year"));
  const month = num(form.get("month"));

  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return fail("Choose a period.");
  }

  const rows = await evaluatePeriod({ year, month });
  revalidateTime();
  if (rows.length === 0) return fail("There are no employees to evaluate.");
  return OK;
}

/* ------------------------------------------- TM-05 schedules and holidays */

export async function saveWorkSchedule(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  await requireRole("HR_ADMIN");
  const original = opt(form.get("originalCode"));
  const code = str(form.get("code")).toUpperCase();
  const name = str(form.get("name"));
  const weeklyHours = num(form.get("weeklyHours"));

  if (!code) return fail("Enter a schedule code.");
  if (!name) return fail("Enter a schedule name.");
  if (!Number.isFinite(weeklyHours) || weeklyHours <= 0 || weeklyHours > 80) {
    return fail("Enter weekly hours between 1 and 80.");
  }

  const values = {
    code,
    name,
    weeklyHours,
    workingDays: opt(form.get("workingDays")),
    isActive: bool(form.get("isActive")),
  };

  if (original) {
    await db.update(ptWorkScheduleRule).set(values).where(eq(ptWorkScheduleRule.code, original));
  } else {
    const existing = await db.query.ptWorkScheduleRule.findFirst({
      where: eq(ptWorkScheduleRule.code, code),
    });
    if (existing) return fail(`Schedule ${code} already exists.`);
    await db.insert(ptWorkScheduleRule).values(values);
  }

  revalidateTime();
  return OK;
}

export async function deleteWorkSchedule(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  await requireRole("HR_ADMIN");
  await db.delete(ptWorkScheduleRule).where(eq(ptWorkScheduleRule.code, str(form.get("code"))));
  revalidateTime();
  return OK;
}

export async function saveHoliday(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  await requireRole("HR_ADMIN");
  const original = opt(form.get("originalCode"));
  const date = str(form.get("date"));
  const name = str(form.get("name"));
  const region = str(form.get("region")) || "National";

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail("Enter a date.");
  if (!name) return fail("Enter a holiday name.");

  if (original) {
    await db
      .update(ptHoliday)
      .set({ date, name, region })
      .where(eq(ptHoliday.id, Number(original)));
  } else {
    const existing = await db.query.ptHoliday.findFirst({
      where: and(eq(ptHoliday.date, date), eq(ptHoliday.region, region)),
    });
    if (existing) return fail(`${region} already has a holiday on ${date}.`);
    await db.insert(ptHoliday).values({ date, name, region });
  }

  revalidateTime();
  return OK;
}

export async function deleteHoliday(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  await requireRole("HR_ADMIN");
  await db.delete(ptHoliday).where(eq(ptHoliday.id, num(form.get("code")) || num(form.get("id"))));
  revalidateTime();
  return OK;
}
