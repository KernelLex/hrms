import "server-only";
import { rawClient } from "@/lib/db";
import { now } from "@/db/schema";
import { todayInIndia } from "@/lib/dates";
import { changeStatement, type Actor } from "@/lib/change-log";
import { writeTimeSlice, SLICED_TABLES } from "@/lib/engines/timeslice";
import { addDaysTo } from "./checklist";
import type { Result } from "./result";

/**
 * Deciding a probation review: confirm it, push the date out, or end the
 * employment. A direct HR action rather than a routed approval — unlike
 * leave and corrections, nobody but HR is asked to decide it, so there is
 * no one else to route it to. Full exit management (notice, clearance,
 * settlement) is phase 20; ending here is the same primitive payroll
 * already prorates a leaver by (`employment_status`, `termination_date`),
 * without the rest of that process.
 */

const one = async (sql: string, args: (string | number)[]) =>
  (await rawClient().execute({ sql, args })).rows[0] as Record<string, unknown> | undefined;

async function pendingReview(monitoringId: number): Promise<Result<{ id: number; employeeId: number; date: string }>> {
  const row = await one(
    "SELECT * FROM pa_it0019_monitoring WHERE id = ? AND monitoring_type = 'Probation review'",
    [monitoringId],
  );
  if (!row) return { error: "That review no longer exists.", code: "not_found" };
  if (String(row.status) !== "Pending") return { error: `That review was already ${String(row.status).toLowerCase()}.` };
  return { ok: true, value: { id: Number(row.id), employeeId: Number(row.employee_id), date: String(row.date) } };
}

/** Claims the pending row, inside the caller's transaction, so two decisions can never both land. */
async function claim(tx: { execute: (s: { sql: string; args: (string | number | null)[] }) => Promise<{ rowsAffected: number }> }, id: number, status: string, note: string | null) {
  const claimed = await tx.execute({
    sql: "UPDATE pa_it0019_monitoring SET status = ?, note = COALESCE(?, note) WHERE id = ? AND status = 'Pending'",
    args: [status, note, id],
  });
  return claimed.rowsAffected > 0;
}

export async function confirmProbation(actor: Actor, monitoringId: number, note: string | null, decidedBy: string): Promise<Result<null>> {
  const found = await pendingReview(monitoringId);
  if (!found.ok) return found;
  const { id, employeeId } = found.value;
  const effectiveDate = todayInIndia();

  const tx = await rawClient().transaction("write");
  try {
    if (!(await claim(tx, id, "Confirmed", note))) {
      await tx.rollback();
      return { error: "That review was decided a moment ago. Reload to see the outcome." };
    }
    await writeTimeSlice(tx, {
      table: SLICED_TABLES.action,
      employeeId,
      validFrom: effectiveDate,
      data: { action_type: "Confirmation", reason: note },
      createdBy: decidedBy,
      actor,
      reason: note,
    });
    const logged = changeStatement(actor, {
      entity: "pa_it0019_monitoring",
      entityId: id,
      subjectEmployeeId: employeeId,
      action: "update",
      before: { status: "Pending" },
      after: { status: "Confirmed", note },
    });
    if (logged) await tx.execute(logged);
    await tx.commit();
  } catch (err) {
    await tx.rollback();
    return { error: err instanceof Error ? err.message : "The record could not be updated." };
  } finally {
    tx.close();
  }
  return { ok: true, value: null };
}

export async function extendProbation(
  actor: Actor,
  monitoringId: number,
  newDate: string,
  note: string | null,
  decidedBy: string,
): Promise<Result<null>> {
  const found = await pendingReview(monitoringId);
  if (!found.ok) return found;
  const { id, employeeId, date } = found.value;
  if (newDate <= date) return { error: "The new date must be after the one it replaces." };

  const at = now();
  const tx = await rawClient().transaction("write");
  try {
    if (!(await claim(tx, id, "Extended", note))) {
      await tx.rollback();
      return { error: "That review was decided a moment ago. Reload to see the outcome." };
    }
    const next = await tx.execute({
      sql: `INSERT INTO pa_it0019_monitoring (employee_id, monitoring_type, date, status, note, created_by, created_at)
            VALUES (?, 'Probation review', ?, 'Pending', ?, ?, ?) RETURNING id`,
      args: [employeeId, newDate, note, decidedBy, at],
    });
    const logged = [
      changeStatement(actor, {
        entity: "pa_it0019_monitoring",
        entityId: id,
        subjectEmployeeId: employeeId,
        action: "update",
        before: { status: "Pending", date },
        after: { status: "Extended", date: newDate },
      }),
      changeStatement(actor, {
        entity: "pa_it0019_monitoring",
        entityId: Number(next.rows[0].id),
        subjectEmployeeId: employeeId,
        action: "create",
        after: { monitoringType: "Probation review", date: newDate, note },
        reason: `Extended from ${date}`,
      }),
    ];
    for (const st of logged) if (st) await tx.execute(st);
    await tx.commit();
  } catch (err) {
    await tx.rollback();
    return { error: err instanceof Error ? err.message : "The record could not be updated." };
  } finally {
    tx.close();
  }
  return { ok: true, value: null };
}

export async function endProbation(actor: Actor, monitoringId: number, effectiveDate: string, note: string | null, decidedBy: string): Promise<Result<null>> {
  const found = await pendingReview(monitoringId);
  if (!found.ok) return found;
  const { id, employeeId } = found.value;
  const employee = await one("SELECT hire_date FROM pa_employee WHERE id = ?", [employeeId]);
  if (employee && effectiveDate < String(employee.hire_date)) return { error: "The date cannot fall before they joined." };

  const tx = await rawClient().transaction("write");
  try {
    if (!(await claim(tx, id, "Ended", note))) {
      await tx.rollback();
      return { error: "That review was decided a moment ago. Reload to see the outcome." };
    }
    await writeTimeSlice(tx, {
      table: SLICED_TABLES.action,
      employeeId,
      validFrom: effectiveDate,
      data: { action_type: "End of probation", reason: note },
      createdBy: decidedBy,
      actor,
      reason: note,
    });
    await tx.execute({
      sql: "UPDATE pa_employee SET employment_status = 'Terminated', termination_date = ? WHERE id = ?",
      args: [effectiveDate, employeeId],
    });
    const position = await tx.execute({
      sql: `SELECT position_code FROM pa_it0001_org_assignment
            WHERE employee_id = ? AND valid_from <= ? AND valid_to >= ? LIMIT 1`,
      args: [employeeId, effectiveDate, effectiveDate],
    });
    const positionCode = position.rows[0] ? String(position.rows[0].position_code) : null;
    if (positionCode) await tx.execute({ sql: "UPDATE om_position SET is_vacant = 1 WHERE code = ?", args: [positionCode] });

    const logged = [
      changeStatement(actor, {
        entity: "pa_it0019_monitoring",
        entityId: id,
        subjectEmployeeId: employeeId,
        action: "update",
        before: { status: "Pending" },
        after: { status: "Ended", note },
      }),
      changeStatement(actor, {
        entity: "pa_employee",
        entityId: employeeId,
        subjectEmployeeId: employeeId,
        action: "update",
        before: { employment_status: "Active" },
        after: { employment_status: "Terminated", termination_date: effectiveDate },
        reason: note ?? "Probation not confirmed",
      }),
      ...(positionCode
        ? [changeStatement(actor, { entity: "om_position", entityId: positionCode, action: "update", before: { isVacant: false }, after: { isVacant: true }, reason: "Vacated at end of probation" })]
        : []),
    ];
    for (const st of logged) if (st) await tx.execute(st);
    await tx.commit();
  } catch (err) {
    await tx.rollback();
    return { error: err instanceof Error ? err.message : "The record could not be updated." };
  } finally {
    tx.close();
  }
  return { ok: true, value: null };
}

/** Rows due for review within `withinDays`, or already overdue — for the list screen and the reminder job. */
export async function probationDue(withinDays: number): Promise<
  { id: number; employeeId: number; date: string; overdue: boolean; remindedAt: string | null }[]
> {
  const r = await rawClient().execute({
    sql: `SELECT * FROM pa_it0019_monitoring
          WHERE monitoring_type = 'Probation review' AND status = 'Pending' AND date <= ?
          ORDER BY date`,
    args: [addDaysTo(new Date().toISOString().slice(0, 10), withinDays)],
  });
  const today = new Date().toISOString().slice(0, 10);
  return r.rows.map((row) => ({
    id: Number(row.id),
    employeeId: Number(row.employee_id),
    date: String(row.date),
    overdue: String(row.date) < today,
    remindedAt: row.reminded_at === null ? null : String(row.reminded_at),
  }));
}
