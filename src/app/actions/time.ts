"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, rawClient } from "@/lib/db";
import { requireRole, requireSession, hasRole } from "@/lib/auth";
import {
  ptAbsence,
  ptAbsenceType,
  ptAttendance,
  ptLeaveRequest,
  ptHoliday,
  ptWorkScheduleRule,
  ptAbsenceQuota,
  now,
} from "@/db/schema";
import {
  workingDaysBetween,
  calendarDaysBetween,
  restoreQuota,
  generateQuotas,
  daysToUnits,
  shortfall,
} from "@/lib/engines/quota";
import { evaluatePeriod } from "@/lib/engines/time-evaluation";
import { actorOf, audited, changeStatement, recordChanges, recordCreate, recordDelete } from "@/lib/change-log";
import {
  approverUserIds,
  notificationStatements,
  usersForEmployees,
  type NotificationItem,
} from "@/lib/notifications";
import { kickJobs } from "@/lib/jobs/runner";
import { formatDateRange } from "@/lib/dates";
import { getEmployee, fullName, listDirectReports } from "@/lib/repositories/employees";
import type { InStatement } from "@libsql/client";

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
  const payrollDays = Math.round((v.isHalfDay ? 0.5 : workingDays) * 2) / 2;

  const [type, employee, approvers] = await Promise.all([
    db.query.ptAbsenceType.findFirst({ where: eq(ptAbsenceType.code, v.absenceTypeCode) }),
    getEmployee(employeeId),
    approverUserIds(employeeId),
  ]);
  const who = employee ? fullName(employee) : "Someone";
  const range = formatDateRange(v.fromDate, v.toDate);

  // The request, its change-log entry and the approver's notification commit
  // together: nobody is told about a request that was not saved.
  const tx = await rawClient().transaction("write");
  try {
    const inserted = await tx.execute({
      sql: `INSERT INTO pt_leave_request
              (employee_id, absence_type_code, from_date, to_date, is_half_day, payroll_days, reason, status, submitted_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'Pending', ?) RETURNING *`,
      args: [employeeId, v.absenceTypeCode, v.fromDate, v.toDate, v.isHalfDay ? 1 : 0, payrollDays, v.reason, now()],
    });
    const request = inserted.rows[0] as unknown as Record<string, unknown>;
    const requestId = Number(request.id);

    const items: NotificationItem[] = approvers
      .filter((userId) => userId !== session.userId)
      .map((userId) => ({
        userId,
        kind: "leave.submitted" as const,
        title: `${who} asked for leave: ${range}`,
        body:
          `${payrollDays} working ${payrollDays === 1 ? "day" : "days"} of ${type?.name.toLowerCase() ?? "leave"}` +
          (v.reason ? `. "${v.reason}"` : "."),
        link: "/time/approvals",
        dedupeKey: `leave.submitted:${requestId}:${userId}`,
      }));

    const statements: InStatement[] = [
      changeStatement(actorOf(session), {
        entity: "pt_leave_request",
        entityId: requestId,
        subjectEmployeeId: employeeId,
        action: "create",
        after: request,
      })!,
      ...(await notificationStatements(items)),
    ];
    for (const st of statements) await tx.execute(st);
    await tx.commit();
  } catch (err) {
    await tx.rollback();
    throw err;
  } finally {
    tx.close();
  }

  await kickJobs();
  revalidateTime();
  return OK;
}

/**
 * Manager decision. Approving is the transaction that matters: it claims the
 * request, takes the days from the quota, writes the absence record, logs
 * each change and tells the employee — all in one commit. The claim is a
 * conditional update, so two people deciding at once cannot both win, and
 * the quota update refuses to overdraw, so the balance can never go below
 * zero however the clicks interleave.
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
  if (decision !== "Approved" && decision !== "Rejected") {
    return fail("That decision is not recognised.");
  }

  const request = await db.query.ptLeaveRequest.findFirst({
    where: eq(ptLeaveRequest.id, id),
  });
  if (!request) return fail("That request no longer exists.");
  if (request.status !== "Pending") {
    return fail(`That request was already ${request.status.toLowerCase()}.`);
  }

  // HR decides anything; a manager decides for their own reports, and nobody
  // decides their own request. Checked here, not by the screen, because a
  // Server Function can be called directly.
  if (session.employeeId !== null && request.employeeId === session.employeeId) {
    return fail("You cannot decide your own leave request. It goes to your manager.");
  }
  if (!hasRole(session, "HR_ADMIN")) {
    const reports = session.employeeId
      ? (await listDirectReports(session.employeeId)).map((e) => e.id)
      : [];
    if (!reports.includes(request.employeeId)) {
      return fail("You can only decide requests from people who report to you.");
    }
  }

  const type = await db.query.ptAbsenceType.findFirst({
    where: eq(ptAbsenceType.code, request.absenceTypeCode),
  });
  if (decision === "Approved" && !type) return fail("That leave type no longer exists.");

  const actor = actorOf(session);
  const decidedAt = now();
  const range = formatDateRange(request.fromDate, request.toDate);
  const approved = decision === "Approved";
  const users = await usersForEmployees([request.employeeId]);
  const recipient = users.get(request.employeeId);
  const notice = await notificationStatements(
    recipient
      ? [
          {
            userId: recipient,
            kind: "leave.decided",
            title: approved ? `Your leave for ${range} was approved` : `Your leave for ${range} was not approved`,
            body: note ?? (approved ? "Enjoy the time off." : "Talk to your manager if you want to ask again."),
            link: "/time/my-leave",
            dedupeKey: `leave.decided:${request.id}`,
          },
        ]
      : [],
  );

  const year = Number(request.fromDate.slice(0, 4));
  const units = daysToUnits(request.payrollDays);
  const usesQuota = approved && type?.countsAgainstQuota && type.quotaTypeCode;
  const quotaBefore = usesQuota
    ? await db.query.ptAbsenceQuota.findFirst({
        where: and(
          eq(ptAbsenceQuota.employeeId, request.employeeId),
          eq(ptAbsenceQuota.quotaTypeCode, type!.quotaTypeCode!),
          eq(ptAbsenceQuota.year, year),
        ),
      })
    : undefined;
  if (usesQuota && !quotaBefore) {
    return fail(`No ${type!.quotaTypeCode} entitlement exists for ${year}. Generate the quota first.`);
  }

  const tx = await rawClient().transaction("write");
  try {
    const claimed = await tx.execute({
      sql: `UPDATE pt_leave_request
            SET status = ?, decided_at = ?, decided_by_employee_id = ?, decision_note = ?
            WHERE id = ? AND status = 'Pending'`,
      args: [decision, decidedAt, session.employeeId, note, id],
    });
    if (claimed.rowsAffected === 0) {
      await tx.rollback();
      return fail("That request was decided a moment ago. Reload to see the outcome.");
    }
    const statements: (InStatement | null)[] = [
      changeStatement(actor, {
        entity: "pt_leave_request",
        entityId: id,
        subjectEmployeeId: request.employeeId,
        action: "update",
        before: request,
        after: {
          ...request,
          status: decision,
          decidedAt,
          decidedByEmployeeId: session.employeeId,
          decisionNote: note,
        },
      }),
    ];

    if (approved) {
      if (usesQuota && quotaBefore) {
        const taken = await tx.execute({
          sql: `UPDATE pt_it2006_absence_quota SET used_half_days = used_half_days + ?1
                WHERE id = ?2 AND entitled_half_days - used_half_days >= ?1`,
          args: [units, quotaBefore.id],
        });
        if (taken.rowsAffected === 0) {
          await tx.rollback();
          return fail(shortfall(units, quotaBefore.entitledHalfDays - quotaBefore.usedHalfDays));
        }
        statements.push(
          changeStatement(actor, {
            entity: "pt_it2006_absence_quota",
            entityId: quotaBefore.id,
            subjectEmployeeId: request.employeeId,
            action: "update",
            before: quotaBefore,
            after: { ...quotaBefore, usedHalfDays: quotaBefore.usedHalfDays + units },
          }),
        );
      }

      const absence = await tx.execute({
        sql: `INSERT INTO pt_it2001_absence
                (employee_id, absence_type_code, start_date, end_date, payroll_days, calendar_days,
                 is_half_day, remarks, source_request_id, created_by, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
        args: [
          request.employeeId,
          request.absenceTypeCode,
          request.fromDate,
          request.toDate,
          Math.round(request.payrollDays),
          calendarDaysBetween(request.fromDate, request.toDate),
          request.isHalfDay ? 1 : 0,
          request.reason,
          request.id,
          session.username,
          decidedAt,
        ],
      });
      const row = absence.rows[0] as unknown as Record<string, unknown>;
      statements.push(
        changeStatement(actor, {
          entity: "pt_it2001_absence",
          entityId: Number(row.id),
          subjectEmployeeId: request.employeeId,
          action: "create",
          after: row,
        }),
      );
    }

    for (const st of [...statements, ...notice]) if (st) await tx.execute(st);
    await tx.commit();
  } catch (err) {
    await tx.rollback();
    throw err;
  } finally {
    tx.close();
  }

  await kickJobs();
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

  await audited(
    actorOf(session),
    { entity: "pt_leave_request", entityId: id, subjectEmployeeId: request.employeeId },
    () => db.query.ptLeaveRequest.findFirst({ where: eq(ptLeaveRequest.id, id) }),
    () =>
      db
        .update(ptLeaveRequest)
        .set({ status: "Cancelled", decidedAt: now() })
        .where(and(eq(ptLeaveRequest.id, id), eq(ptLeaveRequest.status, "Pending"))),
  );

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

  const [created] = await db
    .insert(ptAbsence)
    .values({
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
    })
    .returning();
  await recordCreate(actorOf(session), "pt_it2001_absence", created.id, created, employeeId);

  revalidateTime();
  return OK;
}

export async function deleteAbsence(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireRole("HR_ADMIN");
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
  const session = await requireRole("HR_ADMIN");
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

  revalidateTime();
  return OK;
}

export async function deleteAttendance(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireRole("HR_ADMIN");
  const id = num(form.get("id"));
  const before = await db.query.ptAttendance.findFirst({ where: eq(ptAttendance.id, id) });
  await db.delete(ptAttendance).where(eq(ptAttendance.id, id));
  if (before) await recordDelete(actorOf(session), "pt_it2002_attendance", id, before, before.employeeId);
  revalidateTime();
  return OK;
}

/* ------------------------------------------------------- TM-03 quotas */

export async function generateQuotaAction(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireRole("HR_ADMIN");

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
  if (affected > 0) {
    await recordChanges(actorOf(session), [
      {
        entity: "pt_it2006_absence_quota",
        entityId: `${quotaTypeCode}:${year}`,
        action: "create",
        after: { quota_type_code: quotaTypeCode, year, entitlement_days: entitlementDays, employees: affected },
        reason: `Generated for ${affected} ${affected === 1 ? "employee" : "employees"}`,
      },
    ]);
  }
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
  const session = await requireRole("HR_ADMIN");
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
  const session = await requireRole("HR_ADMIN");
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
  const session = await requireRole("HR_ADMIN");
  const original = opt(form.get("originalCode"));
  const date = str(form.get("date"));
  const name = str(form.get("name"));
  const region = str(form.get("region")) || "National";

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail("Enter a date.");
  if (!name) return fail("Enter a holiday name.");

  if (original) {
    await audited(
      actorOf(session),
      { entity: "pt_holiday", entityId: Number(original) },
      () => db.query.ptHoliday.findFirst({ where: eq(ptHoliday.id, Number(original)) }),
      () => db.update(ptHoliday).set({ date, name, region }).where(eq(ptHoliday.id, Number(original))),
    );
  } else {
    const existing = await db.query.ptHoliday.findFirst({
      where: and(eq(ptHoliday.date, date), eq(ptHoliday.region, region)),
    });
    if (existing) return fail(`${region} already has a holiday on ${date}.`);
    const [created] = await db.insert(ptHoliday).values({ date, name, region }).returning();
    await recordCreate(actorOf(session), "pt_holiday", created.id, created);
  }

  revalidateTime();
  return OK;
}

export async function deleteHoliday(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireRole("HR_ADMIN");
  const id = num(form.get("code")) || num(form.get("id"));
  const before = await db.query.ptHoliday.findFirst({ where: eq(ptHoliday.id, id) });
  await db.delete(ptHoliday).where(eq(ptHoliday.id, id));
  if (before) await recordDelete(actorOf(session), "pt_holiday", id, before);
  revalidateTime();
  return OK;
}
