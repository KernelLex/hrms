import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { paEmployee, paBasicPay } from "./personnel";

/**
 * Performance management and the yearly increment.
 *
 * The cycle runs: goals are set, the employee rates themselves, their manager
 * rates them, a committee calibrates so a 4 means the same thing across teams,
 * and the finalised rating becomes an increment that writes a new basic-pay
 * record. That last step is the point of the module — everything before it is
 * paperwork unless the number reaches payroll.
 */

export const CYCLE_STATUS = ["Draft", "Active", "Closed"] as const;

export const APPRAISAL_STATUS = [
  "Pending self review",
  "Pending manager review",
  "Completed",
] as const;
export type AppraisalStatus = (typeof APPRAISAL_STATUS)[number];

export const CALIBRATION_STATUS = ["Pending", "In review", "Finalised"] as const;

export const INCREMENT_STATUS = ["Draft", "Approved", "Pushed"] as const;

export const RATING_LABELS: Record<number, string> = {
  1: "Needs improvement",
  2: "Below expectations",
  3: "Meets expectations",
  4: "Exceeds expectations",
  5: "Outstanding",
};

export const pmAppraisalTemplate = sqliteTable("pm_appraisal_template", {
  code: text("code").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
});

export const pmAppraisalCycle = sqliteTable(
  "pm_appraisal_cycle",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    periodLabel: text("period_label").notNull(),
    startDate: text("start_date").notNull(),
    endDate: text("end_date").notNull(),
    templateCode: text("template_code")
      .notNull()
      .references(() => pmAppraisalTemplate.code),
    status: text("status").notNull().default("Draft"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("ix_cycle_status").on(t.status)],
);

export const pmGoal = sqliteTable(
  "pm_goal",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    cycleId: integer("cycle_id")
      .notNull()
      .references(() => pmAppraisalCycle.id, { onDelete: "cascade" }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => paEmployee.id, { onDelete: "cascade" }),
    category: text("category").notNull(),
    description: text("description").notNull(),
    /** Weightings across an employee's goals should total 100. */
    weightagePercent: integer("weightage_percent").notNull().default(0),
    targetDate: text("target_date"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("ix_goal_cycle_employee").on(t.cycleId, t.employeeId)],
);

export const pmAppraisal = sqliteTable(
  "pm_appraisal",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    cycleId: integer("cycle_id")
      .notNull()
      .references(() => pmAppraisalCycle.id, { onDelete: "cascade" }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => paEmployee.id, { onDelete: "cascade" }),
    selfRating: integer("self_rating"),
    selfComments: text("self_comments"),
    managerRating: integer("manager_rating"),
    managerComments: text("manager_comments"),
    status: text("status").notNull().default("Pending self review"),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [uniqueIndex("ux_appraisal_cycle_employee").on(t.cycleId, t.employeeId)],
);

/**
 * Calibration holds the rating a committee agreed, separately from the one the
 * manager gave — so moderating a rating does not erase what the manager
 * originally thought.
 */
export const pmCalibration = sqliteTable(
  "pm_calibration",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    appraisalId: integer("appraisal_id")
      .notNull()
      .references(() => pmAppraisal.id, { onDelete: "cascade" })
      .unique(),
    calibratedRating: integer("calibrated_rating"),
    committeeComments: text("committee_comments"),
    status: text("status").notNull().default("Pending"),
    finalisedBy: text("finalised_by"),
    finalisedAt: text("finalised_at"),
  },
  (t) => [index("ix_calibration_status").on(t.status)],
);

export const pmIncrementRecommendation = sqliteTable(
  "pm_increment_recommendation",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    cycleId: integer("cycle_id")
      .notNull()
      .references(() => pmAppraisalCycle.id, { onDelete: "cascade" }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => paEmployee.id, { onDelete: "cascade" }),
    finalRating: integer("final_rating").notNull(),
    currentSalaryPaise: integer("current_salary_paise").notNull(),
    /** Basis points: 850 is 8.5%. */
    incrementBasisPoints: integer("increment_basis_points").notNull().default(0),
    newSalaryPaise: integer("new_salary_paise").notNull(),
    effectiveDate: text("effective_date").notNull(),
    status: text("status").notNull().default("Draft"),
    /** The basic-pay record this created, once pushed. */
    basicPayId: integer("basic_pay_id").references(() => paBasicPay.id),
    approvedBy: text("approved_by"),
    approvedAt: text("approved_at"),
    pushedAt: text("pushed_at"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [uniqueIndex("ux_increment_cycle_employee").on(t.cycleId, t.employeeId)],
);
