import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { paEmployee } from "./personnel";
import { pyPayrollRun } from "./payroll";

/**
 * Leaving: a resignation, termination or retirement, approved like any other
 * request, that runs the termination through the time-slice engine on its
 * last day and pays one off-cycle settlement — salary to that day, leave
 * encashment, notice pay, gratuity and the outstanding loan all through the
 * `py_it0015_additional_payment` rail every other one-off payment already
 * uses, so the payroll engine itself needs no change to pay any of them.
 */

export const EXIT_TYPES = ["Resignation", "Termination", "Retirement"] as const;
export type ExitType = (typeof EXIT_TYPES)[number];

/** Pending an approval; Approved runs the exit workflow until settlement; Rejected or Withdrawn end it with nothing paid. */
export const EXIT_STATUSES = ["Pending", "Approved", "Rejected", "Withdrawn", "Settled"] as const;
export type ExitStatus = (typeof EXIT_STATUSES)[number];

export const paExit = sqliteTable(
  "pa_exit",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => paEmployee.id, { onDelete: "cascade" }),
    exitType: text("exit_type").notNull(),
    reason: text("reason"),
    /** The day the employee (or HR) first named. */
    requestedLastDay: text("requested_last_day").notNull(),
    /** What the notice policy asks for, in days, as of the request. */
    noticeDays: integer("notice_days").notNull(),
    /** Set on approval — may be earlier than requested (an early release) or later. */
    approvedLastDay: text("approved_last_day"),
    /** HR waives a notice shortfall instead of it being recovered in the settlement. */
    noticeWaived: integer("notice_waived", { mode: "boolean" }).notNull().default(false),
    rehireEligible: integer("rehire_eligible", { mode: "boolean" }),
    status: text("status").notNull().default("Pending"),
    requestedBy: text("requested_by").notNull(),
    requestedAt: text("requested_at").notNull(),
    decidedAt: text("decided_at"),
    decisionNote: text("decision_note"),
    /** Set once the termination action has actually run, on or after the last day. */
    exitedAt: text("exited_at"),
  },
  (t) => [index("ix_exit_employee").on(t.employeeId), index("ix_exit_status").on(t.status)],
);

/** One per exit — a short, fixed set of questions rather than a free-form blob, matching every other typed record here. */
export const paExitInterview = sqliteTable(
  "pa_exit_interview",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    exitId: integer("exit_id")
      .notNull()
      .references(() => paExit.id, { onDelete: "cascade" }),
    primaryReason: text("primary_reason"),
    wouldRecommend: integer("would_recommend", { mode: "boolean" }),
    comments: text("comments"),
    submittedBy: text("submitted_by").notNull(),
    submittedAt: text("submitted_at").notNull(),
  },
  (t) => [uniqueIndex("ux_exit_interview_exit").on(t.exitId)],
);

/** Draft the moment every component is computed; Paid once its off-cycle run completes. */
export const SETTLEMENT_STATUSES = ["Draft", "Paid"] as const;
export type SettlementStatus = (typeof SETTLEMENT_STATUSES)[number];

export const pySettlement = sqliteTable(
  "py_settlement",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    exitId: integer("exit_id")
      .notNull()
      .references(() => paExit.id, { onDelete: "cascade" }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => paEmployee.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("Draft"),
    runId: integer("run_id").references(() => pyPayrollRun.id),
    computedAt: text("computed_at").notNull(),
    paidAt: text("paid_at"),
  },
  (t) => [uniqueIndex("ux_settlement_exit").on(t.exitId), index("ix_settlement_employee").on(t.employeeId)],
);

/**
 * One line per component, its basis kept as read text (not recomputed later)
 * so the statement reads exactly as it did when paid — the same reason a
 * letter keeps its merged text rather than re-rendering from the template.
 * A negative amount recovers rather than pays — a notice shortfall.
 */
export const pySettlementLine = sqliteTable(
  "py_settlement_line",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    settlementId: integer("settlement_id")
      .notNull()
      .references(() => pySettlement.id, { onDelete: "cascade" }),
    component: text("component").notNull(),
    basis: text("basis").notNull(),
    amountPaise: integer("amount_paise").notNull(),
    sortOrder: integer("sort_order").notNull().default(100),
  },
  (t) => [index("ix_settlement_line_settlement").on(t.settlementId)],
);
