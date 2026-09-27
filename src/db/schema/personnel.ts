import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { omCompany, omPersonnelArea, omPersonnelSubArea, omOrgUnit, omPosition } from "./org";

/**
 * Core HR — personnel administration.
 *
 * Every fact about a person is a dated record, not a field that gets
 * overwritten. Change a salary and the old row is delimited rather than
 * destroyed, so "what was this person earning in March?" stays answerable.
 *
 * Each infotype table carries the same contract:
 *   employee_id, valid_from, valid_to, seq, created_by, created_at
 *
 * `seq` distinguishes rows that share a validity period legitimately — an
 * employee has one basic pay at a time, but several family members and several
 * communication entries.
 *
 * One table per infotype rather than a single table with a JSON blob, because
 * payroll must read basic pay as a typed, indexed, foreign-keyed value. This is
 * also how SAP stores them: PA0001, PA0002, PA0008.
 */

export const EMPLOYMENT_STATUS = ["Active", "On leave", "Terminated"] as const;
export type EmploymentStatus = (typeof EMPLOYMENT_STATUS)[number];

export const ACTION_TYPES = [
  "Hire",
  "Transfer",
  "Promotion",
  "Termination",
  "Rehire",
] as const;

export const paEmployee = sqliteTable(
  "pa_employee",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** The number people quote: EMP1001. */
    employeeNumber: text("employee_number").notNull().unique(),
    hireDate: text("hire_date").notNull(),
    employmentStatus: text("employment_status").notNull().default("Active"),
    terminationDate: text("termination_date"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("ix_employee_status").on(t.employmentStatus)],
);

/* --------------------------------------------------------- IT0000 actions */

export const paAction = sqliteTable(
  "pa_it0000_action",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => paEmployee.id, { onDelete: "cascade" }),
    actionType: text("action_type").notNull(),
    reason: text("reason"),
    validFrom: text("valid_from").notNull(),
    validTo: text("valid_to").notNull(),
    seq: integer("seq").notNull().default(1),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("ix_action_employee").on(t.employeeId, t.validFrom)],
);

/* ------------------------------------------------ IT0001 org assignment */

export const paOrgAssignment = sqliteTable(
  "pa_it0001_org_assignment",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => paEmployee.id, { onDelete: "cascade" }),
    companyCode: text("company_code")
      .notNull()
      .references(() => omCompany.code),
    areaCode: text("area_code").references(() => omPersonnelArea.code),
    subAreaCode: text("sub_area_code").references(() => omPersonnelSubArea.code),
    orgUnitCode: text("org_unit_code")
      .notNull()
      .references(() => omOrgUnit.code),
    positionCode: text("position_code")
      .notNull()
      .references(() => omPosition.code),
    costCenter: text("cost_center"),
    validFrom: text("valid_from").notNull(),
    validTo: text("valid_to").notNull(),
    seq: integer("seq").notNull().default(1),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("ux_orgassign_slice").on(t.employeeId, t.validFrom, t.seq),
    index("ix_orgassign_position").on(t.positionCode),
  ],
);

/* -------------------------------------------------- IT0002 personal data */

export const paPersonalData = sqliteTable(
  "pa_it0002_personal_data",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => paEmployee.id, { onDelete: "cascade" }),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    dateOfBirth: text("date_of_birth"),
    gender: text("gender"),
    maritalStatus: text("marital_status"),
    nationality: text("nationality"),
    validFrom: text("valid_from").notNull(),
    validTo: text("valid_to").notNull(),
    seq: integer("seq").notNull().default(1),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [uniqueIndex("ux_personal_slice").on(t.employeeId, t.validFrom, t.seq)],
);

/* ------------------------------------------------------- IT0006 addresses */

export const paAddress = sqliteTable(
  "pa_it0006_address",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => paEmployee.id, { onDelete: "cascade" }),
    addressType: text("address_type").notNull(),
    line: text("line").notNull(),
    city: text("city"),
    state: text("state"),
    postalCode: text("postal_code"),
    country: text("country"),
    validFrom: text("valid_from").notNull(),
    validTo: text("valid_to").notNull(),
    seq: integer("seq").notNull().default(1),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("ix_address_employee").on(t.employeeId, t.validFrom)],
);

/* --------------------------------------------- IT0007 planned working time */

export const paPlannedWorkingTime = sqliteTable(
  "pa_it0007_planned_working_time",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => paEmployee.id, { onDelete: "cascade" }),
    workScheduleCode: text("work_schedule_code").notNull(),
    weeklyHours: integer("weekly_hours").notNull().default(40),
    employmentPercent: integer("employment_percent").notNull().default(100),
    validFrom: text("valid_from").notNull(),
    validTo: text("valid_to").notNull(),
    seq: integer("seq").notNull().default(1),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [uniqueIndex("ux_pwt_slice").on(t.employeeId, t.validFrom, t.seq)],
);

/* ------------------------------------------------------- IT0008 basic pay */

export const paBasicPay = sqliteTable(
  "pa_it0008_basic_pay",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => paEmployee.id, { onDelete: "cascade" }),
    payScaleType: text("pay_scale_type"),
    payScaleArea: text("pay_scale_area"),
    payScaleGroup: text("pay_scale_group"),
    /** INTEGER paise. Never a float — see src/lib/money.ts. */
    amountPaise: integer("amount_paise").notNull(),
    currency: text("currency").notNull().default("INR"),
    /** Set when a performance increment wrote this row, for traceability. */
    sourceRef: text("source_ref"),
    validFrom: text("valid_from").notNull(),
    validTo: text("valid_to").notNull(),
    seq: integer("seq").notNull().default(1),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [uniqueIndex("ux_basicpay_slice").on(t.employeeId, t.validFrom, t.seq)],
);

/* ---------------------------------------------------- IT0009 bank details */

export const paBankDetails = sqliteTable(
  "pa_it0009_bank_details",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => paEmployee.id, { onDelete: "cascade" }),
    bankName: text("bank_name").notNull(),
    accountNumber: text("account_number").notNull(),
    ifsc: text("ifsc"),
    holderName: text("holder_name"),
    validFrom: text("valid_from").notNull(),
    validTo: text("valid_to").notNull(),
    seq: integer("seq").notNull().default(1),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [uniqueIndex("ux_bank_slice").on(t.employeeId, t.validFrom, t.seq)],
);

/* -------------------------------------------------- IT0021 family members */

export const paFamilyMember = sqliteTable(
  "pa_it0021_family_member",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => paEmployee.id, { onDelete: "cascade" }),
    relationship: text("relationship").notNull(),
    name: text("name").notNull(),
    dateOfBirth: text("date_of_birth"),
    validFrom: text("valid_from").notNull(),
    validTo: text("valid_to").notNull(),
    seq: integer("seq").notNull().default(1),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("ix_family_employee").on(t.employeeId)],
);

/* ---------------------------------------------------- IT0105 communication */

export const paCommunication = sqliteTable(
  "pa_it0105_communication",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => paEmployee.id, { onDelete: "cascade" }),
    commType: text("comm_type").notNull(),
    value: text("value").notNull(),
    validFrom: text("valid_from").notNull(),
    validTo: text("valid_to").notNull(),
    seq: integer("seq").notNull().default(1),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("ix_comm_employee").on(t.employeeId)],
);

/* ------------------------------------------------- work schedule reference */

/**
 * Referenced by IT0007. Time management builds screens for it in phase 4; the
 * table lands here because planned working time cannot point at nothing.
 */
export const ptWorkScheduleRule = sqliteTable("pt_work_schedule_rule", {
  code: text("code").primaryKey(),
  name: text("name").notNull(),
  weeklyHours: integer("weekly_hours").notNull().default(40),
  workingDays: text("working_days"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
});

/* ------------------------------------------------ correction requests */

/**
 * An employee asking for their record to change: what, to what, from when,
 * and the approval request that decides it. Approved, it is written through
 * the time-slice engine from its effective date, so the history stays whole.
 */
export const paChangeRequest = sqliteTable(
  "pa_change_request",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => paEmployee.id, { onDelete: "cascade" }),
    /** "personal", "address", "contact" or "bank". */
    section: text("section").notNull(),
    /** The address or contact type, where the section has several. */
    subtype: text("subtype"),
    /** The values asked for, as JSON. */
    proposed: text("proposed").notNull(),
    /** The values in force when it was asked, as JSON, for the side-by-side view. */
    current: text("current"),
    effectiveDate: text("effective_date").notNull(),
    note: text("note"),
    /** Proof, filed as one of the employee's documents: needed for bank changes. */
    evidenceDocumentId: integer("evidence_document_id"),
    /** "Pending", "Approved", "Rejected" or "Cancelled". */
    status: text("status").notNull().default("Pending"),
    /** "self" from My profile, or "api" from a connected system. */
    channel: text("channel").notNull().default("self"),
    requestedByUserId: integer("requested_by_user_id"),
    requestedByName: text("requested_by_name").notNull(),
    requestedAt: text("requested_at").notNull(),
    decidedAt: text("decided_at"),
    decisionNote: text("decision_note"),
  },
  (t) => [index("ix_change_request_employee").on(t.employeeId, t.status)],
);
