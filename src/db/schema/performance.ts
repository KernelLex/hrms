import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { paEmployee, paBasicPay } from "./personnel";
import { omJob, omOrgUnit } from "./org";
import { appDocument } from "./app";

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

/* --------------------------------------------- phase 23: goal check-ins */

export const CHECKIN_STATUS = ["On track", "At risk", "Behind"] as const;
export type CheckinStatus = (typeof CHECKIN_STATUS)[number];

/** A progress update on a goal: a timeline either side can add to, not one record two people edit. */
export const pmGoalCheckin = sqliteTable(
  "pm_goal_checkin",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    goalId: integer("goal_id")
      .notNull()
      .references(() => pmGoal.id, { onDelete: "cascade" }),
    checkinDate: text("checkin_date").notNull(),
    status: text("status").notNull(),
    comment: text("comment").notNull(),
    /** Who is speaking in this entry, not who may read it. */
    authorType: text("author_type").notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("ix_checkin_goal").on(t.goalId, t.checkinDate)],
);

/* ------------------------------------------------- phase 23: 360 feedback */

export const FEEDBACK_RELATIONSHIPS = ["Peer", "Manager", "Report", "Self"] as const;
export type FeedbackRelationship = (typeof FEEDBACK_RELATIONSHIPS)[number];
export const FEEDBACK_REQUEST_STATUS = ["Requested", "Submitted", "Declined"] as const;

/** One person asked to say something about another, for one cycle. */
export const pmFeedbackRequest = sqliteTable(
  "pm_feedback_request",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    cycleId: integer("cycle_id")
      .notNull()
      .references(() => pmAppraisalCycle.id, { onDelete: "cascade" }),
    revieweeEmployeeId: integer("reviewee_employee_id")
      .notNull()
      .references(() => paEmployee.id, { onDelete: "cascade" }),
    reviewerEmployeeId: integer("reviewer_employee_id")
      .notNull()
      .references(() => paEmployee.id, { onDelete: "cascade" }),
    relationship: text("relationship").notNull(),
    status: text("status").notNull().default("Requested"),
    requestedBy: text("requested_by").notNull(),
    requestedAt: text("requested_at").notNull(),
  },
  (t) => [uniqueIndex("ux_feedback_request").on(t.cycleId, t.revieweeEmployeeId, t.reviewerEmployeeId)],
);

/** One competency's rating and comment, against one request. Peer feedback is read only in aggregate — see the repository, not the schema, for the threshold. */
export const pmFeedback = sqliteTable(
  "pm_feedback",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    requestId: integer("request_id")
      .notNull()
      .references(() => pmFeedbackRequest.id, { onDelete: "cascade" }),
    competency: text("competency").notNull(),
    rating: integer("rating"),
    comments: text("comments"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [uniqueIndex("ux_feedback_request_competency").on(t.requestId, t.competency)],
);

/* ------------------------------------------- phase 23: improvement plans */

export const PIP_OUTCOME = ["Ongoing", "Passed", "Failed"] as const;

export const pmPip = sqliteTable(
  "pm_pip",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => paEmployee.id, { onDelete: "cascade" }),
    reason: text("reason").notNull(),
    goals: text("goals").notNull(),
    startDate: text("start_date").notNull(),
    endDate: text("end_date").notNull(),
    outcome: text("outcome").notNull().default("Ongoing"),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull(),
    closedBy: text("closed_by"),
    closedAt: text("closed_at"),
  },
  (t) => [index("ix_pip_employee").on(t.employeeId)],
);

export const pmPipCheckin = sqliteTable(
  "pm_pip_checkin",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    pipId: integer("pip_id")
      .notNull()
      .references(() => pmPip.id, { onDelete: "cascade" }),
    note: text("note").notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("ix_pip_checkin_pip").on(t.pipId)],
);

/* -------------------------------------------- phase 23: training catalogue */

export const NOMINATION_STATUS = ["Requested", "Approved", "Rejected"] as const;

export const ldCourse = sqliteTable("ld_course", {
  code: text("code").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  costPaise: integer("cost_paise").notNull().default(0),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
});

export const ldSession = sqliteTable(
  "ld_session",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    courseCode: text("course_code")
      .notNull()
      .references(() => ldCourse.code, { onDelete: "cascade" }),
    startDate: text("start_date").notNull(),
    endDate: text("end_date").notNull(),
    capacity: integer("capacity").notNull(),
    place: text("place"),
    /** Independent of the course's own figure — an outside venue or a bigger batch can cost differently. */
    costPaise: integer("cost_paise").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("ix_session_course").on(t.courseCode)],
);

export const ldNomination = sqliteTable(
  "ld_nomination",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sessionId: integer("session_id")
      .notNull()
      .references(() => ldSession.id, { onDelete: "cascade" }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => paEmployee.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("Requested"),
    attended: integer("attended", { mode: "boolean" }),
    feedback: text("feedback"),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull(),
    decidedBy: text("decided_by"),
    decidedAt: text("decided_at"),
  },
  (t) => [uniqueIndex("ux_nomination_session_employee").on(t.sessionId, t.employeeId)],
);

/** What a department may spend on training in a year — nominations over this are refused at approval. */
export const ldDepartmentBudget = sqliteTable(
  "ld_department_budget",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    orgUnitCode: text("org_unit_code")
      .notNull()
      .references(() => omOrgUnit.code, { onDelete: "cascade" }),
    year: integer("year").notNull(),
    allocatedPaise: integer("allocated_paise").notNull(),
  },
  (t) => [uniqueIndex("ux_budget_unit_year").on(t.orgUnitCode, t.year)],
);

/* --------------------------------------------- phase 23: certifications */

export const ldCertification = sqliteTable(
  "ld_certification",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => paEmployee.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    issuer: text("issuer"),
    issuedDate: text("issued_date").notNull(),
    /** Null for one that never expires. */
    expiryDate: text("expiry_date"),
    documentId: integer("document_id").references(() => appDocument.id),
    /** Guards the one expiry warning against telling someone twice, the way probation review reminders already do. */
    remindedAt: text("reminded_at"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("ix_certification_employee").on(t.employeeId), index("ix_certification_expiry").on(t.expiryDate)],
);

/** A job that needs a named certificate; a report flags anyone holding it without one still valid. */
export const ldCertificationRequirement = sqliteTable(
  "ld_certification_requirement",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    jobCode: text("job_code")
      .notNull()
      .references(() => omJob.code, { onDelete: "cascade" }),
    name: text("name").notNull(),
  },
  (t) => [uniqueIndex("ux_requirement_job_name").on(t.jobCode, t.name)],
);
