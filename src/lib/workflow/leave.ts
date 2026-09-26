import "server-only";
import type { InStatement } from "@libsql/client";
import { changeStatement, type Actor as LogActor } from "@/lib/change-log";
import { calendarDaysBetween, daysToUnits, shortfall } from "@/lib/engines/quota";
import { formatDateRange } from "@/lib/dates";
import type { NotificationItem } from "@/lib/notifications";
import type { Completion } from "./engine";

/**
 * What deciding a leave request does, inside the engine's transaction.
 *
 * Approving claims the request, takes the days from the quota with an update
 * that refuses to overdraw, writes the absence, logs each change and tells
 * the employee. Rejecting marks the request and tells them. Any refusal rolls
 * the whole decision back, so the request is still waiting.
 */
export const completeLeave: Completion = async (tx, request, outcome) => {
  const { decision, actor, comment, decidedAt } = outcome;
  const logActor: LogActor = { type: "user", id: actor.userId, name: actor.username };
  const r = await tx.execute({
    sql: "SELECT * FROM pt_leave_request WHERE id = ?",
    args: [Number(request.subjectId)],
  });
  const leave = r.rows[0] as unknown as Record<string, unknown> | undefined;
  if (!leave) return { error: "That leave request no longer exists." };

  const id = Number(leave.id);
  const employeeId = Number(leave.employee_id);
  const fromDate = String(leave.from_date);
  const toDate = String(leave.to_date);
  const payrollDays = Number(leave.payroll_days);
  const approved = decision === "Approved";

  const claimed = await tx.execute({
    sql: `UPDATE pt_leave_request
          SET status = ?, decided_at = ?, decided_by_employee_id = ?, decision_note = ?
          WHERE id = ? AND status = 'Pending'`,
    args: [decision, decidedAt, actor.employeeId, comment, id],
  });
  if (claimed.rowsAffected === 0) {
    return { error: `That request was already ${String(leave.status).toLowerCase()}.` };
  }
  const statements: (InStatement | null)[] = [
    changeStatement(logActor, {
      entity: "pt_leave_request",
      entityId: id,
      subjectEmployeeId: employeeId,
      action: "update",
      before: leave,
      after: {
        ...leave,
        status: decision,
        decided_at: decidedAt,
        decided_by_employee_id: actor.employeeId,
        decision_note: comment,
      },
    }),
  ];

  if (approved) {
    const typeRow = await tx.execute({
      sql: "SELECT * FROM pt_absence_type WHERE code = ?",
      args: [String(leave.absence_type_code)],
    });
    const type = typeRow.rows[0];
    if (!type) return { error: "That leave type no longer exists." };

    if (Number(type.counts_against_quota) === 1 && type.quota_type_code) {
      const year = Number(fromDate.slice(0, 4));
      const units = daysToUnits(payrollDays);
      const quotaRow = await tx.execute({
        sql: `SELECT * FROM pt_it2006_absence_quota
              WHERE employee_id = ? AND quota_type_code = ? AND year = ?`,
        args: [employeeId, String(type.quota_type_code), year],
      });
      const quota = quotaRow.rows[0] as unknown as Record<string, unknown> | undefined;
      if (!quota) {
        return { error: `No ${String(type.quota_type_code)} entitlement exists for ${year}. Generate the quota first.` };
      }
      const taken = await tx.execute({
        sql: `UPDATE pt_it2006_absence_quota SET used_half_days = used_half_days + ?1
              WHERE id = ?2 AND entitled_half_days - used_half_days >= ?1`,
        args: [units, Number(quota.id)],
      });
      if (taken.rowsAffected === 0) {
        return { error: shortfall(units, Number(quota.entitled_half_days) - Number(quota.used_half_days)) };
      }
      statements.push(
        changeStatement(logActor, {
          entity: "pt_it2006_absence_quota",
          entityId: Number(quota.id),
          subjectEmployeeId: employeeId,
          action: "update",
          before: quota,
          after: { ...quota, used_half_days: Number(quota.used_half_days) + units },
        }),
      );
    }

    const absence = await tx.execute({
      sql: `INSERT INTO pt_it2001_absence
              (employee_id, absence_type_code, start_date, end_date, payroll_days, calendar_days,
               is_half_day, remarks, source_request_id, created_by, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
      args: [
        employeeId,
        String(leave.absence_type_code),
        fromDate,
        toDate,
        Math.round(payrollDays),
        calendarDaysBetween(fromDate, toDate),
        Number(leave.is_half_day) === 1 ? 1 : 0,
        leave.reason === null ? null : String(leave.reason),
        id,
        actor.username,
        decidedAt,
      ],
    });
    const row = absence.rows[0] as unknown as Record<string, unknown>;
    statements.push(
      changeStatement(logActor, {
        entity: "pt_it2001_absence",
        entityId: Number(row.id),
        subjectEmployeeId: employeeId,
        action: "create",
        after: row,
      }),
    );
  }

  for (const st of statements) if (st) await tx.execute(st);

  const user = await tx.execute({
    sql: "SELECT id FROM sec_app_user WHERE employee_id = ? AND is_active = 1 LIMIT 1",
    args: [employeeId],
  });
  const range = formatDateRange(fromDate, toDate);
  const notices: NotificationItem[] = user.rows[0]
    ? [
        {
          userId: Number(user.rows[0].id),
          kind: "leave.decided",
          title: approved ? `Your leave for ${range} was approved` : `Your leave for ${range} was not approved`,
          body: comment ?? (approved ? "Enjoy the time off." : "Talk to your manager if you want to ask again."),
          link: "/time/my-leave",
          dedupeKey: `leave.decided:${id}`,
        },
      ]
    : [];
  return { notices };
};
