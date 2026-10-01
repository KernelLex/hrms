import "server-only";
import type { InStatement, ResultSet } from "@libsql/client";
import { changeStatement, type Actor } from "@/lib/change-log";

/**
 * Starting a checklist for a new employee: the active onboarding template's
 * tasks, each assigned to a real person, and a probation review dated from
 * policy. Runs inside the caller's own transaction, so it commits — or not —
 * with the hire itself, and is called from every path that creates an
 * employee: Core HR's hire action, recruitment's conversion, and the API.
 *
 * `pa_checklist_template`'s items are the plan; `pa_task` rows are the
 * instances this writes, each a snapshot of its task text and a resolved
 * assignee, so editing the template later never rewrites anyone's history.
 */

type Executor = { execute(stmt: InStatement): Promise<ResultSet> };

/** Days after the hire date probation is reviewed, until policies are configurable (§10). */
export const PROBATION_DAYS = 90;

/** The day after `date`, `days` times — UTC, so it never shifts on a client's clock. */
export function addDaysTo(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Whoever holds the position this position reports to, if their post is filled. */
async function reportingManagerUserId(tx: Executor, positionCode: string, asOf: string): Promise<number | null> {
  const r = await tx.execute({
    sql: `SELECT u.id FROM om_position pos
          JOIN pa_it0001_org_assignment theirs ON theirs.position_code = pos.reports_to_code
            AND theirs.valid_from <= ?2 AND theirs.valid_to >= ?2
          JOIN sec_app_user u ON u.employee_id = theirs.employee_id AND u.is_active = 1
          WHERE pos.code = ?1 LIMIT 1`,
    args: [positionCode, asOf],
  });
  return r.rows[0] ? Number(r.rows[0].id) : null;
}

/** The first (lowest id) active person holding HR_ADMIN — a deterministic stand-in for "HR". */
async function anyHrUserId(tx: Executor): Promise<number | null> {
  const r = await tx.execute(
    `SELECT u.id FROM sec_app_user u JOIN sec_user_role ur ON ur.user_id = u.id
     WHERE ur.role_code = 'HR_ADMIN' AND u.is_active = 1 ORDER BY u.id LIMIT 1`,
  );
  return r.rows[0] ? Number(r.rows[0].id) : null;
}

export type StartOnboardingInput = {
  employeeId: number;
  positionCode: string;
  effectiveDate: string;
  createdBy: string;
};

export async function startOnboarding(tx: Executor, actor: Actor, input: StartOnboardingInput): Promise<void> {
  const template = await tx.execute(
    "SELECT id FROM pa_checklist_template WHERE event = 'onboarding' AND is_active = 1 ORDER BY id LIMIT 1",
  );
  const templateId = template.rows[0] ? Number(template.rows[0].id) : null;
  const at = new Date().toISOString();

  const checklist = await tx.execute({
    sql: "INSERT INTO pa_checklist (employee_id, template_id, event, started_at) VALUES (?, ?, 'onboarding', ?) RETURNING id",
    args: [input.employeeId, templateId, at],
  });
  const checklistId = Number(checklist.rows[0].id);
  const loggedChecklist = changeStatement(actor, {
    entity: "pa_checklist",
    entityId: checklistId,
    subjectEmployeeId: input.employeeId,
    action: "create",
    after: { employeeId: input.employeeId, templateId, event: "onboarding" },
  });
  if (loggedChecklist) await tx.execute(loggedChecklist);

  if (templateId) {
    const items = await tx.execute({
      sql: "SELECT * FROM pa_checklist_item WHERE template_id = ? ORDER BY sort_order",
      args: [templateId],
    });
    const [manager, hr] = await Promise.all([
      reportingManagerUserId(tx, input.positionCode, input.effectiveDate),
      anyHrUserId(tx),
    ]);
    for (const item of items.rows) {
      const ownerType = String(item.owner_type);
      const assignee = ownerType === "reporting_manager" ? manager : hr;
      await tx.execute({
        sql: `INSERT INTO pa_task (checklist_id, task, owner_type, assigned_user_id, due_date, status, created_at)
              VALUES (?, ?, ?, ?, ?, 'Pending', ?)`,
        args: [checklistId, String(item.task), ownerType, assignee, addDaysTo(input.effectiveDate, Number(item.due_days)), at],
      });
    }
  }

  const monitoring = await tx.execute({
    sql: `INSERT INTO pa_it0019_monitoring (employee_id, monitoring_type, date, status, created_by, created_at)
          VALUES (?, 'Probation review', ?, 'Pending', ?, ?) RETURNING id`,
    args: [input.employeeId, addDaysTo(input.effectiveDate, PROBATION_DAYS), input.createdBy, at],
  });
  const loggedMonitoring = changeStatement(actor, {
    entity: "pa_it0019_monitoring",
    entityId: Number(monitoring.rows[0].id),
    subjectEmployeeId: input.employeeId,
    action: "create",
    after: { monitoringType: "Probation review", date: addDaysTo(input.effectiveDate, PROBATION_DAYS) },
  });
  if (loggedMonitoring) await tx.execute(loggedMonitoring);
}

export type StartOffboardingInput = {
  employeeId: number;
  effectiveDate: string;
  createdBy: string;
};

/**
 * Starting an offboarding checklist on an exit's last day — the same shape
 * `startOnboarding` writes, against the "offboarding" template instead, and
 * with no probation review to schedule.
 */
export async function startOffboarding(tx: Executor, actor: Actor, input: StartOffboardingInput): Promise<void> {
  const template = await tx.execute(
    "SELECT id FROM pa_checklist_template WHERE event = 'offboarding' AND is_active = 1 ORDER BY id LIMIT 1",
  );
  const templateId = template.rows[0] ? Number(template.rows[0].id) : null;
  const at = new Date().toISOString();

  const checklist = await tx.execute({
    sql: "INSERT INTO pa_checklist (employee_id, template_id, event, started_at) VALUES (?, ?, 'offboarding', ?) RETURNING id",
    args: [input.employeeId, templateId, at],
  });
  const checklistId = Number(checklist.rows[0].id);
  const loggedChecklist = changeStatement(actor, {
    entity: "pa_checklist",
    entityId: checklistId,
    subjectEmployeeId: input.employeeId,
    action: "create",
    after: { employeeId: input.employeeId, templateId, event: "offboarding" },
  });
  if (loggedChecklist) await tx.execute(loggedChecklist);
  if (!templateId) return;

  const items = await tx.execute({
    sql: "SELECT * FROM pa_checklist_item WHERE template_id = ? ORDER BY sort_order",
    args: [templateId],
  });
  // Whoever is about to leave reported to someone for the last time today.
  const position = await tx.execute({
    sql: `SELECT position_code FROM pa_it0001_org_assignment WHERE employee_id = ? AND valid_from <= ? AND valid_to >= ? LIMIT 1`,
    args: [input.employeeId, input.effectiveDate, input.effectiveDate],
  });
  const positionCode = position.rows[0] ? String(position.rows[0].position_code) : null;
  const [manager, hr] = await Promise.all([
    positionCode ? reportingManagerUserId(tx, positionCode, input.effectiveDate) : Promise.resolve(null),
    anyHrUserId(tx),
  ]);
  for (const item of items.rows) {
    const ownerType = String(item.owner_type);
    const assignee = ownerType === "reporting_manager" ? manager : hr;
    await tx.execute({
      sql: `INSERT INTO pa_task (checklist_id, task, owner_type, assigned_user_id, due_date, status, created_at)
            VALUES (?, ?, ?, ?, ?, 'Pending', ?)`,
      args: [checklistId, String(item.task), ownerType, assignee, addDaysTo(input.effectiveDate, Number(item.due_days)), at],
    });
  }
}

/**
 * Marks a checklist done once every one of its tasks is — called after a
 * task is completed. Logged, so it derives the `onboarding.completed` event.
 */
export async function completeChecklistIfDone(tx: Executor, actor: Actor, checklistId: number): Promise<void> {
  const remaining = await tx.execute({
    sql: "SELECT COUNT(*) AS n FROM pa_task WHERE checklist_id = ? AND status <> 'Done'",
    args: [checklistId],
  });
  if (Number(remaining.rows[0].n) > 0) return;
  const row = await tx.execute({ sql: "SELECT * FROM pa_checklist WHERE id = ?", args: [checklistId] });
  const checklist = row.rows[0] as unknown as Record<string, unknown> | undefined;
  if (!checklist || checklist.completed_at) return;
  const at = new Date().toISOString();
  await tx.execute({ sql: "UPDATE pa_checklist SET completed_at = ? WHERE id = ?", args: [at, checklistId] });
  const logged = changeStatement(actor, {
    entity: "pa_checklist",
    entityId: checklistId,
    subjectEmployeeId: Number(checklist.employee_id),
    action: "update",
    before: { completed_at: null },
    after: { completed_at: at },
  });
  if (logged) await tx.execute(logged);
}
