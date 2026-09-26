import { sqliteTable, text, integer, real, index, uniqueIndex, primaryKey } from "drizzle-orm/sqlite-core";

/**
 * Approvals, configured rather than coded.
 *
 * A flow is the approval route for one process — leave today; corrections,
 * claims and exits as they arrive — and is versioned: saving a change makes a
 * new version, and a request keeps the version it started on. A step says who
 * approves (the reporting manager, their manager, anyone holding a role, or a
 * named person), when it applies (only above so many days, or so much money),
 * and when it escalates.
 *
 * A request is one thing waiting on a flow. Its assignees are the people the
 * current step resolved to; a delegate acts for an assignee while they are
 * away, and the action records on whose behalf.
 */

export const wfFlow = sqliteTable(
  "wf_flow",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    process: text("process").notNull(),
    version: integer("version").notNull(),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [uniqueIndex("ux_wf_flow_version").on(t.process, t.version)],
);

export const wfStep = sqliteTable(
  "wf_step",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    flowId: integer("flow_id")
      .notNull()
      .references(() => wfFlow.id, { onDelete: "cascade" }),
    stepOrder: integer("step_order").notNull(),
    /** "reporting_manager", "manager_of_manager", "role" or "person". */
    approverType: text("approver_type").notNull(),
    approverRole: text("approver_role"),
    approverUserId: integer("approver_user_id"),
    /** The step applies only when this fact is above `conditionMin`: "days" or "amount". */
    conditionField: text("condition_field"),
    conditionMin: real("condition_min"),
    /** Waiting longer than this adds HR as approvers. */
    escalateAfterDays: integer("escalate_after_days"),
  },
  (t) => [uniqueIndex("ux_wf_step_order").on(t.flowId, t.stepOrder)],
);

export const wfRequest = sqliteTable(
  "wf_request",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    process: text("process").notNull(),
    flowId: integer("flow_id").notNull(),
    /** What is being approved: "pt_leave_request" and its id. */
    subjectType: text("subject_type").notNull(),
    subjectId: text("subject_id").notNull(),
    subjectEmployeeId: integer("subject_employee_id"),
    requesterUserId: integer("requester_user_id"),
    /** One line for the inbox: "Arjun Mehta, 2 days of annual leave, 1–2 Feb 2027". */
    summary: text("summary").notNull(),
    /** What the conditions read, as JSON: {"days": 6}. */
    facts: text("facts"),
    /** "Pending", "Approved", "Rejected" or "Cancelled". */
    status: text("status").notNull().default("Pending"),
    currentStep: integer("current_step").notNull(),
    stepStartedAt: text("step_started_at").notNull(),
    createdAt: text("created_at").notNull(),
    decidedAt: text("decided_at"),
  },
  (t) => [
    uniqueIndex("ux_wf_request_subject").on(t.subjectType, t.subjectId),
    index("ix_wf_request_status").on(t.status, t.process),
  ],
);

export const wfAssignee = sqliteTable(
  "wf_assignee",
  {
    requestId: integer("request_id")
      .notNull()
      .references(() => wfRequest.id, { onDelete: "cascade" }),
    stepOrder: integer("step_order").notNull(),
    userId: integer("user_id").notNull(),
    /** "step", or "escalation" when added because the step waited too long. */
    reason: text("reason").notNull().default("step"),
  },
  (t) => [
    primaryKey({ columns: [t.requestId, t.stepOrder, t.userId] }),
    index("ix_wf_assignee_user").on(t.userId),
  ],
);

export const wfAction = sqliteTable(
  "wf_action",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    requestId: integer("request_id")
      .notNull()
      .references(() => wfRequest.id, { onDelete: "cascade" }),
    stepOrder: integer("step_order").notNull(),
    /** "user", "system", and from phase 12 "client". */
    actorType: text("actor_type").notNull(),
    actorUserId: integer("actor_user_id"),
    actorName: text("actor_name").notNull(),
    onBehalfOfUserId: integer("on_behalf_of_user_id"),
    onBehalfOfName: text("on_behalf_of_name"),
    /** "Submitted", "Approved", "Rejected", "Escalated" or "Cancelled". */
    decision: text("decision").notNull(),
    comment: text("comment"),
    at: text("at").notNull(),
  },
  (t) => [index("ix_wf_action_request").on(t.requestId)],
);

export const wfDelegation = sqliteTable(
  "wf_delegation",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    fromUserId: integer("from_user_id").notNull(),
    toUserId: integer("to_user_id").notNull(),
    fromDate: text("from_date").notNull(),
    toDate: text("to_date").notNull(),
    /** Comma-separated processes, or null for all of them. */
    processes: text("processes"),
    createdAt: text("created_at").notNull(),
    endedAt: text("ended_at"),
  },
  (t) => [index("ix_wf_delegation_to").on(t.toUserId, t.fromDate, t.toDate)],
);
