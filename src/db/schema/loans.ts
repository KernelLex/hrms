import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { paEmployee } from "./personnel";
import { pyAdditionalPayment } from "./payroll";

/**
 * Loans and reimbursement claims.
 *
 * Both end the same way a leave encashment or overtime payment already does:
 * a row in `py_it0015_additional_payment`, the one rail every kind of one-off
 * pay queues onto, so the payroll engine needs no change to pay either. What
 * is new here is what decides the amount and when it is due — an EMI
 * schedule for a loan, a category limit for a claim — and the approval each
 * goes through before it is queued at all.
 */

/** Approval turns "Pending" straight into "Active": the schedule generates the moment it is approved, so there is no separate resting "Approved" state to hold the loan in. */
export const LOAN_STATUSES = ["Pending", "Active", "Rejected", "Closed"] as const;
export type LoanStatus = (typeof LOAN_STATUSES)[number];

/** A loan as asked for and, once approved, as it stands. */
export const pyLoan = sqliteTable(
  "py_loan",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => paEmployee.id, { onDelete: "cascade" }),
    loanType: text("loan_type").notNull(),
    principalPaise: integer("principal_paise").notNull(),
    /** 0 for an interest-free loan. */
    annualRateBasisPoints: integer("annual_rate_basis_points").notNull().default(0),
    tenureMonths: integer("tenure_months").notNull(),
    emiPaise: integer("emi_paise").notNull(),
    startDate: text("start_date").notNull(),
    status: text("status").notNull().default("Pending"),
    reason: text("reason"),
    requestedBy: text("requested_by").notNull(),
    requestedAt: text("requested_at").notNull(),
    decidedAt: text("decided_at"),
  },
  (t) => [index("ix_loan_employee").on(t.employeeId)],
);

/**
 * The amortisation schedule, one row an instalment: reducing-balance
 * interest, principal recovered, and the balance left. `additionalPaymentId`
 * is set the moment an instalment is queued onto payroll — the same "paid by
 * run" rule as any other one-off payment, so an instalment is deducted
 * exactly once, and whether it has actually been paid yet is just whether
 * that payment's own `paid_run_id` is set.
 */
export const pyLoanSchedule = sqliteTable(
  "py_loan_schedule",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    loanId: integer("loan_id")
      .notNull()
      .references(() => pyLoan.id, { onDelete: "cascade" }),
    installmentNo: integer("installment_no").notNull(),
    dueDate: text("due_date").notNull(),
    openingBalancePaise: integer("opening_balance_paise").notNull(),
    principalPaise: integer("principal_paise").notNull(),
    interestPaise: integer("interest_paise").notNull(),
    closingBalancePaise: integer("closing_balance_paise").notNull(),
    /** What rule 3(7)(i) would add to taxable income this month, on the balance this instalment started from. Phase 21 reports it; this phase only computes and keeps it. */
    perquisiteValuePaise: integer("perquisite_value_paise").notNull().default(0),
    additionalPaymentId: integer("additional_payment_id").references(() => pyAdditionalPayment.id, { onDelete: "set null" }),
  },
  (t) => [uniqueIndex("ux_loan_schedule_installment").on(t.loanId, t.installmentNo)],
);

/** How much of a loan's principal a dated prepayment returned, before the remainder was rescheduled. */
export const pyLoanPrepayment = sqliteTable(
  "py_loan_prepayment",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    loanId: integer("loan_id")
      .notNull()
      .references(() => pyLoan.id, { onDelete: "cascade" }),
    paymentDate: text("payment_date").notNull(),
    amountPaise: integer("amount_paise").notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("ix_prepayment_loan").on(t.loanId)],
);

/**
 * The benchmark lending rate rule 3(7)(i) compares a concessional loan's own
 * rate against, dated like every other statutory rate.
 */
export const pyLoanBenchmarkRate = sqliteTable(
  "py_loan_benchmark_rate",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    validFrom: text("valid_from").notNull(),
    validTo: text("valid_to").notNull(),
    rateBasisPoints: integer("rate_basis_points").notNull(),
  },
  (t) => [uniqueIndex("ux_loan_benchmark_valid_from").on(t.validFrom)],
);

/* ------------------------------------------------------------------- claims */

export const CLAIM_STATUSES = ["Pending", "Approved", "Rejected"] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

/** Fuel, phone, medical, LTA — each with its own annual limit and whether it is taxable. */
export const pyClaimCategory = sqliteTable("py_claim_category", {
  code: text("code").primaryKey(),
  name: text("name").notNull(),
  isTaxable: integer("is_taxable", { mode: "boolean" }).notNull().default(true),
  defaultAnnualLimitPaise: integer("default_annual_limit_paise").notNull(),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
});

/** Overrides a category's default limit for one grade — the most specific limit wins, the same rule a leave policy already follows. */
export const pyClaimCategoryLimit = sqliteTable(
  "py_claim_category_limit",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    categoryCode: text("category_code")
      .notNull()
      .references(() => pyClaimCategory.code, { onDelete: "cascade" }),
    grade: text("grade").notNull(),
    annualLimitPaise: integer("annual_limit_paise").notNull(),
  },
  (t) => [uniqueIndex("ux_claim_limit_category_grade").on(t.categoryCode, t.grade)],
);

/** A claim: one category, one approval, possibly several lines each with its own bill. */
export const pyClaim = sqliteTable(
  "py_claim",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => paEmployee.id, { onDelete: "cascade" }),
    categoryCode: text("category_code")
      .notNull()
      .references(() => pyClaimCategory.code),
    claimDate: text("claim_date").notNull(),
    totalAmountPaise: integer("total_amount_paise").notNull(),
    status: text("status").notNull().default("Pending"),
    decisionNote: text("decision_note"),
    additionalPaymentId: integer("additional_payment_id").references(() => pyAdditionalPayment.id, { onDelete: "set null" }),
    requestedAt: text("requested_at").notNull(),
    decidedAt: text("decided_at"),
  },
  (t) => [index("ix_claim_employee").on(t.employeeId)],
);

/** One expense on a claim — a bill attaches as an `app_document` owned by this row. */
export const pyClaimLine = sqliteTable(
  "py_claim_line",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    claimId: integer("claim_id")
      .notNull()
      .references(() => pyClaim.id, { onDelete: "cascade" }),
    lineDate: text("line_date").notNull(),
    description: text("description").notNull(),
    amountPaise: integer("amount_paise").notNull(),
  },
  (t) => [index("ix_claimline_claim").on(t.claimId)],
);
