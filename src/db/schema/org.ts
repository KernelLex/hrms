import { sqliteTable, text, integer, index, type AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { ptHolidayCalendar } from "./time";

/**
 * Org management — the backbone every other module foreign-keys into.
 *
 *   organisation / company / vertical / department / cost centre ...
 *     all one self-referencing tree of org units, each tagged with a level type
 *   position (self-referencing reporting line, points at an org unit and a job)
 *   job family -> job (classification, cross-cutting, not part of the tree)
 *
 * The shape of the hierarchy is data, not code: `om_level_type` says what
 * levels exist, what may nest under what, and which behaviours each level
 * carries. That is why there is no table per level — one tree holds them all,
 * and HR can add a level without a migration.
 *
 * Org units and positions carry validity dates, so the structure has a history
 * rather than only a current state.
 */

/**
 * A level in the hierarchy, defined by HR rather than by this file.
 *
 * The three role flags are what the rest of the system actually reads: a level
 * is where payroll periods group, or where a holiday calendar attaches, or a
 * cost-booking leaf — and a level may carry more than one of those at once
 * (a business center is typically both a payroll group and a calendar level).
 * Nothing resolves a role by level name; it walks up the tree looking for the
 * nearest ancestor whose level carries the flag.
 */
export const omLevelType = sqliteTable("om_level_type", {
  code: text("code").primaryKey(),
  name: text("name").notNull(),
  /** What a node of this level may sit under. Null means it may sit at the top. */
  parentLevelTypeCode: text("parent_level_type_code").references((): AnySQLiteColumn => omLevelType.code),
  /** Display and creation order, top of the hierarchy first. */
  rank: integer("rank").notNull().default(0),
  /** Payroll periods are opened against nodes of this level, and leave policies match by it. */
  isPayrollGroup: integer("is_payroll_group", { mode: "boolean" }).notNull().default(false),
  /** A holiday calendar attaches to nodes of this level. */
  isCalendarLevel: integer("is_calendar_level", { mode: "boolean" }).notNull().default(false),
  /** A cost-booking leaf: these are what the ERP reads as cost centres. */
  isCostCentre: integer("is_cost_centre", { mode: "boolean" }).notNull().default(false),
  /**
   * Nodes at this level are classified as earning revenue or recovering cost,
   * which is what the reference design calls a business centre.
   */
  isBusinessCentre: integer("is_business_centre", { mode: "boolean" }).notNull().default(false),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
});

export const omCompany = sqliteTable("om_company", {
  code: text("code").primaryKey(),
  name: text("name").notNull(),
  address: text("address"),
  city: text("city"),
  country: text("country"),
  /** The legal entity pays in one currency and keeps books to one year. */
  currency: text("currency").notNull().default("INR"),
  /** The fiscal year's first day, as MM-DD. India's April start is the default. */
  fiscalYearStart: text("fiscal_year_start").notNull().default("04-01"),
  /**
   * The node this company sits under, for a group that owns several legal
   * entities. Null for a single-company tenant, which is why it is optional.
   */
  parentNodeCode: text("parent_node_code").references((): AnySQLiteColumn => omOrgUnit.code),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
});

/** Groups similar jobs across the whole organisation — Manufacturing, IT, HR. */
export const omJobFamily = sqliteTable("om_job_family", {
  code: text("code").primaryKey(),
  name: text("name").notNull(),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
});

/** What a business centre is: it earns revenue, or it recovers internal cost. */
export const CENTRE_TYPES = ["PROFIT", "SHARED"] as const;
export type CentreType = (typeof CENTRE_TYPES)[number];

export const omJob = sqliteTable("om_job", {
  code: text("code").primaryKey(),
  title: text("title").notNull(),
  /** The job's own grade, carried by the job rather than the person. */
  grade: text("grade"),
  /**
   * Optional on purpose: a job loaded before its family exists is better than
   * a refused import. The screens require one.
   */
  jobFamilyCode: text("job_family_code").references(() => omJobFamily.code),
  description: text("description"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
});

/**
 * Every node of the hierarchy, at every level: an organisation, a vertical, a
 * department, a cost centre. What a row *is* comes from its level type, not
 * from which table it sits in.
 */
export const omOrgUnit = sqliteTable(
  "om_org_unit",
  {
    code: text("code").primaryKey(),
    name: text("name").notNull(),
    /** Self-reference builds the tree. Null means top level. */
    parentCode: text("parent_code").references((): AnySQLiteColumn => omOrgUnit.code),
    /**
     * Nullable because a node above the legal entities — a group's
     * "Organisation" node — belongs to no single company.
     */
    companyCode: text("company_code").references(() => omCompany.code),
    /** Which level this node is. Defaults to a plain department. */
    levelTypeCode: text("level_type_code")
      .notNull()
      .default("DEPARTMENT")
      .references(() => omLevelType.code),
    /**
     * The public holidays everyone under this node gets. Set only on nodes
     * whose level is a calendar level; read by walking up from the employee.
     */
    calendarCode: text("calendar_code").references(() => ptHolidayCalendar.code),
    /** "PROFIT" or "SHARED". Set only on nodes whose level is a business centre. */
    centreType: text("centre_type"),
    validFrom: text("valid_from").notNull(),
    validTo: text("valid_to").notNull(),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  },
  (t) => [
    index("ix_orgunit_parent").on(t.parentCode),
    index("ix_orgunit_company").on(t.companyCode),
    index("ix_orgunit_level").on(t.levelTypeCode),
  ],
);

export const omPosition = sqliteTable(
  "om_position",
  {
    code: text("code").primaryKey(),
    title: text("title").notNull(),
    orgUnitCode: text("org_unit_code")
      .notNull()
      .references(() => omOrgUnit.code),
    jobCode: text("job_code")
      .notNull()
      .references(() => omJob.code),
    /** Self-reference builds the reporting hierarchy. Null means top position. */
    reportsToCode: text("reports_to_code").references((): AnySQLiteColumn => omPosition.code),
    isManager: integer("is_manager", { mode: "boolean" }).notNull().default(false),
    /** Set true when nobody holds the chair; recruitment opens requisitions against these. */
    isVacant: integer("is_vacant", { mode: "boolean" }).notNull().default(true),
    /** The monthly cost HR budgeted for the chair, set when a headcount request opens it. */
    budgetPaise: integer("budget_paise"),
    validFrom: text("valid_from").notNull(),
    validTo: text("valid_to").notNull(),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  },
  (t) => [
    index("ix_position_orgunit").on(t.orgUnitCode),
    index("ix_position_reportsto").on(t.reportsToCode),
  ],
);

/** History of reporting-line changes, so a reorg is auditable. */
export const omReportingLine = sqliteTable(
  "om_reporting_line",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    positionCode: text("position_code")
      .notNull()
      .references(() => omPosition.code),
    reportsToCode: text("reports_to_code")
      .notNull()
      .references(() => omPosition.code),
    effectiveFrom: text("effective_from").notNull(),
    remarks: text("remarks"),
  },
  (t) => [index("ix_reportingline_position").on(t.positionCode)],
);

/**
 * A manager asking to grow the structure: a new position, before it exists.
 * Goes through the "headcount" approval flow; approving it opens the
 * position (and its job and, if it is new, its department) with the budget
 * asked for, ready for recruitment to open a requisition against.
 */
export const omHeadcountRequest = sqliteTable("om_headcount_request", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  orgUnitCode: text("org_unit_code")
    .notNull()
    .references(() => omOrgUnit.code),
  jobCode: text("job_code")
    .notNull()
    .references(() => omJob.code),
  title: text("title").notNull(),
  grade: text("grade"),
  budgetPaise: integer("budget_paise").notNull(),
  reason: text("reason"),
  requestedByEmployeeId: integer("requested_by_employee_id"),
  requestedByName: text("requested_by_name").notNull(),
  /** "Pending", "Approved", "Rejected" or "Cancelled" — mirrors the wf_request it drives. */
  status: text("status").notNull().default("Pending"),
  /** Set once approved: the position the request opened. */
  positionCode: text("position_code").references(() => omPosition.code),
  requestedAt: text("requested_at").notNull(),
  decidedAt: text("decided_at"),
  decisionNote: text("decision_note"),
});
