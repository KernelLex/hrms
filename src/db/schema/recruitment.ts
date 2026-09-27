import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { omPosition, omOrgUnit, omJob } from "./org";
import { paEmployee } from "./personnel";

/**
 * Recruitment.
 *
 * A requisition opens against a vacant position and describes the role; when
 * published, it appears on the public careers page, where candidates apply.
 * Each application is screened — its profile rejected, or taken to interview
 * — then goes through as many interview rounds as it needs, each with its
 * own interviewer, time and notes, until the candidate is approved or
 * rejected. An approved candidate is made an offer, and the offer converts
 * into an employee through the same hire action Core HR uses, so there is
 * one way an employee comes into existence rather than two.
 *
 * A rejection can happen at any stage; the application keeps the stage it
 * reached, with who rejected it, when and why.
 */

export {
  PIPELINE_STAGES,
  REQUISITION_STATUS,
  EMPLOYMENT_TYPES,
  WORK_MODES,
  INTERVIEW_STATUS,
  RECOMMENDATIONS,
  type PipelineStage,
  type InterviewStatus,
  type Recommendation,
} from "../../lib/recruitment-values";

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
    /** The role as candidates see it, such as "Senior Java developer". */
    title: text("title").notNull().default(""),
    /** What the role is and does. */
    description: text("description"),
    /** Education and certifications the role needs. */
    qualifications: text("qualifications"),
    skills: text("skills"),
    experienceMinYears: integer("experience_min_years"),
    experienceMaxYears: integer("experience_max_years"),
    employmentType: text("employment_type").notNull().default("Full-time"),
    workMode: text("work_mode").notNull().default("On site"),
    location: text("location"),
    /** The monthly salary budgeted, for HR only; never shown to candidates. */
    budgetMinPaise: integer("budget_min_paise"),
    budgetMaxPaise: integer("budget_max_paise"),
    hiringManagerEmployeeId: integer("hiring_manager_employee_id").references(() => paEmployee.id),
    openings: integer("openings").notNull().default(1),
    priority: text("priority").notNull().default("Medium"),
    postedDate: text("posted_date").notNull(),
    targetCloseDate: text("target_close_date"),
    status: text("status").notNull().default("Open"),
    /** On the public careers page while open. */
    isPublished: integer("is_published", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at"),
  },
  (t) => [
    index("ix_requisition_position").on(t.positionCode),
    index("ix_requisition_published").on(t.isPublished, t.status),
  ],
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
    /** A link to a resume held elsewhere; an uploaded resume is a document. */
    resumeLink: text("resume_link"),
    /** LinkedIn or a portfolio. */
    profileLink: text("profile_link"),
    currentEmployer: text("current_employer"),
    experienceYears: integer("experience_years"),
    noticePeriodDays: integer("notice_period_days"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at"),
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
    /** "Careers page" when the candidate applied themselves, else "Added by HR". */
    channel: text("channel").notNull().default("Added by HR"),
    /** What the candidate wrote when applying. */
    coverNote: text("cover_note"),
    /** Set when the application ends without a hire. */
    rejectedReason: text("rejected_reason"),
    rejectedAt: text("rejected_at"),
    rejectedBy: text("rejected_by"),
    /** The approval after interviews. */
    selectedAt: text("selected_at"),
    selectedBy: text("selected_by"),
    selectionNote: text("selection_note"),
    offeredSalaryPaise: integer("offered_salary_paise"),
    offeredAt: text("offered_at"),
    /** A hash of the address a careers-page application came from, to slow floods. */
    sourceHash: text("source_hash"),
  },
  (t) => [
    uniqueIndex("ux_application_candidate_req").on(t.candidateId, t.requisitionId),
    index("ix_application_stage").on(t.stage),
    index("ix_application_source").on(t.sourceHash, t.appliedDate),
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
    /** The interviewer's name, kept even if they have no record here. */
    interviewer: text("interviewer").notNull(),
    /** The employee taking the round, who sees it and records its notes. */
    interviewerEmployeeId: integer("interviewer_employee_id").references(() => paEmployee.id),
    scheduledDate: text("scheduled_date").notNull(),
    scheduledTime: text("scheduled_time"),
    durationMinutes: integer("duration_minutes").notNull().default(60),
    mode: text("mode").notNull().default("Video call"),
    /** A room, an address or a meeting link. */
    location: text("location"),
    status: text("status").notNull().default("Scheduled"),
    /** 1 to 5, null until the interview has happened. */
    rating: integer("rating"),
    recommendation: text("recommendation"),
    /** The interviewer's notes. */
    feedback: text("feedback"),
    completedAt: text("completed_at"),
    completedBy: text("completed_by"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    index("ix_interview_application").on(t.applicationId),
    index("ix_interview_interviewer").on(t.interviewerEmployeeId, t.scheduledDate),
  ],
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
