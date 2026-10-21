"use server";

import { revalidatePath } from "next/cache";
import { and, count, eq } from "drizzle-orm";
import { z } from "zod";
import { db, rawClient } from "@/lib/db";
import { can, requireAccess, requireAnyPermission, requirePermission } from "@/lib/access";
import {
  ptAbsence,
  ptAbsenceType,
  ptAttendance,
  ptLeaveRequest,
  ptHoliday,
  ptHolidayCalendar,
  ptHolidayYear,
  DEFAULT_HOLIDAY_ALLOWANCE,
  ptLeavePolicy,
  ptWorkScheduleRule,
  ACCRUAL_FREQUENCIES,
  OPTIONAL_HOLIDAY_ABSENCE_CODE,
  now,
} from "@/db/schema";
import {
  restoreQuota,
  postLedger,
  daysToUnits,
  calendarFor,
  holidayAllowanceFor,
  holidaysBetween,
  isWeekend,
} from "@/lib/engines/quota";
import { earnCompOff, encashLeave } from "@/lib/engines/leave-policy";
import { evaluatePeriod } from "@/lib/engines/time-evaluation";
import { actorOf, audited, recordChanges, recordCreate, recordDelete } from "@/lib/change-log";
import { cancelStatements, decide, requestFor } from "@/lib/workflow/engine";
import { kickJobs } from "@/lib/jobs/runner";
import { recordAbsence, submitLeave } from "@/lib/services/records";
import { todayInIndia } from "@/lib/dates";

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
  const session = await requireAnyPermission("self.leave", "time.manage");
  // Someone without a record of their own may enter leave for another person
  // only if they keep time records.
  const employeeId =
    session.employeeId ?? (can(session, "time.manage") ? num(form.get("employeeId")) : 0);
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

  const result = await submitLeave(session, { employeeId, ...v });
  if (!result.ok) return fail(result.error);

  await kickJobs();
  revalidateTime();
  return OK;
}

/**
 * A decision on a leave request, through the approval engine: whoever the
 * request is waiting for — the reporting manager by default, or the next step
 * of a longer flow — or a delegate standing in for them, or someone who may
 * decide any leave request. The engine claims the request and, on the last
 * approval, takes the quota and writes the absence in the same transaction.
 */
export async function decideLeaveRequest(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireAccess();
  const id = num(form.get("id"));
  const decision = str(form.get("decision"));
  if (decision !== "Approved" && decision !== "Rejected") {
    return fail("That decision is not recognised.");
  }

  const request = await requestFor("pt_leave_request", id);
  if (!request) return fail("That request no longer exists.");
  const result = await decide({
    requestId: request.id,
    actor: session,
    decision,
    comment: opt(form.get("decisionNote")),
    canOverride: can(session, "leave.decide_any"),
  });
  if ("error" in result) return fail(result.error);

  await kickJobs();
  revalidateTime();
  revalidatePath("/approvals");
  return OK;
}

/** An employee withdrawing their own pending request. */
export async function cancelLeaveRequest(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireAccess();
  const id = num(form.get("id"));

  const request = await db.query.ptLeaveRequest.findFirst({
    where: eq(ptLeaveRequest.id, id),
  });
  if (!request) return fail("That request no longer exists.");

  const isOwner = session.employeeId === request.employeeId;
  if (!isOwner && !can(session, "time.manage")) {
    return fail("You can only cancel your own requests.");
  }
  if (request.status !== "Pending") {
    return fail("Only a pending request can be cancelled.");
  }

  // The request and its place on the approval flow are withdrawn together.
  const decidedAt = now();
  await rawClient().batch(
    [
      {
        sql: "UPDATE pt_leave_request SET status = 'Cancelled', decided_at = ? WHERE id = ? AND status = 'Pending'",
        args: [decidedAt, id],
      },
      ...(await cancelStatements("pt_leave_request", id, session)),
    ],
    "write",
  );
  await recordChanges(actorOf(session), [
    {
      entity: "pt_leave_request",
      entityId: id,
      subjectEmployeeId: request.employeeId,
      action: "update",
      before: request,
      after: { ...request, status: "Cancelled", decidedAt },
    },
  ]);
  await kickJobs();
  revalidatePath("/approvals");
  revalidateTime();
  return OK;
}

/* ------------------------------------------------ TM-01 absences directly */

export async function saveAbsence(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requirePermission("time.manage");
  const saved = await recordAbsence(actorOf(session), {
    employeeId: num(form.get("employeeId")),
    absenceTypeCode: str(form.get("absenceTypeCode")),
    startDate: str(form.get("startDate")),
    endDate: str(form.get("endDate")),
    remarks: opt(form.get("remarks")),
    createdBy: session.username,
  });
  if (!saved.ok) return fail(saved.error);
  revalidateTime();
  return OK;
}

export async function deleteAbsence(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requirePermission("time.manage");
  const id = num(form.get("id"));

  const absence = await db.query.ptAbsence.findFirst({ where: eq(ptAbsence.id, id) });
  if (!absence) return fail("That record no longer exists.");

  // If it came from an approved request, hand the days back.
  if (absence.sourceRequestId) {
    const type = await db.query.ptAbsenceType.findFirst({
      where: eq(ptAbsenceType.code, absence.absenceTypeCode),
    });
    if (type?.countsAgainstQuota && type.quotaTypeCode) {
      await restoreQuota(rawClient(), {
        employeeId: absence.employeeId,
        quotaTypeCode: type.quotaTypeCode,
        year: Number(absence.startDate.slice(0, 4)),
        units: daysToUnits(absence.isHalfDay ? 0.5 : absence.payrollDays),
        refType: "pt_it2001_absence",
        refId: id,
        createdBy: session.username,
        actor: actorOf(session),
      });
    }
    const requestId = absence.sourceRequestId;
    await audited(
      actorOf(session),
      { entity: "pt_leave_request", entityId: requestId, subjectEmployeeId: absence.employeeId },
      () => db.query.ptLeaveRequest.findFirst({ where: eq(ptLeaveRequest.id, requestId) }),
      () => db.update(ptLeaveRequest).set({ status: "Cancelled" }).where(eq(ptLeaveRequest.id, requestId)),
    );
  }

  await db.delete(ptAbsence).where(eq(ptAbsence.id, id));
  await recordDelete(actorOf(session), "pt_it2001_absence", id, absence, absence.employeeId);
  revalidateTime();
  return OK;
}

export async function saveAttendance(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requirePermission("time.manage");
  const employeeId = num(form.get("employeeId"));
  const date = str(form.get("date"));
  const hours = num(form.get("hours"));

  if (!employeeId) return fail("Choose an employee.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail("Enter a date.");
  if (!Number.isFinite(hours) || hours <= 0 || hours > 24) {
    return fail("Enter hours between 1 and 24.");
  }

  const [created] = await db
    .insert(ptAttendance)
    .values({
      employeeId,
      attendanceTypeCode: str(form.get("attendanceTypeCode")),
      date,
      hours,
      remarks: opt(form.get("remarks")),
      createdBy: session.username,
      createdAt: now(),
    })
    .returning();
  await recordCreate(actorOf(session), "pt_it2002_attendance", created.id, created, employeeId);

  // Working a holiday or a weekend earns a comp-off, banked for later.
  const calendar = await calendarFor(employeeId, date);
  const holidays = await holidaysBetween(date, date, calendar);
  if (isWeekend(date) || holidays.has(date)) {
    await earnCompOff(rawClient(), {
      employeeId,
      earnedOn: date,
      halfDays: hours >= 4 ? 2 : 1,
      sourceAttendanceId: created.id,
      note: `Worked ${holidays.has(date) ? "a holiday" : "a weekend"}`,
      createdBy: session.username,
      actor: actorOf(session),
    });
  }

  revalidateTime();
  return OK;
}

export async function deleteAttendance(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requirePermission("time.manage");
  const id = num(form.get("id"));
  const before = await db.query.ptAttendance.findFirst({ where: eq(ptAttendance.id, id) });
  await db.delete(ptAttendance).where(eq(ptAttendance.id, id));
  if (before) await recordDelete(actorOf(session), "pt_it2002_attendance", id, before, before.employeeId);
  revalidateTime();
  return OK;
}

/* ------------------------------------------------------- TM-03 quotas */

/**
 * A one-off change to one person's balance, outside the policies that
 * accrue it automatically — a correction, a goodwill day, anything that is
 * not one of the ledger's other entry types. Always needs a reason: it is
 * the only entry type a person chooses to write rather than the system
 * deriving from a policy or a request.
 */
export async function adjustQuotaAction(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requirePermission("time.manage");

  const employeeId = num(form.get("employeeId"));
  const year = num(form.get("year"));
  const quotaTypeCode = str(form.get("quotaTypeCode"));
  const days = num(form.get("days"));
  const reason = str(form.get("reason"));

  if (!employeeId) return fail("Choose an employee.");
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    return fail("Enter a year between 2000 and 2100.");
  }
  if (!quotaTypeCode) return fail("Choose a quota type.");
  if (!Number.isFinite(days) || days === 0) return fail("Enter how many days to add or take away.");
  if (!reason) return fail("Say why, for the record.");

  const halfDays = daysToUnits(days);
  const tx = await rawClient().transaction("write");
  try {
    await postLedger(tx, {
      employeeId,
      quotaTypeCode,
      year,
      entryType: "Adjustment",
      halfDays,
      note: reason,
      createdBy: session.username,
      actor: actorOf(session),
    });
    await tx.commit();
  } catch (err) {
    await tx.rollback();
    throw err;
  } finally {
    tx.close();
  }
  revalidateTime();
  return OK;
}

/**
 * Pays out days straight from a balance, at the governing policy's daily
 * rate, within what it allows for the year — queued as a one-off payment
 * the next payroll run pays like any other off-cycle line.
 */
export async function encashLeaveAction(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requirePermission("time.manage");

  const employeeId = num(form.get("employeeId"));
  const year = num(form.get("year"));
  const quotaTypeCode = str(form.get("quotaTypeCode"));
  const days = num(form.get("days"));

  if (!employeeId) return fail("Choose an employee.");
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    return fail("Enter a year between 2000 and 2100.");
  }
  if (!quotaTypeCode) return fail("Choose a quota type.");
  if (!Number.isFinite(days) || days <= 0) return fail("Enter how many days to encash.");

  const tx = await rawClient().transaction("write");
  let result: Awaited<ReturnType<typeof encashLeave>>;
  try {
    result = await encashLeave(tx, {
      employeeId,
      quotaTypeCode,
      year,
      days,
      paymentDate: todayInIndia(),
      createdBy: session.username,
      actor: actorOf(session),
    });
    if (result.ok) await tx.commit();
    else await tx.rollback();
  } catch (err) {
    await tx.rollback();
    throw err;
  } finally {
    tx.close();
  }
  if (!result.ok) return fail(result.reason);
  revalidateTime();
  return OK;
}

/* -------------------------------------------------- TM-04 time evaluation */

export async function runTimeEvaluation(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  await requirePermission("time.manage");
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
  const session = await requirePermission("time.manage");
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
    await audited(
      actorOf(session),
      { entity: "pt_work_schedule_rule", entityId: original },
      () => db.query.ptWorkScheduleRule.findFirst({ where: eq(ptWorkScheduleRule.code, original) }),
      () => db.update(ptWorkScheduleRule).set(values).where(eq(ptWorkScheduleRule.code, original)),
    );
  } else {
    const existing = await db.query.ptWorkScheduleRule.findFirst({
      where: eq(ptWorkScheduleRule.code, code),
    });
    if (existing) return fail(`Schedule ${code} already exists.`);
    await db.insert(ptWorkScheduleRule).values(values);
    await recordCreate(actorOf(session), "pt_work_schedule_rule", code, values);
  }

  revalidateTime();
  return OK;
}

export async function deleteWorkSchedule(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requirePermission("time.manage");
  const code = str(form.get("code"));
  const before = await db.query.ptWorkScheduleRule.findFirst({ where: eq(ptWorkScheduleRule.code, code) });
  await db.delete(ptWorkScheduleRule).where(eq(ptWorkScheduleRule.code, code));
  if (before) await recordDelete(actorOf(session), "pt_work_schedule_rule", code, before);
  revalidateTime();
  return OK;
}

export async function saveHoliday(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requirePermission("time.manage");
  const original = opt(form.get("originalCode"));
  const date = str(form.get("date"));
  const name = str(form.get("name"));
  const calendarCode = str(form.get("calendarCode"));

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail("Enter a date.");
  if (!name) return fail("Enter a holiday name.");
  if (!calendarCode) return fail("Choose a calendar.");

  // An optional holiday is one the company closes for only if the employee
  // chooses it, so it stays a working day for everyone else.
  const isOptional = form.get("isOptional") === "on" || form.get("isOptional") === "1" || form.get("isOptional") === "true";

  // The list is published a year at a time, so the year has to exist first —
  // it is what carries the cap these days count against.
  const year = Number(date.slice(0, 4));
  const holidayYear = await db.query.ptHolidayYear.findFirst({
    where: and(eq(ptHolidayYear.calendarCode, calendarCode), eq(ptHolidayYear.year, year)),
  });
  if (!holidayYear) return fail(`${calendarCode} has no ${year} yet. Open the year first, then add its days.`);

  if (original) {
    await audited(
      actorOf(session),
      { entity: "pt_holiday", entityId: Number(original) },
      () => db.query.ptHoliday.findFirst({ where: eq(ptHoliday.id, Number(original)) }),
      () => db.update(ptHoliday).set({ date, name, calendarCode, isOptional, year }).where(eq(ptHoliday.id, Number(original))),
    );
  } else {
    const existing = await db.query.ptHoliday.findFirst({
      where: and(eq(ptHoliday.date, date), eq(ptHoliday.calendarCode, calendarCode)),
    });
    if (existing) return fail(`That calendar already has a holiday on ${date}.`);
    const [created] = await db.insert(ptHoliday).values({ date, name, calendarCode, isOptional, year }).returning();
    await recordCreate(actorOf(session), "pt_holiday", created.id, created);
  }

  revalidateTime();
  return OK;
}

export async function deleteHoliday(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requirePermission("time.manage");
  const id = num(form.get("code")) || num(form.get("id"));
  const before = await db.query.ptHoliday.findFirst({ where: eq(ptHoliday.id, id) });
  await db.delete(ptHoliday).where(eq(ptHoliday.id, id));
  if (before) await recordDelete(actorOf(session), "pt_holiday", id, before);
  revalidateTime();
  return OK;
}

/* ------------------------------------------------------- optional holidays */

/**
 * An employee taking one of their calendar's optional holidays, or giving it
 * back. Taking it is recorded as a paid absence of its own type, so payroll,
 * time evaluation and the team calendar treat it exactly as they treat any
 * other paid day off — there is no second kind of holiday to reason about.
 *
 * How many someone may take is their calendar's own allowance, counted per
 * year, and a day already gone cannot be claimed afterwards.
 */
export async function setOptionalHoliday(_prev: ActionState, form: FormData): Promise<ActionState> {
  const session = await requirePermission("self.leave");
  const employeeId = session.employeeId;
  if (!employeeId) return fail("Your sign-in is not linked to an employee record.");
  const holidayId = num(form.get("holidayId"));
  const take = str(form.get("take")) !== "0";

  const holiday = await db.query.ptHoliday.findFirst({ where: eq(ptHoliday.id, holidayId) });
  if (!holiday || !holiday.isOptional) return fail("That is not an optional holiday.");

  const calendarCode = await calendarFor(employeeId, holiday.date);
  if (calendarCode !== holiday.calendarCode) return fail("That holiday is not on your calendar.");

  const existing = await rawClient().execute({
    sql: `SELECT id FROM pt_it2001_absence
          WHERE employee_id = ? AND absence_type_code = ? AND start_date = ?`,
    args: [employeeId, OPTIONAL_HOLIDAY_ABSENCE_CODE, holiday.date],
  });

  if (!take) {
    const row = existing.rows[0];
    if (!row) return fail("You have not taken that day.");
    if (holiday.date < todayInIndia()) return fail("That day has passed, so it can no longer be given back.");
    const absence = await db.query.ptAbsence.findFirst({ where: eq(ptAbsence.id, Number(row.id)) });
    await db.delete(ptAbsence).where(eq(ptAbsence.id, Number(row.id)));
    if (absence) await recordDelete(actorOf(session), "pt_it2001_absence", Number(row.id), absence, employeeId);
    revalidateTime();
    return OK;
  }

  if (existing.rows.length > 0) return fail("You have already taken that day.");
  if (holiday.date < todayInIndia()) return fail("That day has passed. An optional holiday is chosen before it falls.");

  const year = holiday.date.slice(0, 4);
  const allowance = await holidayAllowanceFor(calendarCode, Number(year));
  if (!allowance) return fail(`Your calendar has no ${year} published yet.`);
  if (!allowance.isPublished) return fail(`${year} is still a draft on your calendar, so its days cannot be chosen yet.`);
  if (allowance.optional <= 0) {
    return fail(
      `${year} gives ${allowance.total} day${allowance.total === 1 ? "" : "s"} off, and all of them are fixed holidays, so there is none left to choose.`,
    );
  }

  const taken = await rawClient().execute({
    sql: `SELECT COUNT(*) AS n FROM pt_it2001_absence
          WHERE employee_id = ? AND absence_type_code = ? AND substr(start_date, 1, 4) = ?`,
    args: [employeeId, OPTIONAL_HOLIDAY_ABSENCE_CODE, year],
  });
  if (Number(taken.rows[0].n) >= allowance.optional) {
    const days = `${allowance.total} day${allowance.total === 1 ? "" : "s"} off`;
    return fail(
      `${year} gives ${days}, ${allowance.mandatory} of them fixed, so you may choose ${allowance.optional} — and you have taken ${taken.rows[0].n}.`,
    );
  }

  const saved = await recordAbsence(actorOf(session), {
    employeeId,
    absenceTypeCode: OPTIONAL_HOLIDAY_ABSENCE_CODE,
    startDate: holiday.date,
    endDate: holiday.date,
    remarks: holiday.name,
    createdBy: session.username,
  });
  if (!saved.ok) return fail(saved.error);
  revalidateTime();
  return OK;
}

/* ------------------------------------------------------ holiday calendars */

export async function saveHolidayCalendar(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requirePermission("time.manage");
  const original = opt(form.get("originalCode"));
  const parsed = z
    .object({
      code: z.string().trim().min(1, "Enter a code.").max(20).regex(/^[A-Za-z0-9_-]+$/, "A code may use only letters, numbers, hyphens and underscores."),
      name: z.string().trim().min(1, "Enter a name."),
      isActive: z.boolean(),
    })
    .safeParse({
      code: str(form.get("code")).toUpperCase(),
      name: str(form.get("name")),
      isActive: bool(form.get("isActive")),
    });
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const v = parsed.data;

  if (!original) {
    const existing = await db.query.ptHolidayCalendar.findFirst({ where: eq(ptHolidayCalendar.code, v.code) });
    if (existing) return fail(`Calendar ${v.code} already exists.`);
    const [created] = await db.insert(ptHolidayCalendar).values(v).returning();
    await recordCreate(actorOf(session), "pt_holiday_calendar", created.code, created);
  } else {
    await audited(
      actorOf(session),
      { entity: "pt_holiday_calendar", entityId: original },
      () => db.query.ptHolidayCalendar.findFirst({ where: eq(ptHolidayCalendar.code, original) }),
      () => db.update(ptHolidayCalendar).set(v).where(eq(ptHolidayCalendar.code, original)),
    );
  }
  revalidateTime();
  return OK;
}

export async function deleteHolidayCalendar(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requirePermission("time.manage");
  const code = str(form.get("code"));
  const inUse = await rawClient().execute({ sql: "SELECT 1 FROM om_org_unit WHERE calendar_code = ? LIMIT 1", args: [code] });
  if (inUse.rows.length > 0) return fail("An org unit is still on this calendar. Move it to another calendar first.");
  const years = await rawClient().execute({ sql: "SELECT COUNT(*) AS n FROM pt_holiday_year WHERE calendar_code = ?", args: [code] });
  if (Number(years.rows[0].n) > 0) {
    return fail(`${code} still has ${years.rows[0].n} year${Number(years.rows[0].n) === 1 ? "" : "s"} published. Remove them first.`);
  }
  const before = await db.query.ptHolidayCalendar.findFirst({ where: eq(ptHolidayCalendar.code, code) });
  await db.delete(ptHolidayCalendar).where(eq(ptHolidayCalendar.code, code));
  if (before) await recordDelete(actorOf(session), "pt_holiday_calendar", code, before);
  revalidateTime();
  return OK;
}

/* ---------------------------------------------------------- holiday years */

/**
 * A calendar's year: the cap on days off, and whether the list is published.
 * The cap counts fixed and chosen days together, which is what makes the
 * optional allowance derived rather than another number to keep in step.
 */
export async function saveHolidayYear(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requirePermission("time.manage");
  const parsed = z
    .object({
      calendarCode: z.string().trim().min(1, "Choose a calendar."),
      year: z.number("Enter a year.").int("Enter a year.").min(2000, "That year is too far back.").max(2100, "That year is too far ahead."),
      totalAllowance: z
        .number("Enter how many days off this year gives.")
        .int("That is a whole number of days.")
        .min(0, "A year cannot give fewer than no days.")
        .max(60, "That is more days off than a year can reasonably give."),
      isPublished: z.boolean(),
    })
    .safeParse({
      calendarCode: str(form.get("calendarCode")),
      year: Number(str(form.get("year"))),
      totalAllowance: Number(str(form.get("totalAllowance")) || String(DEFAULT_HOLIDAY_ALLOWANCE)),
      isPublished: bool(form.get("isPublished")),
    });
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const v = parsed.data;

  const calendar = await db.query.ptHolidayCalendar.findFirst({ where: eq(ptHolidayCalendar.code, v.calendarCode) });
  if (!calendar) return fail(`There is no calendar ${v.calendarCode}.`);

  const existing = await db.query.ptHolidayYear.findFirst({
    where: and(eq(ptHolidayYear.calendarCode, v.calendarCode), eq(ptHolidayYear.year, v.year)),
  });
  if (existing) {
    await audited(
      actorOf(session),
      { entity: "pt_holiday_year", entityId: `${v.calendarCode}:${v.year}` },
      () =>
        db.query.ptHolidayYear.findFirst({
          where: and(eq(ptHolidayYear.calendarCode, v.calendarCode), eq(ptHolidayYear.year, v.year)),
        }),
      () =>
        db
          .update(ptHolidayYear)
          .set({ totalAllowance: v.totalAllowance, isPublished: v.isPublished })
          .where(and(eq(ptHolidayYear.calendarCode, v.calendarCode), eq(ptHolidayYear.year, v.year))),
    );
  } else {
    const [created] = await db.insert(ptHolidayYear).values({ ...v, createdAt: now() }).returning();
    await recordCreate(actorOf(session), "pt_holiday_year", `${v.calendarCode}:${v.year}`, created);
  }

  revalidateTime();
  return OK;
}

export async function deleteHolidayYear(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requirePermission("time.manage");
  const calendarCode = str(form.get("calendarCode"));
  const year = Number(str(form.get("year")));

  const holidays = await db
    .select({ n: count() })
    .from(ptHoliday)
    .where(and(eq(ptHoliday.calendarCode, calendarCode), eq(ptHoliday.year, year)));
  if (holidays[0].n > 0) {
    return fail(`${year} still has ${holidays[0].n} day${holidays[0].n === 1 ? "" : "s"} on it. Remove them first.`);
  }

  const before = await db.query.ptHolidayYear.findFirst({
    where: and(eq(ptHolidayYear.calendarCode, calendarCode), eq(ptHolidayYear.year, year)),
  });
  await db.delete(ptHolidayYear).where(and(eq(ptHolidayYear.calendarCode, calendarCode), eq(ptHolidayYear.year, year)));
  if (before) await recordDelete(actorOf(session), "pt_holiday_year", `${calendarCode}:${year}`, before);
  revalidateTime();
  return OK;
}

/**
 * Last year's list again, a year later — the same names on the same dates,
 * which is where most of a year's calendar comes from. Dates that moved and
 * festivals that follow a lunar calendar are then corrected by hand. Days
 * already on the new year are left alone, so running it twice adds nothing.
 */
export async function copyHolidayYear(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requirePermission("time.manage");
  const calendarCode = str(form.get("calendarCode"));
  const from = Number(str(form.get("fromYear")));
  const to = Number(str(form.get("year")));
  if (!calendarCode) return fail("Choose a calendar.");
  if (!Number.isInteger(from) || !Number.isInteger(to)) return fail("Choose which year to copy from.");
  if (from === to) return fail("That is the same year.");

  const target = await db.query.ptHolidayYear.findFirst({
    where: and(eq(ptHolidayYear.calendarCode, calendarCode), eq(ptHolidayYear.year, to)),
  });
  if (!target) return fail(`${calendarCode} has no ${to} yet. Open the year first.`);

  const source = await db
    .select()
    .from(ptHoliday)
    .where(and(eq(ptHoliday.calendarCode, calendarCode), eq(ptHoliday.year, from)));
  if (source.length === 0) return fail(`${calendarCode} has nothing in ${from} to copy.`);

  let copied = 0;
  for (const h of source) {
    const date = `${to}${h.date.slice(4)}`;
    const clash = await db.query.ptHoliday.findFirst({
      where: and(eq(ptHoliday.date, date), eq(ptHoliday.calendarCode, calendarCode)),
    });
    if (clash) continue;
    const [created] = await db
      .insert(ptHoliday)
      .values({ date, name: h.name, calendarCode, isOptional: h.isOptional, year: to })
      .returning();
    await recordCreate(actorOf(session), "pt_holiday", created.id, created);
    copied += 1;
  }

  revalidateTime();
  return copied === 0 ? fail(`${to} already has every day ${from} had.`) : OK;
}

/* -------------------------------------------------------- leave policies */

const LeavePolicyInput = z.object({
  code: z.string().trim().min(1, "Enter a code.").max(20).regex(/^[A-Za-z0-9_-]+$/, "A code may use only letters, numbers, hyphens and underscores."),
  name: z.string().trim().min(1, "Enter a name."),
  quotaTypeCode: z.string().min(1, "Choose a quota type."),
  appliesToGrade: z.string().nullable(),
  appliesToNodeCode: z.string().nullable(),
  entitlementHalfDaysPerYear: z.number().int().min(0, "Enter the yearly entitlement, in days or half days."),
  accrualFrequency: z.enum(ACCRUAL_FREQUENCIES),
  proRataForJoiners: z.boolean(),
  carryForwardCapHalfDays: z.number().int().min(0),
  lapseOn: z.string().regex(/^\d{2}-\d{2}$/, "Enter the lapse date as MM-DD."),
  encashableHalfDaysPerYear: z.number().int().min(0),
  sandwichRule: z.boolean(),
  isActive: z.boolean(),
});

export async function saveLeavePolicy(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requirePermission("time.manage");
  const original = opt(form.get("originalCode"));
  const parsed = LeavePolicyInput.safeParse({
    code: str(form.get("code")).toUpperCase(),
    name: str(form.get("name")),
    quotaTypeCode: str(form.get("quotaTypeCode")),
    appliesToGrade: opt(form.get("appliesToGrade")),
    appliesToNodeCode: opt(form.get("appliesToNodeCode")),
    entitlementHalfDaysPerYear: daysToUnits(num(form.get("entitlementDays"))),
    accrualFrequency: str(form.get("accrualFrequency")),
    proRataForJoiners: bool(form.get("proRataForJoiners")),
    carryForwardCapHalfDays: daysToUnits(num(form.get("carryForwardCapDays"))),
    lapseOn: str(form.get("lapseOn")),
    encashableHalfDaysPerYear: daysToUnits(num(form.get("encashableDays"))),
    sandwichRule: bool(form.get("sandwichRule")),
    isActive: bool(form.get("isActive")),
  });
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const v = parsed.data;

  if (!original) {
    const existing = await db.query.ptLeavePolicy.findFirst({ where: eq(ptLeavePolicy.code, v.code) });
    if (existing) return fail(`Policy ${v.code} already exists.`);
    const [created] = await db.insert(ptLeavePolicy).values({ ...v, createdAt: now() }).returning();
    await recordCreate(actorOf(session), "pt_leave_policy", created.code, created);
  } else {
    await audited(
      actorOf(session),
      { entity: "pt_leave_policy", entityId: original },
      () => db.query.ptLeavePolicy.findFirst({ where: eq(ptLeavePolicy.code, original) }),
      () => db.update(ptLeavePolicy).set(v).where(eq(ptLeavePolicy.code, original)),
    );
  }
  revalidateTime();
  return OK;
}

export async function deleteLeavePolicy(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requirePermission("time.manage");
  const code = str(form.get("code"));
  const before = await db.query.ptLeavePolicy.findFirst({ where: eq(ptLeavePolicy.code, code) });
  await db.delete(ptLeavePolicy).where(eq(ptLeavePolicy.code, code));
  if (before) await recordDelete(actorOf(session), "pt_leave_policy", code, before);
  revalidateTime();
  return OK;
}
