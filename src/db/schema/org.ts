import { sqliteTable, text, integer, index, type AnySQLiteColumn } from "drizzle-orm/sqlite-core";

/**
 * Org management — the backbone every other module foreign-keys into.
 *
 *   company -> personnel area -> personnel sub-area
 *   org unit (self-referencing tree)
 *   position (self-referencing reporting line, points at an org unit and a job)
 *
 * Org units and positions carry validity dates, so the structure has a history
 * rather than only a current state.
 */

export const omCompany = sqliteTable("om_company", {
  code: text("code").primaryKey(),
  name: text("name").notNull(),
  address: text("address"),
  city: text("city"),
  country: text("country"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
});

export const omPersonnelArea = sqliteTable(
  "om_personnel_area",
  {
    code: text("code").primaryKey(),
    companyCode: text("company_code")
      .notNull()
      .references(() => omCompany.code),
    name: text("name").notNull(),
    location: text("location"),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  },
  (t) => [index("ix_area_company").on(t.companyCode)],
);

export const omPersonnelSubArea = sqliteTable(
  "om_personnel_sub_area",
  {
    code: text("code").primaryKey(),
    areaCode: text("area_code")
      .notNull()
      .references(() => omPersonnelArea.code),
    name: text("name").notNull(),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  },
  (t) => [index("ix_subarea_area").on(t.areaCode)],
);

export const omJob = sqliteTable("om_job", {
  code: text("code").primaryKey(),
  title: text("title").notNull(),
  jobGroup: text("job_group"),
  description: text("description"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
});

export const omOrgUnit = sqliteTable(
  "om_org_unit",
  {
    code: text("code").primaryKey(),
    name: text("name").notNull(),
    /** Self-reference builds the department tree. Null means top level. */
    parentCode: text("parent_code").references((): AnySQLiteColumn => omOrgUnit.code),
    companyCode: text("company_code")
      .notNull()
      .references(() => omCompany.code),
    areaCode: text("area_code").references(() => omPersonnelArea.code),
    validFrom: text("valid_from").notNull(),
    validTo: text("valid_to").notNull(),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  },
  (t) => [
    index("ix_orgunit_parent").on(t.parentCode),
    index("ix_orgunit_company").on(t.companyCode),
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
