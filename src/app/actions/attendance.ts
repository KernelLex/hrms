"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, rawClient } from "@/lib/db";
import { requireAccess, requireAnyPermission, requirePermission } from "@/lib/access";
import { ptShift, ptRosterPattern, ptDevice, now } from "@/db/schema";
import { generateRoster, setRosterDay, recordPunches, runDailyAttendance, type PunchInput } from "@/lib/engines/attendance";
import { actorOf, audited, recordChanges, recordCreate, recordDelete } from "@/lib/change-log";
import { cancelStatements, planRequest, writeRequest } from "@/lib/workflow/engine";
import { notificationStatements, type NotificationItem } from "@/lib/notifications";
import { kickJobs } from "@/lib/jobs/runner";
import { getEmployee, fullName } from "@/lib/repositories/employees";
import { parseCsv } from "@/lib/csv";

export type ActionState = { error?: string; ok?: boolean };

const OK: ActionState = { ok: true };
const fail = (error: string): ActionState => ({ error });
const firstIssue = (e: z.ZodError) => e.issues[0]?.message ?? "Check the form and try again.";

const str = (v: FormDataEntryValue | null) => (typeof v === "string" ? v.trim() : "");
const opt = (v: FormDataEntryValue | null) => {
  const s = str(v);
  return s.length > 0 ? s : null;
};
const num = (v: FormDataEntryValue | null) => Number(str(v));
const bool = (v: FormDataEntryValue | null) => v === "on" || v === "true" || v === "1";

/**
 * A `datetime-local` input submits a bare "2026-04-06T09:05" with no
 * timezone — every company in this system is in India, so that string is
 * read as India time, not the server's own.
 */
function istDateTime(local: string): string {
  return new Date(`${local}:00+05:30`).toISOString();
}

function revalidateAttendance() {
  revalidatePath("/time", "layout");
  revalidatePath("/");
}

/* ---------------------------------------------------------------- shifts */

const ShiftInput = z.object({
  code: z.string().trim().min(1, "Enter a code.").max(20).regex(/^[A-Za-z0-9_-]+$/, "A code may use only letters, numbers, hyphens and underscores."),
  name: z.string().trim().min(1, "Enter a name."),
  startTime: z.string().regex(/^\d{2}:\d{2}$/, "Enter a start time as HH:MM."),
  endTime: z.string().regex(/^\d{2}:\d{2}$/, "Enter an end time as HH:MM."),
  breakMinutes: z.number().int().min(0).max(480),
  isNight: z.boolean(),
  graceMinutes: z.number().int().min(0).max(120),
  isActive: z.boolean(),
});

export async function saveShift(_prev: ActionState, form: FormData): Promise<ActionState> {
  const session = await requirePermission("time.manage");
  const original = opt(form.get("originalCode"));
  const parsed = ShiftInput.safeParse({
    code: str(form.get("code")).toUpperCase(),
    name: str(form.get("name")),
    startTime: str(form.get("startTime")),
    endTime: str(form.get("endTime")),
    breakMinutes: num(form.get("breakMinutes")) || 0,
    isNight: bool(form.get("isNight")),
    graceMinutes: num(form.get("graceMinutes")) || 0,
    isActive: bool(form.get("isActive")),
  });
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const v = parsed.data;

  if (!original) {
    const existing = await db.query.ptShift.findFirst({ where: eq(ptShift.code, v.code) });
    if (existing) return fail(`Shift ${v.code} already exists.`);
    const [created] = await db.insert(ptShift).values(v).returning();
    await recordCreate(actorOf(session), "pt_shift", created.code, created);
  } else {
    await audited(
      actorOf(session),
      { entity: "pt_shift", entityId: original },
      () => db.query.ptShift.findFirst({ where: eq(ptShift.code, original) }),
      () => db.update(ptShift).set(v).where(eq(ptShift.code, original)),
    );
  }
  revalidateAttendance();
  return OK;
}

export async function deleteShift(_prev: ActionState, form: FormData): Promise<ActionState> {
  const session = await requirePermission("time.manage");
  const code = str(form.get("code"));
  const inUse = await rawClient().execute({ sql: "SELECT 1 FROM pt_roster WHERE shift_code = ? LIMIT 1", args: [code] });
  if (inUse.rows.length > 0) return fail("A roster still uses this shift. Remove it from the roster first.");
  const before = await db.query.ptShift.findFirst({ where: eq(ptShift.code, code) });
  await db.delete(ptShift).where(eq(ptShift.code, code));
  if (before) await recordDelete(actorOf(session), "pt_shift", code, before);
  revalidateAttendance();
  return OK;
}

/* ------------------------------------------------------------ roster patterns */

const PatternInput = z.object({
  code: z.string().trim().min(1, "Enter a code.").max(20).regex(/^[A-Za-z0-9_-]+$/, "A code may use only letters, numbers, hyphens and underscores."),
  name: z.string().trim().min(1, "Enter a name."),
  cycleLengthDays: z.number().int().min(1, "Enter how many days the cycle runs.").max(90),
  isActive: z.boolean(),
});

export async function saveRosterPattern(_prev: ActionState, form: FormData): Promise<ActionState> {
  const session = await requirePermission("time.manage");
  const original = opt(form.get("originalCode"));
  const parsed = PatternInput.safeParse({
    code: str(form.get("code")).toUpperCase(),
    name: str(form.get("name")),
    cycleLengthDays: num(form.get("cycleLengthDays")),
    isActive: bool(form.get("isActive")),
  });
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const v = parsed.data;

  if (!original) {
    const existing = await db.query.ptRosterPattern.findFirst({ where: eq(ptRosterPattern.code, v.code) });
    if (existing) return fail(`Pattern ${v.code} already exists.`);
    const [created] = await db.insert(ptRosterPattern).values(v).returning();
    await recordCreate(actorOf(session), "pt_roster_pattern", created.code, created);
  } else {
    await audited(
      actorOf(session),
      { entity: "pt_roster_pattern", entityId: original },
      () => db.query.ptRosterPattern.findFirst({ where: eq(ptRosterPattern.code, original) }),
      () => db.update(ptRosterPattern).set(v).where(eq(ptRosterPattern.code, original)),
    );
  }
  revalidateAttendance();
  return OK;
}

export async function deleteRosterPattern(_prev: ActionState, form: FormData): Promise<ActionState> {
  const session = await requirePermission("time.manage");
  const code = str(form.get("code"));
  const before = await db.query.ptRosterPattern.findFirst({ where: eq(ptRosterPattern.code, code) });
  await db.delete(ptRosterPattern).where(eq(ptRosterPattern.code, code));
  if (before) await recordDelete(actorOf(session), "pt_roster_pattern", code, before);
  revalidateAttendance();
  return OK;
}

/** Saves every day of a pattern's cycle at once — a small grid, not a list to add to one row at a time. */
export async function savePatternDays(_prev: ActionState, form: FormData): Promise<ActionState> {
  const session = await requirePermission("time.manage");
  const patternCode = str(form.get("patternCode"));
  const cycleLengthDays = num(form.get("cycleLengthDays"));
  if (!patternCode) return fail("Choose a pattern.");
  if (!Number.isInteger(cycleLengthDays) || cycleLengthDays < 1) return fail("That pattern has no cycle length.");

  const before = await rawClient().execute({ sql: "SELECT day_index, shift_code FROM pt_roster_pattern_day WHERE pattern_code = ?", args: [patternCode] });
  const beforeMap = new Map(before.rows.map((r) => [Number(r.day_index), r.shift_code === null ? null : String(r.shift_code)]));

  const tx = await rawClient().transaction("write");
  try {
    for (let i = 0; i < cycleLengthDays; i += 1) {
      const shiftCode = opt(form.get(`day_${i}`));
      if (beforeMap.get(i) === (shiftCode ?? null)) continue;
      await tx.execute({
        sql: `INSERT INTO pt_roster_pattern_day (pattern_code, day_index, shift_code) VALUES (?, ?, ?)
              ON CONFLICT (pattern_code, day_index) DO UPDATE SET shift_code = excluded.shift_code`,
        args: [patternCode, i, shiftCode],
      });
    }
    await tx.commit();
  } catch (err) {
    await tx.rollback();
    throw err;
  } finally {
    tx.close();
  }
  await recordCreate(actorOf(session), "pt_roster_pattern_day", patternCode, { patternCode, cycleLengthDays });
  revalidateAttendance();
  return OK;
}

/* ------------------------------------------------------------------ roster */

export async function assignRosterAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const session = await requirePermission("time.manage");
  const employeeIds = form.getAll("employeeIds").map((v) => Number(v)).filter((n) => Number.isInteger(n) && n > 0);
  const patternCode = str(form.get("patternCode"));
  const fromDate = str(form.get("fromDate"));
  const toDate = str(form.get("toDate"));

  if (employeeIds.length === 0) return fail("Choose at least one employee.");
  if (!patternCode) return fail("Choose a pattern.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(toDate)) return fail("Enter a valid date range.");
  if (toDate < fromDate) return fail("The end date falls before the start date.");

  let result;
  try {
    result = await generateRoster(rawClient(), { patternCode, employeeIds, fromDate, toDate, createdBy: session.username });
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Could not generate the roster.");
  }
  await recordCreate(actorOf(session), "pt_roster", `${patternCode}:${fromDate}..${toDate}`, {
    patternCode,
    employeeCount: employeeIds.length,
    fromDate,
    toDate,
  });
  revalidateAttendance();
  return result.days > 0 ? OK : fail("That pattern has no active days to assign.");
}

export async function setRosterDayAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const session = await requirePermission("time.manage");
  const employeeId = num(form.get("employeeId"));
  const date = str(form.get("date"));
  const shiftCode = opt(form.get("shiftCode"));
  if (!employeeId) return fail("Choose an employee.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail("Enter a date.");

  await setRosterDay(rawClient(), { employeeId, date, shiftCode, createdBy: session.username });
  await recordCreate(actorOf(session), "pt_roster", `${employeeId}:${date}`, { employeeId, date, shiftCode });
  revalidateAttendance();
  return OK;
}

/* ----------------------------------------------------------------- devices */

const DeviceInput = z.object({
  code: z.string().trim().min(1, "Enter a code.").max(20).regex(/^[A-Za-z0-9_-]+$/, "A code may use only letters, numbers, hyphens and underscores."),
  name: z.string().trim().min(1, "Enter a name."),
  location: z.string().nullable(),
  isActive: z.boolean(),
});

export async function saveDevice(_prev: ActionState, form: FormData): Promise<ActionState> {
  const session = await requirePermission("time.manage");
  const original = opt(form.get("originalCode"));
  const parsed = DeviceInput.safeParse({
    code: str(form.get("code")).toUpperCase(),
    name: str(form.get("name")),
    location: opt(form.get("location")),
    isActive: bool(form.get("isActive")),
  });
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const v = parsed.data;

  if (!original) {
    const existing = await db.query.ptDevice.findFirst({ where: eq(ptDevice.code, v.code) });
    if (existing) return fail(`Device ${v.code} already exists.`);
    const [created] = await db.insert(ptDevice).values(v).returning();
    await recordCreate(actorOf(session), "pt_device", created.code, created);
  } else {
    await audited(
      actorOf(session),
      { entity: "pt_device", entityId: original },
      () => db.query.ptDevice.findFirst({ where: eq(ptDevice.code, original) }),
      () => db.update(ptDevice).set(v).where(eq(ptDevice.code, original)),
    );
  }
  revalidateAttendance();
  return OK;
}

export async function deleteDevice(_prev: ActionState, form: FormData): Promise<ActionState> {
  const session = await requirePermission("time.manage");
  const code = str(form.get("code"));
  if (code === "CSV" || code === "REGULARISED") return fail("That device is built in and cannot be removed.");
  const before = await db.query.ptDevice.findFirst({ where: eq(ptDevice.code, code) });
  await db.delete(ptDevice).where(eq(ptDevice.code, code));
  if (before) await recordDelete(actorOf(session), "pt_device", code, before);
  revalidateAttendance();
  return OK;
}

/* ------------------------------------------------------------------ punches */

/** Reads a CSV of punches: employee_number, at (ISO timestamp), direction (In/Out), device (optional, defaults to CSV). */
export async function uploadPunchesAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const session = await requirePermission("time.manage");
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return fail("Choose a CSV file.");
  const text = await file.text();
  const rows = parseCsv(text);
  if (rows.length === 0) return fail("That file has no rows.");

  const numbers = [...new Set(rows.map((r) => r.employee_number).filter(Boolean))];
  const found = await rawClient().execute({
    sql: `SELECT id, employee_number FROM pa_employee WHERE employee_number IN (${numbers.map(() => "?").join(", ")})`,
    args: numbers,
  });
  const employeeOf = new Map(found.rows.map((r) => [String(r.employee_number), Number(r.id)]));

  const punches: PunchInput[] = [];
  const errors: string[] = [];
  rows.forEach((r, i) => {
    const employeeId = employeeOf.get(r.employee_number);
    if (!employeeId) {
      errors.push(`Row ${i + 2}: unknown employee number ${r.employee_number}.`);
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(r.at ?? "")) {
      errors.push(`Row ${i + 2}: "at" must be an ISO timestamp.`);
      return;
    }
    if (r.direction !== "In" && r.direction !== "Out") {
      errors.push(`Row ${i + 2}: direction must be In or Out.`);
      return;
    }
    punches.push({ employeeId, deviceCode: r.device || "CSV", at: new Date(r.at).toISOString(), direction: r.direction, source: "Csv" });
  });
  if (errors.length > 0) return fail(errors.slice(0, 5).join(" "));

  const result = await recordPunches(rawClient(), punches);
  await recordCreate(actorOf(session), "pt_punch", `csv:${now()}`, { written: result.written, skipped: result.skipped });
  await kickJobs();
  revalidateAttendance();
  return OK;
}

/** HR's own "run it now" — the daily job calls the same engine function for yesterday, automatically. */
export async function runDailyAttendanceAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const session = await requirePermission("time.manage");
  const date = str(form.get("date"));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail("Choose a date.");
  const result = await runDailyAttendance(rawClient(), { date, actor: actorOf(session) });
  revalidateAttendance();
  return result.finalised > 0 ? OK : fail("Nobody was rostered a shift that day.");
}

/* ---------------------------------------------------------- regularisation */

const localDateTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const RegularisationInput = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a date."),
  claimedIn: z.string().regex(localDateTime, "Enter a valid time.").nullable(),
  claimedOut: z.string().regex(localDateTime, "Enter a valid time.").nullable(),
  reason: z.string().trim().min(1, "Say why you are asking for this correction."),
});

/** Employee self-service: ask for a day's attendance to be corrected. */
export async function submitRegularisation(_prev: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireAnyPermission("self.attendance", "time.manage");
  const employeeId = session.employeeId;
  if (!employeeId) return fail("Your sign-in is not linked to an employee record.");

  const parsed = RegularisationInput.safeParse({
    date: str(form.get("date")),
    claimedIn: opt(form.get("claimedIn")),
    claimedOut: opt(form.get("claimedOut")),
    reason: str(form.get("reason")),
  });
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const v = parsed.data;
  if (!v.claimedIn && !v.claimedOut) return fail("Enter at least one time you are claiming.");

  const employee = await getEmployee(employeeId);
  const who = employee ? fullName(employee) : "Someone";
  const approval = {
    process: "regularisation" as const,
    subjectType: "pt_regularisation",
    subjectEmployeeId: employeeId,
    requester: session,
    summary: `${who}: attendance for ${v.date}`,
    facts: {},
  };

  let plan;
  try {
    plan = await planRequest({ ...approval, subjectId: 0 });
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Regularisation approval is not set up.");
  }

  const tx = await rawClient().transaction("write");
  try {
    const inserted = await tx.execute({
      sql: `INSERT INTO pt_regularisation (employee_id, date, claimed_in, claimed_out, reason, status, submitted_at)
            VALUES (?, ?, ?, ?, ?, 'Pending', ?) RETURNING *`,
      args: [
        employeeId,
        v.date,
        v.claimedIn ? istDateTime(v.claimedIn) : null,
        v.claimedOut ? istDateTime(v.claimedOut) : null,
        v.reason,
        now(),
      ],
    });
    const request = inserted.rows[0] as unknown as Record<string, unknown>;
    const requestId = Number(request.id);
    await writeRequest(tx, { ...approval, subjectId: requestId }, plan);

    const items: NotificationItem[] = plan.recipients.map((userId) => ({
      userId,
      kind: "regularisation.submitted" as const,
      title: `${who} asked for ${v.date}'s attendance to be corrected`,
      body: `"${v.reason}"`,
      link: "/approvals?process=regularisation",
      dedupeKey: `regularisation.submitted:${requestId}:${userId}`,
    }));
    for (const st of await notificationStatements(items)) await tx.execute(st);
    await tx.commit();
  } catch (err) {
    await tx.rollback();
    throw err;
  } finally {
    tx.close();
  }

  await kickJobs();
  revalidateAttendance();
  return OK;
}

export async function cancelRegularisation(_prev: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireAccess();
  const id = num(form.get("id"));
  const before = await rawClient().execute({ sql: "SELECT * FROM pt_regularisation WHERE id = ?", args: [id] });
  const row = before.rows[0] as unknown as Record<string, unknown> | undefined;
  if (!row) return fail("That request no longer exists.");
  const employeeId = Number(row.employee_id);
  if (session.employeeId !== employeeId) return fail("You may only cancel your own requests.");
  if (String(row.status) !== "Pending") return fail("That request was already decided.");

  // The request and its place on the approval flow are withdrawn together.
  await rawClient().batch(
    [
      { sql: "UPDATE pt_regularisation SET status = 'Cancelled' WHERE id = ? AND status = 'Pending'", args: [id] },
      ...(await cancelStatements("pt_regularisation", id, session)),
    ],
    "write",
  );
  await recordChanges(actorOf(session), [
    { entity: "pt_regularisation", entityId: id, subjectEmployeeId: employeeId, action: "update", before: row, after: { ...row, status: "Cancelled" } },
  ]);
  revalidatePath("/approvals");
  revalidateAttendance();
  return OK;
}
