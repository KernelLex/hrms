import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { paEmployee } from "./personnel";
import { intClient } from "./integration";

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
  /** Debits pt_comp_off (FIFO by expiry) instead of a quota's ledger when taken. */
  isCompOff: integer("is_comp_off", { mode: "boolean" }).notNull().default(false),
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

/** A named set of public holidays; each personnel area sits on one (org.ts). */
export const ptHolidayCalendar = sqliteTable("pt_holiday_calendar", {
  code: text("code").primaryKey(),
  name: text("name").notNull(),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
});

export const ptHoliday = sqliteTable(
  "pt_holiday",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    date: text("date").notNull(),
    name: text("name").notNull(),
    calendarCode: text("calendar_code")
      .notNull()
      .references(() => ptHolidayCalendar.code)
      .default("NATIONAL"),
  },
  (t) => [uniqueIndex("ux_holiday_date_calendar").on(t.date, t.calendarCode)],
);

/* ------------------------------------------------------- leave policies */

export const ACCRUAL_FREQUENCIES = ["Monthly", "Yearly"] as const;
export type AccrualFrequency = (typeof ACCRUAL_FREQUENCIES)[number];

/**
 * What a quota type actually grants: how much, to whom, how it is earned,
 * and what happens to what is left over. Several policies can name the same
 * quota type — grade L1-L3 gets one entitlement, L4 and above another — and
 * the one an employee falls under is resolved by their grade (basic pay's
 * `pay_scale_group`) and personnel area, the more specific policy winning a
 * tie. `appliesToGrade` is unenforced by a foreign key on purpose: a grade
 * is free text on the pay record, not a master table of its own.
 */
export const ptLeavePolicy = sqliteTable(
  "pt_leave_policy",
  {
    code: text("code").primaryKey(),
    name: text("name").notNull(),
    quotaTypeCode: text("quota_type_code")
      .notNull()
      .references(() => ptQuotaType.code),
    /** Null means every grade. */
    appliesToGrade: text("applies_to_grade"),
    /** Null means every area. Soft reference, like appliesToGrade. */
    appliesToAreaCode: text("applies_to_area_code"),
    /** In half-day units, so 0.5-day accrual is representable. */
    entitlementHalfDaysPerYear: integer("entitlement_half_days_per_year").notNull(),
    accrualFrequency: text("accrual_frequency").notNull().default("Yearly"),
    proRataForJoiners: integer("pro_rata_for_joiners", { mode: "boolean" }).notNull().default(true),
    carryForwardCapHalfDays: integer("carry_forward_cap_half_days").notNull().default(0),
    /** The financial year end the cap and lapse are measured against, as MM-DD. */
    lapseOn: text("lapse_on").notNull().default("03-31"),
    encashableHalfDaysPerYear: integer("encashable_half_days_per_year").notNull().default(0),
    /** Null means no limit beyond the balance itself. */
    maxRequestHalfDays: integer("max_request_half_days"),
    /** A leave day either side of a weekend or holiday takes the days between too. */
    sandwichRule: integer("sandwich_rule", { mode: "boolean" }).notNull().default(false),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("ix_policy_quota_type").on(t.quotaTypeCode, t.isActive)],
);

/* --------------------------------------------------------- quota ledger */

export const LEDGER_ENTRY_TYPES = ["Accrual", "Use", "Restore", "CarryForward", "Lapse", "Encashment", "Adjustment"] as const;
export type LedgerEntryType = (typeof LEDGER_ENTRY_TYPES)[number];

/**
 * Every credit and debit against a balance — accrual, use, carry-forward,
 * lapse, encashment, a manual adjustment. `pt_it2006_absence_quota` holds
 * the running total for a fast read; this is where it comes from, and what
 * "why do I have 11.5 days" answers itself from.
 */
export const ptQuotaLedger = sqliteTable(
  "pt_quota_ledger",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => paEmployee.id, { onDelete: "cascade" }),
    quotaTypeCode: text("quota_type_code")
      .notNull()
      .references(() => ptQuotaType.code),
    year: integer("year").notNull(),
    entryType: text("entry_type").notNull(),
    /** Signed: a credit is positive, a debit negative. */
    halfDays: integer("half_days").notNull(),
    note: text("note"),
    /** What caused it: "pt_leave_request", "pt_comp_off_encashment", etc. */
    refType: text("ref_type"),
    refId: text("ref_id"),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("ix_ledger_employee").on(t.employeeId, t.quotaTypeCode, t.year)],
);

/* ------------------------------------------------------- compensatory off */

export const COMP_OFF_STATUS = ["Available", "Used", "Expired"] as const;
export type CompOffStatus = (typeof COMP_OFF_STATUS)[number];

/** A day earned by working a holiday or a weekend, banked until it expires. */
export const ptCompOff = sqliteTable(
  "pt_comp_off",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => paEmployee.id, { onDelete: "cascade" }),
    earnedOn: text("earned_on").notNull(),
    expiresOn: text("expires_on").notNull(),
    halfDays: integer("half_days").notNull().default(2),
    status: text("status").notNull().default("Available"),
    sourceAttendanceId: integer("source_attendance_id").references(() => ptAttendance.id),
    note: text("note"),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("ix_compoff_employee").on(t.employeeId, t.status)],
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

/* ----------------------------------------------------------- shifts and rosters */

export const PUNCH_DIRECTIONS = ["In", "Out"] as const;
export type PunchDirection = (typeof PUNCH_DIRECTIONS)[number];

export const PUNCH_SOURCES = ["Device", "Csv", "Regularised"] as const;
export type PunchSource = (typeof PUNCH_SOURCES)[number];

export const ATTENDANCE_DAY_STATUS = ["Present", "Late", "HalfDay", "Absent"] as const;
export type AttendanceDayStatus = (typeof ATTENDANCE_DAY_STATUS)[number];

export const REGULARISATION_STATUS = ["Pending", "Approved", "Rejected", "Cancelled"] as const;
export type RegularisationStatus = (typeof REGULARISATION_STATUS)[number];

/** A shift's clock times, "HH:MM". A night shift's end is earlier than its start — it crosses midnight, and belongs to the day it started. */
export const ptShift = sqliteTable("pt_shift", {
  code: text("code").primaryKey(),
  name: text("name").notNull(),
  startTime: text("start_time").notNull(),
  endTime: text("end_time").notNull(),
  breakMinutes: integer("break_minutes").notNull().default(0),
  isNight: integer("is_night", { mode: "boolean" }).notNull().default(false),
  /** Minutes late before a punch counts as late, not just imprecise. */
  graceMinutes: integer("grace_minutes").notNull().default(0),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
});

/** A repeating rotation — a 21-day three-shift cycle, say. pt_roster_pattern_day names each day's shift. */
export const ptRosterPattern = sqliteTable("pt_roster_pattern", {
  code: text("code").primaryKey(),
  name: text("name").notNull(),
  cycleLengthDays: integer("cycle_length_days").notNull(),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
});

export const ptRosterPatternDay = sqliteTable(
  "pt_roster_pattern_day",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    patternCode: text("pattern_code")
      .notNull()
      .references(() => ptRosterPattern.code, { onDelete: "cascade" }),
    dayIndex: integer("day_index").notNull(),
    /** Null: a day off in the pattern. */
    shiftCode: text("shift_code").references(() => ptShift.code),
  },
  (t) => [uniqueIndex("ux_pattern_day").on(t.patternCode, t.dayIndex)],
);

/** One employee's shift on one date — generated from a pattern, edited by exception. */
export const ptRoster = sqliteTable(
  "pt_roster",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => paEmployee.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    /** Null: a day off. */
    shiftCode: text("shift_code").references(() => ptShift.code),
    patternCode: text("pattern_code").references(() => ptRosterPattern.code),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [uniqueIndex("ux_roster_employee_date").on(t.employeeId, t.date), index("ix_roster_date").on(t.date)],
);

/** A punch clock, or the generic endpoint any middleware in front of one calls — a phase-12 client limited to punches. */
export const ptDevice = sqliteTable("pt_device", {
  code: text("code").primaryKey(),
  name: text("name").notNull(),
  location: text("location"),
  clientPk: integer("client_pk").references(() => intClient.id),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
});

export const ptPunch = sqliteTable(
  "pt_punch",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => paEmployee.id, { onDelete: "cascade" }),
    deviceCode: text("device_code")
      .notNull()
      .references(() => ptDevice.code),
    at: text("at").notNull(),
    direction: text("direction").notNull(),
    source: text("source").notNull().default("Device"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    // A re-sent batch does nothing: the same device, time and employee already exists.
    uniqueIndex("ux_punch_device_at_employee").on(t.deviceCode, t.at, t.employeeId),
    index("ix_punch_employee").on(t.employeeId, t.at),
  ],
);

/** What a day's punches, against the roster, add up to — the daily job's output. */
export const ptAttendanceDay = sqliteTable(
  "pt_attendance_day",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => paEmployee.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    shiftCode: text("shift_code").references(() => ptShift.code),
    firstIn: text("first_in"),
    lastOut: text("last_out"),
    workedMinutes: integer("worked_minutes").notNull().default(0),
    lateMinutes: integer("late_minutes").notNull().default(0),
    overtimeMinutes: integer("overtime_minutes").notNull().default(0),
    status: text("status").notNull(),
    finalisedAt: text("finalised_at").notNull(),
  },
  (t) => [uniqueIndex("ux_attendanceday_employee_date").on(t.employeeId, t.date), index("ix_attendanceday_date").on(t.date)],
);

/** An employee's own account of a day — claimed in and out — against what punches or the roster show. */
export const ptRegularisation = sqliteTable(
  "pt_regularisation",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => paEmployee.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    claimedIn: text("claimed_in"),
    claimedOut: text("claimed_out"),
    reason: text("reason").notNull(),
    status: text("status").notNull().default("Pending"),
    submittedAt: text("submitted_at").notNull(),
    decidedByEmployeeId: integer("decided_by_employee_id"),
    decidedAt: text("decided_at"),
    decisionNote: text("decision_note"),
  },
  (t) => [index("ix_regularisation_employee").on(t.employeeId, t.status), index("ix_regularisation_status").on(t.status)],
);
