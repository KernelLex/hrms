import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { paEmployee } from "./personnel";
import { omPersonnelArea } from "./org";

/**
 * Payroll.
 *
 * Every amount is INTEGER paise. A payroll run multiplies and divides across
 * hundreds of employees, so binary floating point would drift into real money.
 *
 * The shape follows SAP: a control record decides whether a period may still
 * be edited, wage types define what can be earned or deducted, and a run
 * produces a result per employee plus a line per wage type. The lines are what
 * a payslip is actually made of — without them the totals are decoration.
 */

export const PERIOD_STATUS = ["Open", "Locked", "Posted"] as const;
export type PeriodStatus = (typeof PERIOD_STATUS)[number];

export const WAGE_KIND = ["Earning", "Deduction"] as const;

/**
 * A regular run pays the month for everyone in the personnel area. An
 * off-cycle run pays selected people outside it — a bonus, a correction, a
 * final settlement — and can run after the period is posted.
 */
export const RUN_TYPE = ["Regular", "Off-cycle"] as const;
export type RunType = (typeof RUN_TYPE)[number];

/** A run is calculated in batches, so it is "In progress" until the last one. */
export const RUN_STATUS = ["In progress", "Completed"] as const;
export const AMOUNT_TYPE = ["Fixed", "PercentOfBasic", "Formula"] as const;

export const pyWageType = sqliteTable("py_wage_type", {
  code: text("code").primaryKey(),
  name: text("name").notNull(),
  kind: text("kind").notNull(),
  amountType: text("amount_type").notNull(),
  /** Used when amountType is PercentOfBasic; 1200 means 12.00%. */
  percentBasisPoints: integer("percent_basis_points"),
  /** Used when amountType is Fixed. */
  fixedAmountPaise: integer("fixed_amount_paise"),
  /** Identifies a built-in rule: PF, ESI, TDS. */
  formulaKey: text("formula_key"),
  isTaxable: integer("is_taxable", { mode: "boolean" }).notNull().default(true),
  /** Whether the run generates this automatically, or it comes from IT0014/15. */
  isAutomatic: integer("is_automatic", { mode: "boolean" }).notNull().default(false),
  glAccount: text("gl_account"),
  sortOrder: integer("sort_order").notNull().default(100),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
});

export const pyPayrollPeriod = sqliteTable(
  "py_payroll_period",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    areaCode: text("area_code")
      .notNull()
      .references(() => omPersonnelArea.code),
    year: integer("year").notNull(),
    month: integer("month").notNull(),
    payDate: text("pay_date"),
    status: text("status").notNull().default("Open"),
    releasedBy: text("released_by"),
    releasedAt: text("released_at"),
    postedAt: text("posted_at"),
  },
  (t) => [uniqueIndex("ux_period").on(t.areaCode, t.year, t.month)],
);

/* -------------------------------------------- IT0014 recurring payments */

export const pyRecurringPayment = sqliteTable(
  "py_it0014_recurring_payment",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => paEmployee.id, { onDelete: "cascade" }),
    wageTypeCode: text("wage_type_code")
      .notNull()
      .references(() => pyWageType.code),
    amountPaise: integer("amount_paise").notNull(),
    startDate: text("start_date").notNull(),
    endDate: text("end_date").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("ix_recurring_employee").on(t.employeeId)],
);

/* -------------------------------------------- IT0015 additional payments */

export const pyAdditionalPayment = sqliteTable(
  "py_it0015_additional_payment",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => paEmployee.id, { onDelete: "cascade" }),
    wageTypeCode: text("wage_type_code")
      .notNull()
      .references(() => pyWageType.code),
    amountPaise: integer("amount_paise").notNull(),
    paymentDate: text("payment_date").notNull(),
    /**
     * The run that paid it. A one-off payment is paid exactly once: by the
     * regular run of its month, or by an off-cycle run if it arrived after
     * that. Replacing a run releases its payments again (SET NULL).
     */
    paidRunId: integer("paid_run_id").references(() => pyPayrollRun.id, {
      onDelete: "set null",
    }),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("ix_additional_employee").on(t.employeeId, t.paymentDate)],
);

/* ------------------------------------------------------------ payroll run */

export const pyPayrollRun = sqliteTable(
  "py_payroll_run",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    periodId: integer("period_id")
      .notNull()
      .references(() => pyPayrollPeriod.id, { onDelete: "cascade" }),
    runAt: text("run_at").notNull(),
    runBy: text("run_by").notNull(),
    runType: text("run_type").notNull().default("Regular"),
    status: text("status").notNull().default("Completed"),
    /** Why an off-cycle run was made; shown on its payslips. */
    reason: text("reason"),
    /** An off-cycle run's own pay date; a regular run uses the period's. */
    payDate: text("pay_date"),
    /** People the run set out to calculate, and how many it has done. */
    plannedCount: integer("planned_count").notNull().default(0),
    employeeCount: integer("employee_count").notNull().default(0),
    errorCount: integer("error_count").notNull().default(0),
    grossTotalPaise: integer("gross_total_paise").notNull().default(0),
    netTotalPaise: integer("net_total_paise").notNull().default(0),
    completedAt: text("completed_at"),
  },
  (t) => [index("ix_run_period").on(t.periodId)],
);

/**
 * The people a run is to calculate, fixed when it starts. A batch takes the
 * next few not yet done, so a run of thousands proceeds in steps that each
 * fit inside a serverless time limit, and resumes where it stopped.
 */
export const pyRunMember = sqliteTable(
  "py_run_member",
  {
    runId: integer("run_id")
      .notNull()
      .references(() => pyPayrollRun.id, { onDelete: "cascade" }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => paEmployee.id, { onDelete: "cascade" }),
    done: integer("done", { mode: "boolean" }).notNull().default(false),
  },
  (t) => [
    uniqueIndex("ux_run_member").on(t.runId, t.employeeId),
    index("ix_run_member_pending").on(t.runId, t.done),
  ],
);

export const pyPayrollResult = sqliteTable(
  "py_payroll_result",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    runId: integer("run_id")
      .notNull()
      .references(() => pyPayrollRun.id, { onDelete: "cascade" }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => paEmployee.id, { onDelete: "cascade" }),
    grossPaise: integer("gross_paise").notNull().default(0),
    deductionsPaise: integer("deductions_paise").notNull().default(0),
    netPaise: integer("net_paise").notNull().default(0),
    unpaidDays: integer("unpaid_days").notNull().default(0),
    workingDays: integer("working_days").notNull().default(0),
    /** Working days the person was employed; less than workingDays for a joiner or leaver. */
    employedDays: integer("employed_days").notNull().default(0),
    status: text("status").notNull().default("Calculated"),
    errorMessage: text("error_message"),
  },
  (t) => [uniqueIndex("ux_result_run_employee").on(t.runId, t.employeeId)],
);

/** The gross-to-net detail. A payslip is rendered from these. */
export const pyPayrollResultLine = sqliteTable(
  "py_payroll_result_line",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    resultId: integer("result_id")
      .notNull()
      .references(() => pyPayrollResult.id, { onDelete: "cascade" }),
    wageTypeCode: text("wage_type_code").notNull(),
    wageTypeName: text("wage_type_name").notNull(),
    kind: text("kind").notNull(),
    amountPaise: integer("amount_paise").notNull(),
    sortOrder: integer("sort_order").notNull().default(100),
    /**
     * For an arrears line: the earlier period it corrects. Recalculating that
     * period later subtracts what these lines already paid, so a correction
     * is paid once, not every month after.
     */
    forPeriodId: integer("for_period_id"),
  },
  (t) => [
    index("ix_line_result").on(t.resultId),
    index("ix_line_for_period").on(t.forPeriodId),
  ],
);

/* ------------------------------------------------------ bank and posting */

export const pyBankTransferFile = sqliteTable("py_bank_transfer_file", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  runId: integer("run_id")
    .notNull()
    .references(() => pyPayrollRun.id, { onDelete: "cascade" }),
  paymentDate: text("payment_date").notNull(),
  format: text("format").notNull().default("NEFT bulk upload (CSV)"),
  totalPaise: integer("total_paise").notNull().default(0),
  lineCount: integer("line_count").notNull().default(0),
  generatedAt: text("generated_at").notNull(),
  generatedBy: text("generated_by").notNull(),
});

export const pyBankTransferLine = sqliteTable(
  "py_bank_transfer_line",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    fileId: integer("file_id")
      .notNull()
      .references(() => pyBankTransferFile.id, { onDelete: "cascade" }),
    employeeId: integer("employee_id").notNull(),
    employeeName: text("employee_name").notNull(),
    bankName: text("bank_name").notNull(),
    accountNumber: text("account_number").notNull(),
    ifsc: text("ifsc"),
    amountPaise: integer("amount_paise").notNull(),
  },
  (t) => [index("ix_bankline_file").on(t.fileId)],
);

export const pyGlPosting = sqliteTable("py_gl_posting", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  runId: integer("run_id")
    .notNull()
    .references(() => pyPayrollRun.id, { onDelete: "cascade" }),
  postingDate: text("posting_date").notNull(),
  postedAt: text("posted_at").notNull(),
  postedBy: text("posted_by").notNull(),
});

export const pyGlPostingLine = sqliteTable(
  "py_gl_posting_line",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    postingId: integer("posting_id")
      .notNull()
      .references(() => pyGlPosting.id, { onDelete: "cascade" }),
    glAccount: text("gl_account").notNull(),
    description: text("description").notNull(),
    debitPaise: integer("debit_paise").notNull().default(0),
    creditPaise: integer("credit_paise").notNull().default(0),
    costCenter: text("cost_center"),
  },
  (t) => [index("ix_glline_posting").on(t.postingId)],
);

export const pyStatutoryRemittance = sqliteTable(
  "py_statutory_remittance",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    runId: integer("run_id")
      .notNull()
      .references(() => pyPayrollRun.id, { onDelete: "cascade" }),
    authority: text("authority").notNull(),
    amountPaise: integer("amount_paise").notNull(),
    dueDate: text("due_date").notNull(),
    status: text("status").notNull().default("Due"),
    remittedAt: text("remitted_at"),
    reference: text("reference"),
  },
  (t) => [index("ix_remittance_run").on(t.runId)],
);
