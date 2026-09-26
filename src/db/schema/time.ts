import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { paEmployee } from "./personnel";

/**
 * Time management and absence.
 *
 * The chain that matters: an employee requests leave, their manager approves
 * it, the approval writes an absence record and decrements the quota, and an
 * unpaid absence later reduces pay in the payroll run. Each of those is a
 * separate table so the workflow stays auditable.
 */

export const LEAVE_STATUS = ["Pending", "Approved", "Rejected", "Cancelled"] as const;
export type LeaveStatus = (typeof LEAVE_STATUS)[number];

/** Absence types, coded as SAP does: 0100 sick, 0200 annual, 0300 unpaid. */
export const ptAbsenceType = sqliteTable("pt_absence_type", {
  code: text("code").primaryKey(),
  name: text("name").notNull(),
  /** Unpaid absence reaches payroll as a deduction. */
  isPaid: integer("is_paid", { mode: "boolean" }).notNull().default(true),
  /** Whether taking this absence consumes an entitlement. */
  countsAgainstQuota: integer("counts_against_quota", { mode: "boolean" })
    .notNull()
    .default(true),
  quotaTypeCode: text("quota_type_code"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
});

export const ptAttendanceType = sqliteTable("pt_attendance_type", {
  code: text("code").primaryKey(),
  name: text("name").notNull(),
  isOvertime: integer("is_overtime", { mode: "boolean" }).notNull().default(false),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
});

export const ptQuotaType = sqliteTable("pt_quota_type", {
  code: text("code").primaryKey(),
  name: text("name").notNull(),
  /** Days granted per year when the quota is generated. */
  defaultEntitlementDays: integer("default_entitlement_days").notNull().default(0),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
});

/* --------------------------------------------------------- IT2001 absences */

export const ptAbsence = sqliteTable(
  "pt_it2001_absence",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => paEmployee.id, { onDelete: "cascade" }),
    absenceTypeCode: text("absence_type_code")
      .notNull()
      .references(() => ptAbsenceType.code),
    startDate: text("start_date").notNull(),
    endDate: text("end_date").notNull(),
    /** Working days, excluding weekends and public holidays. */
    payrollDays: integer("payroll_days").notNull(),
    calendarDays: integer("calendar_days").notNull(),
    isHalfDay: integer("is_half_day", { mode: "boolean" }).notNull().default(false),
    remarks: text("remarks"),
    /** Set when an approved leave request created this record. */
    sourceRequestId: integer("source_request_id"),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    index("ix_absence_employee").on(t.employeeId, t.startDate),
    index("ix_absence_type").on(t.absenceTypeCode),
  ],
);

/* ------------------------------------------------------ IT2002 attendances */

export const ptAttendance = sqliteTable(
  "pt_it2002_attendance",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => paEmployee.id, { onDelete: "cascade" }),
    attendanceTypeCode: text("attendance_type_code")
      .notNull()
      .references(() => ptAttendanceType.code),
    date: text("date").notNull(),
    hours: integer("hours").notNull(),
    remarks: text("remarks"),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("ix_attendance_employee").on(t.employeeId, t.date)],
);

/* ---------------------------------------------------- IT2006 absence quota */

export const ptAbsenceQuota = sqliteTable(
  "pt_it2006_absence_quota",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => paEmployee.id, { onDelete: "cascade" }),
    quotaTypeCode: text("quota_type_code")
      .notNull()
      .references(() => ptQuotaType.code),
    year: integer("year").notNull(),
    /** Stored in half-day units so a half day is representable without floats. */
    entitledHalfDays: integer("entitled_half_days").notNull().default(0),
    usedHalfDays: integer("used_half_days").notNull().default(0),
    createdAt: text("created_at").notNull(),
  },
  (t) => [uniqueIndex("ux_quota_employee_year").on(t.employeeId, t.quotaTypeCode, t.year)],
);

/* ------------------------------------------------------- leave requests */

export const ptLeaveRequest = sqliteTable(
  "pt_leave_request",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => paEmployee.id, { onDelete: "cascade" }),
    absenceTypeCode: text("absence_type_code")
      .notNull()
      .references(() => ptAbsenceType.code),
    fromDate: text("from_date").notNull(),
    toDate: text("to_date").notNull(),
    isHalfDay: integer("is_half_day", { mode: "boolean" }).notNull().default(false),
    /** Working days requested, computed when submitted. */
    payrollDays: integer("payroll_days").notNull(),
    reason: text("reason"),
    status: text("status").notNull().default("Pending"),
    submittedAt: text("submitted_at").notNull(),
    decidedByEmployeeId: integer("decided_by_employee_id"),
    decidedAt: text("decided_at"),
    decisionNote: text("decision_note"),
  },
  (t) => [
    index("ix_request_employee").on(t.employeeId, t.status),
    index("ix_request_status").on(t.status),
  ],
);

/* ------------------------------------------------------ holiday calendar */

export const ptHoliday = sqliteTable(
  "pt_holiday",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    date: text("date").notNull(),
    name: text("name").notNull(),
    region: text("region").notNull().default("National"),
  },
  (t) => [uniqueIndex("ux_holiday_date_region").on(t.date, t.region)],
);

/* -------------------------------------------------- time evaluation result */

export const ptTimeEvaluation = sqliteTable(
  "pt_time_evaluation_result",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => paEmployee.id, { onDelete: "cascade" }),
    periodYear: integer("period_year").notNull(),
    periodMonth: integer("period_month").notNull(),
    workingDays: integer("working_days").notNull(),
    presentDays: integer("present_days").notNull(),
    absentDays: integer("absent_days").notNull(),
    /** Unpaid days are what payroll prorates against. */
    unpaidDays: integer("unpaid_days").notNull().default(0),
    overtimeHours: integer("overtime_hours").notNull().default(0),
    evaluatedAt: text("evaluated_at").notNull(),
  },
  (t) => [
    uniqueIndex("ux_timeeval_period").on(t.employeeId, t.periodYear, t.periodMonth),
  ],
);
