import "server-only";
import { rawClient } from "@/lib/db";
import { now } from "@/db/schema";
import { changeStatement, recordChanges, type Actor } from "@/lib/change-log";
import { calendarDaysBetween, calendarFor, sandwichDays, workingDaysBetween } from "@/lib/engines/quota";
import { notificationStatements, type NotificationItem } from "@/lib/notifications";
import { planRequest, writeRequest, type Actor as RequesterActor } from "@/lib/workflow/engine";
import { formatDateRange } from "@/lib/dates";
import { getEmployee, fullName } from "@/lib/repositories/employees";
import type { Result } from "./result";

/**
 * Time, payroll and organisation writes that the screens and the API share:
 * the same checks, the same change-log entries, whoever calls.
 */

const one = async (sql: string, args: (string | number | null)[]) =>
  (await rawClient().execute({ sql, args })).rows[0] as Record<string, unknown> | undefined;

const isDate = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d);

/* -------------------------------------------------------------- absences */

export async function recordAbsence(
  actor: Actor,
  input: { employeeId: number; absenceTypeCode: string; startDate: string; endDate: string; remarks: string | null; createdBy: string },
): Promise<Result<Record<string, unknown>>> {
  const { employeeId, absenceTypeCode, startDate, endDate } = input;
  if (!employeeId) return { error: "Choose an employee." };
  if (!isDate(startDate)) return { error: "Enter a start date." };
  if (!isDate(endDate)) return { error: "Enter an end date." };
  if (endDate < startDate) return { error: "The end date falls before the start date." };
  const [employee, type] = await Promise.all([
    one("SELECT id FROM pa_employee WHERE id = ?", [employeeId]),
    one("SELECT code FROM pt_absence_type WHERE code = ? AND is_active = 1", [absenceTypeCode]),
  ]);
  if (!employee) return { error: "That employee does not exist.", code: "not_found" };
  if (!type) return { error: `There is no active absence type ${absenceTypeCode}.` };

  const calendar = await calendarFor(employeeId, startDate);
  const payrollDays = await workingDaysBetween(startDate, endDate, calendar);
  if (payrollDays === 0) return { error: "That range has no working days in it." };

  const r = await rawClient().execute({
    sql: `INSERT INTO pt_it2001_absence (employee_id, absence_type_code, start_date, end_date, payroll_days, calendar_days,
            is_half_day, remarks, source_request_id, created_by, created_at)
          VALUES (?, ?, ?, ?, ?, ?, 0, ?, NULL, ?, ?) RETURNING *`,
    args: [employeeId, absenceTypeCode, startDate, endDate, payrollDays, calendarDaysBetween(startDate, endDate), input.remarks, input.createdBy, now()],
  });
  const row = r.rows[0] as unknown as Record<string, unknown>;
  await recordChanges(actor, [{ entity: "pt_it2001_absence", entityId: Number(row.id), subjectEmployeeId: employeeId, action: "create", after: row }]);
  return { ok: true, value: row };
}

/* --------------------------------------------------------- leave requests */

/**
 * Submits a leave request through the same approval flow My leave uses:
 * working days and the sandwich rule computed from the employee's own
 * calendar, then the flow's first step read and written in one transaction
 * with the request itself, so nobody is notified about a request that did
 * not save. Shared by the self-service form and the API, so an ERP-side
 * portal applies for leave exactly the way an employee does here.
 */
export async function submitLeave(
  requester: RequesterActor,
  input: { employeeId: number; absenceTypeCode: string; fromDate: string; toDate: string; isHalfDay: boolean; reason: string | null },
): Promise<Result<Record<string, unknown>>> {
  const { employeeId, absenceTypeCode, fromDate, toDate, isHalfDay, reason } = input;
  if (!employeeId) return { error: "Choose an employee." };
  if (!isDate(fromDate)) return { error: "Enter a start date." };
  if (!isDate(toDate)) return { error: "Enter an end date." };
  if (toDate < fromDate) return { error: "The end date falls before the start date." };
  if (isHalfDay && fromDate !== toDate) return { error: "A half day covers a single date." };

  const [employee, type] = await Promise.all([
    getEmployee(employeeId),
    one("SELECT code, name FROM pt_absence_type WHERE code = ? AND is_active = 1", [absenceTypeCode]),
  ]);
  if (!employee) return { error: "That employee does not exist.", code: "not_found" };
  if (!type) return { error: `There is no active leave type ${absenceTypeCode}.` };

  const calendar = await calendarFor(employeeId, fromDate);
  const workingDays = await workingDaysBetween(fromDate, toDate, calendar);
  if (workingDays === 0) return { error: "That range has no working days in it — it falls on weekends or holidays." };
  const sandwichExtra = await sandwichDays(employeeId, absenceTypeCode, fromDate, toDate, calendar);
  const payrollDays = Math.round((isHalfDay ? 0.5 : workingDays + sandwichExtra) * 2) / 2;

  const who = fullName(employee);
  const range = formatDateRange(fromDate, toDate);
  const what = `${payrollDays} working ${payrollDays === 1 ? "day" : "days"} of ${String(type.name).toLowerCase()}`;
  const approval = {
    process: "leave" as const,
    subjectType: "pt_leave_request",
    subjectEmployeeId: employeeId,
    requester,
    summary: `${who}: ${what}, ${range}`,
    facts: { days: payrollDays },
  };

  let plan;
  try {
    plan = await planRequest({ ...approval, subjectId: 0 });
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Leave approval is not set up." };
  }

  const tx = await rawClient().transaction("write");
  try {
    const inserted = await tx.execute({
      sql: `INSERT INTO pt_leave_request
              (employee_id, absence_type_code, from_date, to_date, is_half_day, payroll_days, reason, status, submitted_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'Pending', ?) RETURNING *`,
      args: [employeeId, absenceTypeCode, fromDate, toDate, isHalfDay ? 1 : 0, payrollDays, reason, now()],
    });
    const request = inserted.rows[0] as unknown as Record<string, unknown>;
    const requestId = Number(request.id);
    await writeRequest(tx, { ...approval, subjectId: requestId }, plan);

    const items: NotificationItem[] = plan.recipients.map((userId) => ({
      userId,
      kind: "leave.submitted" as const,
      title: `${who} asked for leave: ${range}`,
      body: `${what.charAt(0).toUpperCase()}${what.slice(1)}` + (reason ? `. "${reason}"` : "."),
      link: "/approvals?process=leave",
      dedupeKey: `leave.submitted:${requestId}:${userId}`,
    }));

    const logActor: Actor = { type: "user", id: requester.userId, name: requester.username };
    const logged = changeStatement(logActor, {
      entity: "pt_leave_request",
      entityId: requestId,
      subjectEmployeeId: employeeId,
      action: "create",
      after: request,
    });
    if (logged) await tx.execute(logged);
    for (const st of await notificationStatements(items)) await tx.execute(st);
    await tx.commit();
    return { ok: true, value: request };
  } catch (err) {
    await tx.rollback();
    throw err;
  } finally {
    tx.close();
  }
}

/* -------------------------------------------------------------- payments */

async function checkPayment(employeeId: number, wageTypeCode: string, amountPaise: number): Promise<string | null> {
  if (!(amountPaise > 0)) return "Enter an amount above zero.";
  const [employee, wageType] = await Promise.all([
    one("SELECT id FROM pa_employee WHERE id = ?", [employeeId]),
    one("SELECT code, is_active, is_automatic FROM py_wage_type WHERE code = ?", [wageTypeCode]),
  ]);
  if (!employee) return "That employee does not exist.";
  if (!wageType || Number(wageType.is_active) !== 1) return `There is no active wage type ${wageTypeCode}.`;
  if (Number(wageType.is_automatic) === 1) return `${wageTypeCode} is calculated by payroll and cannot be entered.`;
  return null;
}

export async function addOneOffPayment(
  actor: Actor,
  input: { employeeId: number; wageTypeCode: string; amountPaise: number; paymentDate: string },
): Promise<Result<Record<string, unknown>>> {
  if (!isDate(input.paymentDate)) return { error: "Enter a payment date." };
  const problem = await checkPayment(input.employeeId, input.wageTypeCode, input.amountPaise);
  if (problem) return { error: problem };
  const r = await rawClient().execute({
    sql: `INSERT INTO py_it0015_additional_payment (employee_id, wage_type_code, amount_paise, payment_date, created_at)
          VALUES (?, ?, ?, ?, ?) RETURNING *`,
    args: [input.employeeId, input.wageTypeCode, input.amountPaise, input.paymentDate, now()],
  });
  const row = r.rows[0] as unknown as Record<string, unknown>;
  await recordChanges(actor, [
    { entity: "py_it0015_additional_payment", entityId: Number(row.id), subjectEmployeeId: input.employeeId, action: "create", after: row },
  ]);
  return { ok: true, value: row };
}

export async function addRecurringPayment(
  actor: Actor,
  input: { employeeId: number; wageTypeCode: string; amountPaise: number; startDate: string; endDate: string },
): Promise<Result<Record<string, unknown>>> {
  if (!isDate(input.startDate)) return { error: "Enter a start date." };
  if (!isDate(input.endDate)) return { error: "Enter an end date." };
  if (input.endDate < input.startDate) return { error: "The end date falls before the start date." };
  const problem = await checkPayment(input.employeeId, input.wageTypeCode, input.amountPaise);
  if (problem) return { error: problem };
  const r = await rawClient().execute({
    sql: `INSERT INTO py_it0014_recurring_payment (employee_id, wage_type_code, amount_paise, start_date, end_date, created_at)
          VALUES (?, ?, ?, ?, ?, ?) RETURNING *`,
    args: [input.employeeId, input.wageTypeCode, input.amountPaise, input.startDate, input.endDate, now()],
  });
  const row = r.rows[0] as unknown as Record<string, unknown>;
  await recordChanges(actor, [
    { entity: "py_it0014_recurring_payment", entityId: Number(row.id), subjectEmployeeId: input.employeeId, action: "create", after: row },
  ]);
  return { ok: true, value: row };
}

/* ------------------------------------------------------------ remittances */

export async function recordRemittancePayment(
  actor: Actor,
  id: number,
  input: { reference: string | null; paidOn?: string | null },
): Promise<Result<Record<string, unknown>>> {
  const before = await one("SELECT * FROM py_statutory_remittance WHERE id = ?", [id]);
  if (!before) return { error: "That remittance does not exist.", code: "not_found" };
  if (input.paidOn && !isDate(input.paidOn)) return { error: "paid_on is a date, YYYY-MM-DD." };
  const remittedAt = input.paidOn ? `${input.paidOn}T00:00:00.000Z` : now();
  const r = await rawClient().execute({
    sql: "UPDATE py_statutory_remittance SET status = 'Remitted', remitted_at = ?, reference = ? WHERE id = ? RETURNING *",
    args: [remittedAt, input.reference, id],
  });
  const after = r.rows[0] as unknown as Record<string, unknown>;
  await recordChanges(actor, [{ entity: "py_statutory_remittance", entityId: id, action: "update", before, after }]);
  return { ok: true, value: after };
}

/* -------------------------------------------------------- cost centres */

export async function upsertCostCentre(
  actor: Actor,
  code: string,
  input: { name: string; companyCode: string | null; isActive: boolean },
): Promise<Result<{ created: boolean; row: Record<string, unknown> }>> {
  if (!/^[A-Za-z0-9_.-]{1,40}$/.test(code)) return { error: "A cost centre code is 1 to 40 letters, digits, dots, hyphens or underscores." };
  if (!input.name.trim()) return { error: "Give the cost centre a name." };
  if (input.companyCode && !(await one("SELECT code FROM om_company WHERE code = ?", [input.companyCode]))) {
    return { error: `There is no company ${input.companyCode}.` };
  }
  const before = await one("SELECT * FROM om_cost_centre WHERE code = ?", [code]);
  const r = await rawClient().execute({
    sql: `INSERT INTO om_cost_centre (code, name, company_code, is_active, updated_at) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT (code) DO UPDATE SET name = excluded.name, company_code = excluded.company_code,
            is_active = excluded.is_active, updated_at = excluded.updated_at
          RETURNING *`,
    args: [code, input.name.trim(), input.companyCode, input.isActive ? 1 : 0, now()],
  });
  const row = r.rows[0] as unknown as Record<string, unknown>;
  await recordChanges(actor, [{ entity: "om_cost_centre", entityId: code, action: before ? "update" : "create", before, after: row }]);
  return { ok: true, value: { created: !before, row } };
}

export async function upsertGlAccount(
  actor: Actor,
  code: string,
  input: { name: string; kind: "expense" | "liability" | "asset"; isActive: boolean },
): Promise<Result<{ created: boolean; row: Record<string, unknown> }>> {
  if (!/^[A-Za-z0-9_.-]{1,40}$/.test(code)) return { error: "An account code is 1 to 40 letters, digits, dots, hyphens or underscores." };
  if (!input.name.trim()) return { error: "Give the account a name." };
  const before = await one("SELECT * FROM py_gl_account WHERE code = ?", [code]);
  const r = await rawClient().execute({
    sql: `INSERT INTO py_gl_account (code, name, kind, is_active, updated_at) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT (code) DO UPDATE SET name = excluded.name, kind = excluded.kind,
            is_active = excluded.is_active, updated_at = excluded.updated_at
          RETURNING *`,
    args: [code, input.name.trim(), input.kind, input.isActive ? 1 : 0, now()],
  });
  const row = r.rows[0] as unknown as Record<string, unknown>;
  await recordChanges(actor, [{ entity: "py_gl_account", entityId: code, action: before ? "update" : "create", before, after: row }]);
  return { ok: true, value: { created: !before, row } };
}
