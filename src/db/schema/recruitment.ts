import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { omPosition, omOrgUnit, omJob } from "./org";
import { paEmployee } from "./personnel";

/**
 * Recruitment.
 *
 * A requisition opens against a vacant position, candidates apply to it, and
 * the pipeline moves an application through stages. The last stage converts
 * the candidate into an employee using the same hire action Core HR uses, so
 * there is one way an employee comes into existence rather than two.
 */

export const PIPELINE_STAGES = [
  "Applied",
  "Screened",
  "Interviewed",
  "Offered",
  "Hired",
] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export const REQUISITION_STATUS = ["Open", "On hold", "Closed"] as const;

export const rcRequisition = sqliteTable(
  "rc_requisition",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    code: text("code").notNull().unique(),
    positionCode: text("position_code")
      .notNull()
      .references(() => omPosition.code),
    orgUnitCode: text("org_unit_code")
      .notNull()
      .references(() => omOrgUnit.code),
    jobCode: text("job_code")
      .notNull()
      .references(() => omJob.code),
    openings: integer("openings").notNull().default(1),
    priority: text("priority").notNull().default("Medium"),
    postedDate: text("posted_date").notNull(),
    targetCloseDate: text("target_close_date"),
    status: text("status").notNull().default("Open"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("ix_requisition_position").on(t.positionCode)],
);

export const rcCandidate = sqliteTable(
  "rc_candidate",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    code: text("code").notNull().unique(),
    fullName: text("full_name").notNull(),
    email: text("email").notNull(),
    phone: text("phone"),
    source: text("source").notNull().default("Job portal"),
    /** Replaced by an R2 object key in phase 9; a link until then. */
    resumeLink: text("resume_link"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("ix_candidate_email").on(t.email)],
);

export const rcApplication = sqliteTable(
  "rc_application",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    candidateId: integer("candidate_id")
      .notNull()
      .references(() => rcCandidate.id, { onDelete: "cascade" }),
    requisitionId: integer("requisition_id")
      .notNull()
      .references(() => rcRequisition.id, { onDelete: "cascade" }),
    stage: text("stage").notNull().default("Applied"),
    appliedDate: text("applied_date").notNull(),
    /** Set when the application ends without a hire. */
    rejectedReason: text("rejected_reason"),
    rejectedAt: text("rejected_at"),
    offeredSalaryPaise: integer("offered_salary_paise"),
  },
  (t) => [
    uniqueIndex("ux_application_candidate_req").on(t.candidateId, t.requisitionId),
    index("ix_application_stage").on(t.stage),
  ],
);

/** Every stage change, so the pipeline is auditable rather than just current. */
export const rcApplicationStageHistory = sqliteTable(
  "rc_application_stage_history",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    applicationId: integer("application_id")
      .notNull()
      .references(() => rcApplication.id, { onDelete: "cascade" }),
    fromStage: text("from_stage"),
    toStage: text("to_stage").notNull(),
    changedBy: text("changed_by").notNull(),
    changedAt: text("changed_at").notNull(),
    note: text("note"),
  },
  (t) => [index("ix_stagehistory_application").on(t.applicationId)],
);

export const rcInterview = sqliteTable(
  "rc_interview",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    applicationId: integer("application_id")
      .notNull()
      .references(() => rcApplication.id, { onDelete: "cascade" }),
    round: text("round").notNull(),
    interviewer: text("interviewer").notNull(),
    scheduledDate: text("scheduled_date").notNull(),
    scheduledTime: text("scheduled_time"),
    mode: text("mode").notNull().default("Video call"),
    /** 1 to 5, null until the interview has happened. */
    rating: integer("rating"),
    feedback: text("feedback"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("ix_interview_application").on(t.applicationId)],
);

/** The bridge into Core HR: which candidate became which employee. */
export const rcHireConversion = sqliteTable("rc_hire_conversion", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  applicationId: integer("application_id")
    .notNull()
    .references(() => rcApplication.id),
  employeeId: integer("employee_id")
    .notNull()
    .references(() => paEmployee.id, { onDelete: "cascade" }),
  hireDate: text("hire_date").notNull(),
  offeredSalaryPaise: integer("offered_salary_paise").notNull(),
  convertedBy: text("converted_by").notNull(),
  convertedAt: text("converted_at").notNull(),
});
