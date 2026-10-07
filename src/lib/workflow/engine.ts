import "server-only";
import type { InStatement, ResultSet, Transaction } from "@libsql/client";
import { rawClient } from "@/lib/db";
import { todayInIndia } from "@/lib/dates";
import { notificationStatements, type NotificationItem } from "@/lib/notifications";
import {
  PROCESSES,
  applicableSteps,
  type ApproverType,
  type ProcessCode,
  type StepDef,
} from "./processes";
import { COMPLETIONS } from "./completions";

/**
 * The approval engine: `startRequest`, `decide`, `cancelRequest`, and
 * `resolveApprovers` with delegation and escalation.
 *
 * A request follows the flow version that was active when it started. Each
 * step resolves to assignees; whoever is assigned, or a delegate standing in
 * for them today, or anyone who may decide every request in the process, can
 * decide. Deciding is one transaction: a conditional claim on the request, the
 * action with on whose behalf it was taken, and either the next step's
 * assignees or the process's own completion — for leave, the quota, the
 * absence and the employee's notification.
 */

type Executor = { execute(stmt: InStatement): Promise<ResultSet> };

export type Actor = {
  userId: number;
  username: string;
  displayName: string;
  employeeId: number | null;
};

export type RequestRow = {
  id: number;
  process: ProcessCode;
  flowId: number;
  subjectType: string;
  subjectId: string;
  subjectEmployeeId: number | null;
  requesterUserId: number | null;
  summary: string;
  facts: Record<string, number>;
  status: string;
  currentStep: number;
  stepStartedAt: string;
  createdAt: string;
};

/** What completing a request does, per process, inside the deciding transaction. */
export type Completion = (
  tx: Transaction,
  request: RequestRow,
  outcome: { decision: "Approved" | "Rejected"; actor: Actor; comment: string | null; decidedAt: string },
) => Promise<{ error?: string; notices?: NotificationItem[] }>;

const nowIso = () => new Date().toISOString();

function toRequest(row: Record<string, unknown>): RequestRow {
  return {
    id: Number(row.id),
    process: String(row.process) as ProcessCode,
    flowId: Number(row.flow_id),
    subjectType: String(row.subject_type),
    subjectId: String(row.subject_id),
    subjectEmployeeId: row.subject_employee_id === null ? null : Number(row.subject_employee_id),
    requesterUserId: row.requester_user_id === null ? null : Number(row.requester_user_id),
    summary: String(row.summary),
    facts: row.facts ? (JSON.parse(String(row.facts)) as Record<string, number>) : {},
    status: String(row.status),
    currentStep: Number(row.current_step),
    stepStartedAt: String(row.step_started_at),
    createdAt: String(row.created_at),
  };
}

/* ----------------------------------------------------------------- flows */

export async function activeFlow(
  process: ProcessCode,
  executor: Executor = rawClient(),
): Promise<{ id: number; version: number } | null> {
  const r = await executor.execute({
    sql: `SELECT id, version FROM wf_flow WHERE process = ? AND is_active = 1
          ORDER BY version DESC LIMIT 1`,
    args: [process],
  });
  const row = r.rows[0];
  return row ? { id: Number(row.id), version: Number(row.version) } : null;
}

export async function flowSteps(flowId: number, executor: Executor = rawClient()): Promise<StepDef[]> {
  const r = await executor.execute({
    sql: `SELECT step_order, approver_type, approver_role, approver_user_id,
                 condition_field, condition_min, escalate_after_days
          FROM wf_step WHERE flow_id = ? ORDER BY step_order`,
    args: [flowId],
  });
  return r.rows.map((s) => ({
    stepOrder: Number(s.step_order),
    approverType: String(s.approver_type) as ApproverType,
    approverRole: s.approver_role === null ? null : String(s.approver_role),
    approverUserId: s.approver_user_id === null ? null : Number(s.approver_user_id),
    conditionField: s.condition_field === null ? null : String(s.condition_field),
    conditionMin: s.condition_min === null ? null : Number(s.condition_min),
    escalateAfterDays: s.escalate_after_days === null ? null : Number(s.escalate_after_days),
  }));
}

/* ------------------------------------------------------------- approvers */

/** The sign-ins of whoever holds the position an employee's position reports to. */
async function managersOf(employeeIds: number[], executor: Executor): Promise<{ userId: number; employeeId: number }[]> {
  if (employeeIds.length === 0) return [];
  const d = todayInIndia();
  const r = await executor.execute({
    sql: `SELECT DISTINCT u.id AS user_id, theirs.employee_id
          FROM pa_it0001_org_assignment mine
          JOIN om_position pos ON pos.code = mine.position_code
          JOIN pa_it0001_org_assignment theirs
            ON theirs.position_code = pos.reports_to_code
           AND theirs.valid_from <= ?1 AND theirs.valid_to >= ?1
          JOIN sec_app_user u ON u.employee_id = theirs.employee_id AND u.is_active = 1
          WHERE mine.valid_from <= ?1 AND mine.valid_to >= ?1
            AND mine.employee_id IN (${employeeIds.map(() => "?").join(", ")})`,
    args: [d, ...employeeIds],
  });
  return r.rows.map((m) => ({ userId: Number(m.user_id), employeeId: Number(m.employee_id) }));
}

/**
 * Whether one employee reports to another today — the same reporting line
 * every "reporting_manager" step resolves through, so a manager acting on
 * their own team is judged by exactly the rule that routes approvals to them.
 */
export async function managesEmployee(managerEmployeeId: number, employeeId: number): Promise<boolean> {
  const managers = await managersOf([employeeId], rawClient());
  return managers.some((m) => m.employeeId === managerEmployeeId);
}

async function usersWithRole(role: string, executor: Executor): Promise<number[]> {
  const r = await executor.execute({
    sql: `SELECT u.id FROM sec_user_role ur JOIN sec_app_user u ON u.id = ur.user_id AND u.is_active = 1
          WHERE ur.role_code = ? ORDER BY u.id`,
    args: [role],
  });
  return r.rows.map((u) => Number(u.id));
}

/**
 * Who a step goes to. Never the person who asked; and when a step resolves
 * to nobody — no manager above, a role nobody holds — to HR, so a request
 * can never wait on no one.
 */
export async function resolveApprovers(
  step: StepDef,
  request: { subjectEmployeeId: number | null; requesterUserId: number | null },
  executor: Executor = rawClient(),
  /** People who may not take this step: those who approved an earlier one, where the process needs two people. */
  exclude: number[] = [],
): Promise<number[]> {
  let users: number[] = [];
  const subject = request.subjectEmployeeId;
  if (step.approverType === "reporting_manager" && subject) {
    users = (await managersOf([subject], executor)).map((m) => m.userId);
  } else if (step.approverType === "manager_of_manager" && subject) {
    const managers = await managersOf([subject], executor);
    users = (await managersOf(managers.map((m) => m.employeeId), executor)).map((m) => m.userId);
  } else if (step.approverType === "role" && step.approverRole) {
    users = await usersWithRole(step.approverRole, executor);
  } else if (step.approverType === "person" && step.approverUserId) {
    const r = await executor.execute({
      sql: "SELECT id FROM sec_app_user WHERE id = ? AND is_active = 1",
      args: [step.approverUserId],
    });
    users = r.rows.map((u) => Number(u.id));
  }
  const allowed = (u: number) => u !== request.requesterUserId && !exclude.includes(u);
  users = [...new Set(users)].filter(allowed);
  if (users.length === 0) {
    users = (await usersWithRole("HR_ADMIN", executor)).filter(allowed);
  }
  return users;
}

/**
 * Whether this person could ever be asked to approve something, which is
 * what makes handing their approvals over while they are away meaningful.
 * True when requests can reach them: they have people reporting to them, a
 * flow step names their role or names them, or they can override a process's
 * decisions outright. Someone who approves nothing is not offered the
 * hand-over, since there would be nothing to hand.
 */
export async function isApprover(userId: number, employeeId: number | null): Promise<boolean> {
  const d = todayInIndia();
  const r = await rawClient().execute({
    sql: `SELECT
            EXISTS (SELECT 1
                      FROM pa_it0001_org_assignment mine
                      JOIN om_position pos ON pos.code = mine.position_code
                      JOIN pa_it0001_org_assignment theirs ON theirs.position_code = pos.reports_to_code
                     WHERE mine.valid_from <= ?3 AND mine.valid_to >= ?3
                       AND theirs.valid_from <= ?3 AND theirs.valid_to >= ?3
                       AND theirs.employee_id = ?2) AS has_reports,
            EXISTS (SELECT 1 FROM wf_step s
                      JOIN wf_flow f ON f.id = s.flow_id AND f.is_active = 1
                     WHERE (s.approver_type = 'person' AND s.approver_user_id = ?1)
                        OR (s.approver_type = 'role' AND s.approver_role IN
                              (SELECT role_code FROM sec_user_role WHERE user_id = ?1))) AS named,
            EXISTS (SELECT 1 FROM sec_user_role ur
                      JOIN sec_role_permission rp ON rp.role_code = ur.role_code
                     WHERE ur.user_id = ?1 AND rp.permission_code IN ('leave.decide_any', 'access.manage')) AS overrides,
            EXISTS (SELECT 1 FROM wf_assignee a WHERE a.user_id = ?1) AS asked_before`,
    args: [userId, employeeId ?? 0, d],
  });
  const row = r.rows[0];
  return Boolean(Number(row.has_reports) || Number(row.named) || Number(row.overrides) || Number(row.asked_before));
}

/* ------------------------------------------------------------- delegation */

/** Active today, and covering this process. */
const DELEGATION_ACTIVE = `d.ended_at IS NULL AND d.from_date <= ?date AND d.to_date >= ?date
  AND (d.processes IS NULL OR ',' || d.processes || ',' LIKE '%,' || ?process || ',%')`;

function delegationSql(sql: string): (date: string, process: string) => { sql: string; args: string[] } {
  return (date, process) => {
    const args: string[] = [];
    const out = sql.replace(/\?(date|process)/g, (_, k: string) => {
      args.push(k === "date" ? date : process);
      return "?";
    });
    return { sql: out, args };
  };
}

/**
 * Who should hear that a step is waiting: each assignee, or the person they
 * have handed their approvals to while they are away.
 */
export async function recipientsFor(
  process: ProcessCode,
  assignees: number[],
  executor: Executor = rawClient(),
): Promise<number[]> {
  if (assignees.length === 0) return [];
  const active = delegationSql(DELEGATION_ACTIVE)(todayInIndia(), process);
  const r = await executor.execute({
    sql: `SELECT d.from_user_id, d.to_user_id FROM wf_delegation d
          WHERE ${active.sql} AND d.from_user_id IN (${assignees.map(() => "?").join(", ")})
          ORDER BY d.id DESC`,
    args: [...active.args, ...assignees],
  });
  const to = new Map<number, number>();
  for (const d of r.rows) if (!to.has(Number(d.from_user_id))) to.set(Number(d.from_user_id), Number(d.to_user_id));
  return [...new Set(assignees.map((a) => to.get(a) ?? a))];
}

/** The assignees a person stands in for today, in a process. */
async function standingInFor(userId: number, process: string, executor: Executor): Promise<number[]> {
  const active = delegationSql(DELEGATION_ACTIVE)(todayInIndia(), process);
  const r = await executor.execute({
    sql: `SELECT DISTINCT d.from_user_id FROM wf_delegation d WHERE ${active.sql} AND d.to_user_id = ?`,
    args: [...active.args, userId],
  });
  return r.rows.map((d) => Number(d.from_user_id));
}

/* ----------------------------------------------------------------- start */

export type StartInput = {
  process: ProcessCode;
  subjectType: string;
  subjectId: string | number;
  subjectEmployeeId: number | null;
  requester: Actor;
  summary: string;
  facts: Record<string, number>;
};

/**
 * Everything a new request needs, read before the caller's transaction: the
 * flow, the first step's assignees and who is told.
 */
export async function planRequest(input: StartInput): Promise<{
  flowId: number;
  steps: StepDef[];
  assignees: number[];
  recipients: number[];
}> {
  const flow = await activeFlow(input.process);
  if (!flow) throw new Error(`No approval flow is set up for ${PROCESSES[input.process].label.toLowerCase()}.`);
  const steps = applicableSteps(await flowSteps(flow.id), input.facts);
  if (steps.length === 0) throw new Error("The approval flow has no steps.");
  const assignees = await resolveApprovers(steps[0], {
    subjectEmployeeId: input.subjectEmployeeId,
    requesterUserId: input.requester.userId,
  });
  return { flowId: flow.id, steps, assignees, recipients: await recipientsFor(input.process, assignees) };
}

/** Writes a planned request inside the caller's transaction. Returns its id. */
export async function writeRequest(
  tx: Executor,
  input: StartInput,
  plan: { flowId: number; steps: StepDef[]; assignees: number[] },
): Promise<number> {
  const at = nowIso();
  const first = plan.steps[0].stepOrder;
  const inserted = await tx.execute({
    sql: `INSERT INTO wf_request
            (process, flow_id, subject_type, subject_id, subject_employee_id, requester_user_id,
             summary, facts, status, current_step, step_started_at, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Pending', ?, ?, ?) RETURNING id`,
    args: [
      input.process,
      plan.flowId,
      input.subjectType,
      String(input.subjectId),
      input.subjectEmployeeId,
      input.requester.userId,
      input.summary,
      JSON.stringify(input.facts),
      first,
      at,
      at,
    ],
  });
  const requestId = Number(inserted.rows[0].id);
  for (const userId of plan.assignees) {
    await tx.execute({
      sql: "INSERT OR IGNORE INTO wf_assignee (request_id, step_order, user_id, reason) VALUES (?, ?, ?, 'step')",
      args: [requestId, first, userId],
    });
  }
  await tx.execute({
    sql: `INSERT INTO wf_action (request_id, step_order, actor_type, actor_user_id, actor_name, decision, at)
          VALUES (?, 0, 'user', ?, ?, 'Submitted', ?)`,
    args: [requestId, input.requester.userId, input.requester.username, at],
  });
  return requestId;
}

/* ---------------------------------------------------------------- lookup */

export async function requestFor(subjectType: string, subjectId: string | number): Promise<RequestRow | null> {
  const r = await rawClient().execute({
    sql: "SELECT * FROM wf_request WHERE subject_type = ? AND subject_id = ?",
    args: [subjectType, String(subjectId)],
  });
  const row = r.rows[0];
  return row ? toRequest(row as unknown as Record<string, unknown>) : null;
}

export async function getRequest(id: number): Promise<RequestRow | null> {
  const r = await rawClient().execute({ sql: "SELECT * FROM wf_request WHERE id = ?", args: [id] });
  const row = r.rows[0];
  return row ? toRequest(row as unknown as Record<string, unknown>) : null;
}

/** Everyone who has approved a step of this request so far. */
async function approversSoFar(requestId: number, executor: Executor = rawClient()): Promise<number[]> {
  const r = await executor.execute({
    sql: "SELECT DISTINCT actor_user_id FROM wf_action WHERE request_id = ? AND decision = 'Approved' AND actor_user_id IS NOT NULL",
    args: [requestId],
  });
  return r.rows.map((a) => Number(a.actor_user_id));
}

async function assigneesOf(requestId: number, step: number, executor: Executor = rawClient()): Promise<number[]> {
  const r = await executor.execute({
    sql: "SELECT user_id FROM wf_assignee WHERE request_id = ? AND step_order = ?",
    args: [requestId, step],
  });
  return r.rows.map((a) => Number(a.user_id));
}

async function userName(userId: number): Promise<string> {
  const r = await rawClient().execute({ sql: "SELECT display_name FROM sec_app_user WHERE id = ?", args: [userId] });
  return r.rows[0] ? String(r.rows[0].display_name) : "someone";
}

/**
 * Whether this person may decide the request now, and on whose behalf.
 * Refusals are sentences for the person who tried.
 */
export async function authority(
  request: RequestRow,
  actor: Actor,
  canOverride: boolean,
): Promise<{ ok: true; onBehalfOf: number | null } | { ok: false; reason: string }> {
  if (request.status !== "Pending") {
    return { ok: false, reason: `That request was already ${request.status.toLowerCase()}.` };
  }
  if (request.requesterUserId !== null && request.requesterUserId === actor.userId) {
    return { ok: false, reason: "You cannot decide your own request. It goes to whoever approves it." };
  }
  if (actor.employeeId !== null && request.subjectEmployeeId === actor.employeeId) {
    return { ok: false, reason: "You cannot decide a request about yourself." };
  }
  if (PROCESSES[request.process].distinctApprovers && (await approversSoFar(request.id)).includes(actor.userId)) {
    return { ok: false, reason: "You approved an earlier step. Someone else has to approve this one." };
  }
  const assignees = await assigneesOf(request.id, request.currentStep);
  if (assignees.includes(actor.userId)) return { ok: true, onBehalfOf: null };
  const standIn = (await standingInFor(actor.userId, request.process, rawClient())).find((u) =>
    assignees.includes(u),
  );
  if (standIn !== undefined) return { ok: true, onBehalfOf: standIn };
  if (canOverride) return { ok: true, onBehalfOf: null };
  return { ok: false, reason: "This request is not waiting for you." };
}

/* ---------------------------------------------------------------- decide */

export async function decide(input: {
  requestId: number;
  actor: Actor;
  decision: "Approved" | "Rejected";
  comment: string | null;
  canOverride: boolean;
}): Promise<{ ok: true; final: boolean } | { error: string }> {
  const request = await getRequest(input.requestId);
  if (!request) return { error: "That request no longer exists." };
  const allowed = await authority(request, input.actor, input.canOverride);
  if (!allowed.ok) return { error: allowed.reason };

  const steps = applicableSteps(await flowSteps(request.flowId), request.facts);
  const next = steps.find((s) => s.stepOrder > request.currentStep);
  const approved = input.decision === "Approved";
  const moveOn = approved && next !== undefined;
  const at = nowIso();

  // Everything to read is read before the transaction; inside it, only writes.
  const exclude = PROCESSES[request.process].distinctApprovers
    ? [...(await approversSoFar(request.id)), input.actor.userId]
    : [];
  const nextAssignees = moveOn ? await resolveApprovers(next, request, rawClient(), exclude) : [];
  if (moveOn && nextAssignees.length === 0) {
    return {
      error:
        "This needs a second approver after you, and nobody else can give it. Give someone else a role that approves these requests, then approve again.",
    };
  }
  const nextNotices = moveOn
    ? await notificationStatements(
        (await recipientsFor(request.process, nextAssignees)).map((userId) => ({
          userId,
          kind: "approval.waiting" as const,
          title: `Waiting for your approval: ${request.summary}`,
          body: "An earlier approver has approved it; it now needs yours.",
          link: PROCESSES[request.process].link,
          dedupeKey: `approval.waiting:${request.id}:${next!.stepOrder}:${userId}`,
        })),
      )
    : [];
  const onBehalfName = allowed.onBehalfOf ? await userName(allowed.onBehalfOf) : null;

  const tx = await rawClient().transaction("write");
  try {
    const claimed = await tx.execute({
      sql: `UPDATE wf_request
            SET status = ?, current_step = ?, step_started_at = ?, decided_at = ?
            WHERE id = ? AND status = 'Pending' AND current_step = ?`,
      args: [
        moveOn ? "Pending" : input.decision,
        moveOn ? next!.stepOrder : request.currentStep,
        moveOn ? at : request.stepStartedAt,
        moveOn ? null : at,
        request.id,
        request.currentStep,
      ],
    });
    if (claimed.rowsAffected === 0) {
      await tx.rollback();
      return { error: "That request was decided a moment ago. Reload to see the outcome." };
    }
    await tx.execute({
      sql: `INSERT INTO wf_action
              (request_id, step_order, actor_type, actor_user_id, actor_name,
               on_behalf_of_user_id, on_behalf_of_name, decision, comment, at)
            VALUES (?, ?, 'user', ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        request.id,
        request.currentStep,
        input.actor.userId,
        input.actor.username,
        allowed.onBehalfOf,
        onBehalfName,
        input.decision,
        input.comment,
        at,
      ],
    });

    if (moveOn) {
      for (const userId of nextAssignees) {
        await tx.execute({
          sql: "INSERT OR IGNORE INTO wf_assignee (request_id, step_order, user_id, reason) VALUES (?, ?, ?, 'step')",
          args: [request.id, next!.stepOrder, userId],
        });
      }
      for (const st of nextNotices) await tx.execute(st);
    } else {
      const complete = COMPLETIONS[request.process];
      if (!complete) throw new Error(`Nothing completes ${request.process} requests.`);
      const done = await complete(tx, request, {
        decision: input.decision,
        actor: input.actor,
        comment: input.comment,
        decidedAt: at,
      });
      if (done.error) {
        await tx.rollback();
        return { error: done.error };
      }
      for (const st of await notificationStatements(done.notices ?? [])) await tx.execute(st);
    }
    await tx.commit();
  } catch (err) {
    await tx.rollback();
    throw err;
  } finally {
    tx.close();
  }
  return { ok: true, final: !moveOn };
}

/** Withdraws a pending request, inside the caller's transaction. */
export async function cancelStatements(
  subjectType: string,
  subjectId: string | number,
  actor: Actor,
): Promise<InStatement[]> {
  const at = nowIso();
  return [
    {
      sql: `INSERT INTO wf_action (request_id, step_order, actor_type, actor_user_id, actor_name, decision, at)
            SELECT id, current_step, 'user', ?, ?, 'Cancelled', ?
            FROM wf_request WHERE subject_type = ? AND subject_id = ? AND status = 'Pending'`,
      args: [actor.userId, actor.username, at, subjectType, String(subjectId)],
    },
    {
      sql: `UPDATE wf_request SET status = 'Cancelled', decided_at = ?
            WHERE subject_type = ? AND subject_id = ? AND status = 'Pending'`,
      args: [at, subjectType, String(subjectId)],
    },
  ];
}

/* ------------------------------------------------------------------ inbox */

export type WaitingRow = RequestRow & {
  /** Set when this person sees it only as someone's delegate. */
  onBehalfOfName: string | null;
  assigneeNames: string[];
};

/**
 * Every pending request this person can decide now: assigned to them,
 * assigned to someone they stand in for, or — for someone who may decide any
 * request in a process — all of that process.
 */
export async function waitingFor(
  actor: Actor,
  overrideProcesses: ProcessCode[],
  process?: ProcessCode,
): Promise<WaitingRow[]> {
  const d = todayInIndia();
  const r = await rawClient().execute({
    sql: `SELECT r.*,
            (SELECT group_concat(u.display_name, ', ') FROM wf_assignee a JOIN sec_app_user u ON u.id = a.user_id
              WHERE a.request_id = r.id AND a.step_order = r.current_step) AS assignee_names,
            (SELECT u.display_name FROM wf_assignee a
               JOIN wf_delegation d ON d.from_user_id = a.user_id AND d.to_user_id = ?1
                AND d.ended_at IS NULL AND d.from_date <= ?2 AND d.to_date >= ?2
                AND (d.processes IS NULL OR ',' || d.processes || ',' LIKE '%,' || r.process || ',%')
               JOIN sec_app_user u ON u.id = a.user_id
              WHERE a.request_id = r.id AND a.step_order = r.current_step LIMIT 1) AS on_behalf_of_name,
            EXISTS (SELECT 1 FROM wf_assignee a WHERE a.request_id = r.id
                      AND a.step_order = r.current_step AND a.user_id = ?1) AS mine
          FROM wf_request r
          WHERE r.status = 'Pending' ${process ? "AND r.process = ?3" : ""}
          ORDER BY r.created_at`,
    args: process ? [actor.userId, d, process] : [actor.userId, d],
  });
  return r.rows
    .filter((row) => {
      const p = String(row.process) as ProcessCode;
      const mine = Number(row.mine) === 1 || row.on_behalf_of_name !== null;
      const own = row.requester_user_id !== null && Number(row.requester_user_id) === actor.userId;
      return !own && (mine || overrideProcesses.includes(p));
    })
    .map((row) => ({
      ...toRequest(row as unknown as Record<string, unknown>),
      onBehalfOfName: Number(row.mine) === 1 || row.on_behalf_of_name === null ? null : String(row.on_behalf_of_name),
      assigneeNames: row.assignee_names ? String(row.assignee_names).split(", ") : [],
    }));
}

export type ActionRow = {
  requestId: number;
  process: ProcessCode;
  summary: string;
  decision: string;
  actorName: string;
  onBehalfOfName: string | null;
  comment: string | null;
  at: string;
  status: string;
};

/** What this person decided lately, newest first. */
export async function recentDecisions(userId: number, limit = 10): Promise<ActionRow[]> {
  const r = await rawClient().execute({
    sql: `SELECT a.request_id, r.process, r.summary, a.decision, a.actor_name, a.on_behalf_of_name,
                 a.comment, a.at, r.status
          FROM wf_action a JOIN wf_request r ON r.id = a.request_id
          WHERE a.actor_user_id = ? AND a.decision IN ('Approved', 'Rejected')
          ORDER BY a.at DESC, a.id DESC LIMIT ?`,
    args: [userId, limit],
  });
  return r.rows.map((a) => ({
    requestId: Number(a.request_id),
    process: String(a.process) as ProcessCode,
    summary: String(a.summary),
    decision: String(a.decision),
    actorName: String(a.actor_name),
    onBehalfOfName: a.on_behalf_of_name === null ? null : String(a.on_behalf_of_name),
    comment: a.comment === null ? null : String(a.comment),
    at: String(a.at),
    status: String(a.status),
  }));
}

/** A request's history: submitted, each decision, escalations. */
export async function historyOf(requestId: number): Promise<Omit<ActionRow, "process" | "summary" | "status">[]> {
  const r = await rawClient().execute({
    sql: `SELECT request_id, decision, actor_name, on_behalf_of_name, comment, at
          FROM wf_action WHERE request_id = ? ORDER BY at, id`,
    args: [requestId],
  });
  return r.rows.map((a) => ({
    requestId: Number(a.request_id),
    decision: String(a.decision),
    actorName: String(a.actor_name),
    onBehalfOfName: a.on_behalf_of_name === null ? null : String(a.on_behalf_of_name),
    comment: a.comment === null ? null : String(a.comment),
    at: String(a.at),
  }));
}

/* ------------------------------------------------------------- escalation */

/**
 * Steps that have waited longer than their flow allows get HR added as
 * approvers, once per step, and HR is told. Run by the daily job.
 */
export async function escalateOverdue(now = new Date()): Promise<number> {
  const pending = await rawClient().execute(
    `SELECT r.*, s.escalate_after_days FROM wf_request r
     JOIN wf_step s ON s.flow_id = r.flow_id AND s.step_order = r.current_step
     WHERE r.status = 'Pending' AND s.escalate_after_days IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM wf_action a WHERE a.request_id = r.id
                         AND a.step_order = r.current_step AND a.decision = 'Escalated')`,
  );
  let escalated = 0;
  for (const row of pending.rows) {
    const request = toRequest(row as unknown as Record<string, unknown>);
    const due = new Date(request.stepStartedAt).getTime() + Number(row.escalate_after_days) * 86_400_000;
    if (due > now.getTime()) continue;
    const hr = (await usersWithRole("HR_ADMIN", rawClient())).filter((u) => u !== request.requesterUserId);
    const at = nowIso();
    const notices = await notificationStatements(
      (await recipientsFor(request.process, hr)).map((userId) => ({
        userId,
        kind: "approval.waiting" as const,
        title: `Overdue for approval: ${request.summary}`,
        body: `It has waited ${row.escalate_after_days} days, so HR can decide it too.`,
        link: PROCESSES[request.process].link,
        dedupeKey: `approval.escalated:${request.id}:${request.currentStep}:${userId}`,
      })),
    );
    await rawClient().batch(
      [
        ...hr.map((userId) => ({
          sql: `INSERT OR IGNORE INTO wf_assignee (request_id, step_order, user_id, reason)
                VALUES (?, ?, ?, 'escalation')`,
          args: [request.id, request.currentStep, userId],
        })),
        {
          sql: `INSERT INTO wf_action (request_id, step_order, actor_type, actor_name, decision, comment, at)
                VALUES (?, ?, 'system', 'escalation', 'Escalated', ?, ?)`,
          args: [request.id, request.currentStep, `Waited more than ${row.escalate_after_days} days`, at],
        },
        ...notices,
      ],
      "write",
    );
    escalated += 1;
  }
  return escalated;
}

/* -------------------------------------------------------------- delegation */

export type DelegationRow = {
  id: number;
  fromUserId: number;
  fromName: string;
  toUserId: number;
  toName: string;
  fromDate: string;
  toDate: string;
  processes: string | null;
  endedAt: string | null;
};

export async function delegationsOf(userId: number): Promise<DelegationRow[]> {
  const r = await rawClient().execute({
    sql: `SELECT d.*, f.display_name AS from_name, t.display_name AS to_name
          FROM wf_delegation d
          JOIN sec_app_user f ON f.id = d.from_user_id
          JOIN sec_app_user t ON t.id = d.to_user_id
          WHERE (d.from_user_id = ?1 OR d.to_user_id = ?1) AND d.ended_at IS NULL AND d.to_date >= ?2
          ORDER BY d.from_date`,
    args: [userId, todayInIndia()],
  });
  return r.rows.map((d) => ({
    id: Number(d.id),
    fromUserId: Number(d.from_user_id),
    fromName: String(d.from_name),
    toUserId: Number(d.to_user_id),
    toName: String(d.to_name),
    fromDate: String(d.from_date),
    toDate: String(d.to_date),
    processes: d.processes === null ? null : String(d.processes),
    endedAt: d.ended_at === null ? null : String(d.ended_at),
  }));
}
