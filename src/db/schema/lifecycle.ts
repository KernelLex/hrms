import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { paEmployee } from "./personnel";
import { appDocument } from "./app";

/**
 * The moments in an employee's life that are guided actions with their
 * paperwork, rather than raw record edits: onboarding, probation, transfers
 * and promotions (which write through the time-slice engine — see
 * `src/lib/services/actions.ts` — so they need no table of their own), and
 * letters issued from templates.
 *
 * Transfers and promotions are not tables here: they are new rows in
 * `pa_it0000_action`, `pa_it0001_org_assignment` and `pa_it0008_basic_pay`,
 * exactly as a hire is, so there is one history to read, not two.
 */

/* ------------------------------------------------------------- checklists */

/**
 * What a joiner (and, from phase 20, a leaver) has to get done. One active
 * template per `event`; editing keeps the old tasks a checklist already
 * started with intact, the same way a payroll wage type's history does.
 */
export const paChecklistTemplate = sqliteTable(
  "pa_checklist_template",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** "onboarding" today; "offboarding" joins in phase 20. */
    event: text("event").notNull().default("onboarding"),
    name: text("name").notNull(),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("ix_checklist_template_event").on(t.event, t.isActive)],
);

export const paChecklistItem = sqliteTable(
  "pa_checklist_item",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    templateId: integer("template_id")
      .notNull()
      .references(() => paChecklistTemplate.id, { onDelete: "cascade" }),
    task: text("task").notNull(),
    /** Who a task instance is assigned to: their reporting manager, or HR. */
    ownerType: text("owner_type").notNull(),
    /** Days after the event (the hire date) the task falls due. */
    dueDays: integer("due_days").notNull().default(7),
    sortOrder: integer("sort_order").notNull().default(100),
  },
  (t) => [index("ix_checklist_item_template").on(t.templateId)],
);

/** One run of a checklist for one employee — started at hire, completed when every task is. */
export const paChecklist = sqliteTable(
  "pa_checklist",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => paEmployee.id, { onDelete: "cascade" }),
    templateId: integer("template_id").references(() => paChecklistTemplate.id),
    event: text("event").notNull().default("onboarding"),
    startedAt: text("started_at").notNull(),
    completedAt: text("completed_at"),
  },
  (t) => [uniqueIndex("ux_checklist_employee_event").on(t.employeeId, t.event)],
);

/** A single task, assigned to a real person when the checklist starts. */
export const paTask = sqliteTable(
  "pa_task",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    checklistId: integer("checklist_id")
      .notNull()
      .references(() => paChecklist.id, { onDelete: "cascade" }),
    /** Copied from the template item at creation, so editing the template later leaves history alone. */
    task: text("task").notNull(),
    ownerType: text("owner_type").notNull(),
    /** Resolved once, at creation — who is actually assigned, if anyone could be found. */
    assignedUserId: integer("assigned_user_id"),
    dueDate: text("due_date").notNull(),
    /** "Pending" or "Done". */
    status: text("status").notNull().default("Pending"),
    doneByUserId: integer("done_by_user_id"),
    doneAt: text("done_at"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    index("ix_task_checklist").on(t.checklistId),
    index("ix_task_assignee").on(t.assignedUserId, t.status),
  ],
);

/* ------------------------------------------------------- IT0019 monitoring */

/**
 * SAP's dated reminders: probation review today, contract end and visa
 * expiry later. Not time-sliced — each row is one dated event, and an
 * extension adds a new row rather than replacing the old one, so the record
 * of what was pushed back and by whom stays intact.
 */
export const paMonitoring = sqliteTable(
  "pa_it0019_monitoring",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => paEmployee.id, { onDelete: "cascade" }),
    /** "Probation review" today. */
    monitoringType: text("monitoring_type").notNull(),
    date: text("date").notNull(),
    /** "Pending", "Confirmed", "Extended" or "Ended". */
    status: text("status").notNull().default("Pending"),
    note: text("note"),
    /** Set once, the first time this date entered the reminder window. */
    remindedAt: text("reminded_at"),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("ix_monitoring_employee").on(t.employeeId, t.monitoringType, t.status)],
);

/* ------------------------------------------------------------------ letters */

/**
 * A letter kind's body, with merge fields such as `{{first_name}}`. Saving
 * makes a new version and deactivates the old one — the same versioning
 * `wf_flow` uses for approval routes — so a letter already issued keeps
 * reading the exact wording it was issued with.
 */
export const paLetterTemplate = sqliteTable(
  "pa_letter_template",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** "Appointment", "Experience", "Relieving", and so on. */
    kind: text("kind").notNull(),
    version: integer("version").notNull(),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    body: text("body").notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [uniqueIndex("ux_letter_template_version").on(t.kind, t.version)],
);

/**
 * A letter as issued: the merged text kept verbatim, so it reads exactly as
 * given even if the employee's record or the template changes afterwards.
 * `documentId` is the same text rendered to PDF and filed on the employee's
 * record.
 */
export const paLetter = sqliteTable(
  "pa_letter",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => paEmployee.id, { onDelete: "cascade" }),
    templateId: integer("template_id")
      .notNull()
      .references(() => paLetterTemplate.id),
    kind: text("kind").notNull(),
    issueDate: text("issue_date").notNull(),
    mergedText: text("merged_text").notNull(),
    documentId: integer("document_id").references(() => appDocument.id),
    issuedBy: text("issued_by").notNull(),
    issuedAt: text("issued_at").notNull(),
  },
  (t) => [index("ix_letter_employee").on(t.employeeId)],
);
