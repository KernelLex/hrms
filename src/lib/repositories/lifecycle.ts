import "server-only";
import { rawClient } from "@/lib/db";
import { today } from "@/db/schema/_shared";

/**
 * Reads for onboarding, probation and letters: tasks assigned to a person,
 * one employee's checklist and monitoring, and the letters they have been
 * issued.
 */

const EMPLOYEE_NAME = `TRIM(COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, ''))`;

export type TaskRow = {
  id: number;
  task: string;
  ownerType: string;
  dueDate: string;
  status: string;
  overdue: boolean;
  employeeId: number;
  employeeName: string;
  employeeNumber: string;
};

const taskOf = (r: Record<string, unknown>, day: string): TaskRow => ({
  id: Number(r.id),
  task: String(r.task),
  ownerType: String(r.owner_type),
  dueDate: String(r.due_date),
  status: String(r.status),
  overdue: String(r.status) === "Pending" && String(r.due_date) < day,
  employeeId: Number(r.employee_id),
  employeeName: String(r.name) || String(r.employee_number),
  employeeNumber: String(r.employee_number),
});

const TASK_SELECT = `
  SELECT t.*, c.employee_id, e.employee_number, ${EMPLOYEE_NAME} AS name
  FROM pa_task t
  JOIN pa_checklist c ON c.id = t.checklist_id
  JOIN pa_employee e ON e.id = c.employee_id
  LEFT JOIN pa_it0002_personal_data p ON p.employee_id = e.id AND p.valid_from <= ?1 AND p.valid_to >= ?1`;

/** Tasks assigned to one person: open ones first (soonest due first), then what they finished lately. */
export async function tasksFor(userId: number): Promise<{ open: TaskRow[]; done: TaskRow[] }> {
  const day = today();
  const [open, done] = await Promise.all([
    rawClient().execute({ sql: `${TASK_SELECT} WHERE t.assigned_user_id = ?2 AND t.status = 'Pending' ORDER BY t.due_date`, args: [day, userId] }),
    rawClient().execute({ sql: `${TASK_SELECT} WHERE t.assigned_user_id = ?2 AND t.status = 'Done' ORDER BY t.done_at DESC LIMIT 20`, args: [day, userId] }),
  ]);
  return { open: open.rows.map((r) => taskOf(r as unknown as Record<string, unknown>, day)), done: done.rows.map((r) => taskOf(r as unknown as Record<string, unknown>, day)) };
}

export type ChecklistRow = {
  id: number;
  startedAt: string;
  completedAt: string | null;
  tasks: { id: number; task: string; ownerType: string; assigneeName: string | null; dueDate: string; status: string; doneAt: string | null }[];
};

/** One employee's onboarding checklist, with who each task is assigned to. */
export async function checklistFor(employeeId: number): Promise<ChecklistRow | null> {
  const checklist = (
    await rawClient().execute({ sql: "SELECT * FROM pa_checklist WHERE employee_id = ? AND event = 'onboarding'", args: [employeeId] })
  ).rows[0];
  if (!checklist) return null;
  const day = today();
  const tasks = await rawClient().execute({
    sql: `SELECT t.*, ${EMPLOYEE_NAME} AS assignee_name
          FROM pa_task t
          LEFT JOIN sec_app_user u ON u.id = t.assigned_user_id
          LEFT JOIN pa_it0002_personal_data p ON p.employee_id = u.employee_id AND p.valid_from <= ?2 AND p.valid_to >= ?2
          WHERE t.checklist_id = ?1 ORDER BY t.due_date`,
    args: [Number(checklist.id), day],
  });
  return {
    id: Number(checklist.id),
    startedAt: String(checklist.started_at),
    completedAt: checklist.completed_at === null ? null : String(checklist.completed_at),
    tasks: tasks.rows.map((t) => ({
      id: Number(t.id),
      task: String(t.task),
      ownerType: String(t.owner_type),
      assigneeName: t.assignee_name ? String(t.assignee_name) : null,
      dueDate: String(t.due_date),
      status: String(t.status),
      doneAt: t.done_at === null ? null : String(t.done_at),
    })),
  };
}

export type MonitoringRow = {
  id: number;
  monitoringType: string;
  date: string;
  status: string;
  note: string | null;
};

/** Every IT0019 row for one employee, newest first — extensions keep the ones they replaced. */
export async function monitoringFor(employeeId: number): Promise<MonitoringRow[]> {
  const r = await rawClient().execute({
    sql: "SELECT * FROM pa_it0019_monitoring WHERE employee_id = ? ORDER BY date DESC, id DESC",
    args: [employeeId],
  });
  return r.rows.map((m) => ({
    id: Number(m.id),
    monitoringType: String(m.monitoring_type),
    date: String(m.date),
    status: String(m.status),
    note: m.note === null ? null : String(m.note),
  }));
}

export type ProbationDueRow = {
  id: number;
  employeeId: number;
  employeeName: string;
  employeeNumber: string;
  positionTitle: string | null;
  date: string;
  overdue: boolean;
};

/** Reviews due within `withinDays`, or already overdue — for the Probation due screen. */
export async function probationDueList(withinDays: number): Promise<ProbationDueRow[]> {
  const day = today();
  const until = new Date(Date.now() + withinDays * 86_400_000).toISOString().slice(0, 10);
  const r = await rawClient().execute({
    sql: `SELECT m.*, e.employee_number, ${EMPLOYEE_NAME} AS name, pos.title AS position_title
          FROM pa_it0019_monitoring m
          JOIN pa_employee e ON e.id = m.employee_id
          LEFT JOIN pa_it0002_personal_data p ON p.employee_id = e.id AND p.valid_from <= ?1 AND p.valid_to >= ?1
          LEFT JOIN pa_it0001_org_assignment o ON o.employee_id = e.id AND o.valid_from <= ?1 AND o.valid_to >= ?1
          LEFT JOIN om_position pos ON pos.code = o.position_code
          WHERE m.monitoring_type = 'Probation review' AND m.status = 'Pending' AND m.date <= ?2
          ORDER BY m.date`,
    args: [day, until],
  });
  return r.rows.map((row) => ({
    id: Number(row.id),
    employeeId: Number(row.employee_id),
    employeeName: String(row.name) || String(row.employee_number),
    employeeNumber: String(row.employee_number),
    positionTitle: row.position_title === null ? null : String(row.position_title),
    date: String(row.date),
    overdue: String(row.date) < day,
  }));
}

export type LetterRow = {
  id: number;
  kind: string;
  issueDate: string;
  issuedBy: string;
  issuedAt: string;
  documentId: number | null;
};

export async function lettersFor(employeeId: number): Promise<LetterRow[]> {
  const r = await rawClient().execute({ sql: "SELECT * FROM pa_letter WHERE employee_id = ? ORDER BY issued_at DESC", args: [employeeId] });
  return r.rows.map((l) => ({
    id: Number(l.id),
    kind: String(l.kind),
    issueDate: String(l.issue_date),
    issuedBy: String(l.issued_by),
    issuedAt: String(l.issued_at),
    documentId: l.document_id === null ? null : Number(l.document_id),
  }));
}

export type LetterTemplateRow = { id: number; kind: string; version: number; body: string; createdAt: string };

/** The active version of every letter kind. */
export async function letterTemplates(): Promise<LetterTemplateRow[]> {
  const r = await rawClient().execute("SELECT * FROM pa_letter_template WHERE is_active = 1 ORDER BY kind");
  return r.rows.map((t) => ({ id: Number(t.id), kind: String(t.kind), version: Number(t.version), body: String(t.body), createdAt: String(t.created_at) }));
}
