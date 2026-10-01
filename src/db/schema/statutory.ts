import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { paEmployee } from "./personnel";

/**
 * Statutory compliance, as dated rows rather than code — PF, ESI,
 * professional tax and the labour welfare fund, each state's own where the
 * law itself varies by state, and the income-tax constants `engines/tax.ts`
 * used to hold as literals. A rate change is a row with a new `valid_from`,
 * never a deploy.
 */

/* ------------------------------------------------------------------------ PF */

/**
 * Employees' Provident Fund. Employee and employer both pay 12% of PF
 * wages, capped at the ceiling; of the employer's share, 8.33% (capped the
 * same way) goes to the Employees' Pension Scheme and the rest to EPF
 * proper. EDLI and the admin charge are separate small employer costs on
 * top, also capped at the ceiling.
 */
export const pyPfRate = sqliteTable(
  "py_pf_rate",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    validFrom: text("valid_from").notNull(),
    validTo: text("valid_to").notNull(),
    employeeRateBasisPoints: integer("employee_rate_basis_points").notNull().default(1200),
    employerRateBasisPoints: integer("employer_rate_basis_points").notNull().default(1200),
    epsRateBasisPoints: integer("eps_rate_basis_points").notNull().default(833),
    edliRateBasisPoints: integer("edli_rate_basis_points").notNull().default(50),
    adminChargeBasisPoints: integer("admin_charge_basis_points").notNull().default(50),
    wageCeilingPaise: integer("wage_ceiling_paise").notNull().default(1_500_000),
  },
  (t) => [uniqueIndex("ux_pf_rate_valid_from").on(t.validFrom)],
);

/* ----------------------------------------------------------------------- ESI */

/** Applies for a whole contribution period (April–September, October–March) once an employee is in it, even if a raise takes them over the ceiling mid-period. */
export const pyEsiRate = sqliteTable(
  "py_esi_rate",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    validFrom: text("valid_from").notNull(),
    validTo: text("valid_to").notNull(),
    employeeRateBasisPoints: integer("employee_rate_basis_points").notNull().default(75),
    employerRateBasisPoints: integer("employer_rate_basis_points").notNull().default(325),
    wageCeilingPaise: integer("wage_ceiling_paise").notNull().default(2_100_000),
  },
  (t) => [uniqueIndex("ux_esi_rate_valid_from").on(t.validFrom)],
);

/* --------------------------------------------------------- professional tax */

/** Monthly slabs, per state. Maharashtra's own February row charges more, to reach its ₹2,500 annual cap on an 11-times-a-year schedule. */
export const pyProfessionalTaxSlab = sqliteTable(
  "py_professional_tax_slab",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    state: text("state").notNull(),
    validFrom: text("valid_from").notNull(),
    validTo: text("valid_to").notNull(),
    fromPaise: integer("from_paise").notNull(),
    /** Null: no upper bound. */
    toPaise: integer("to_paise"),
    amountPaise: integer("amount_paise").notNull(),
    isFebruary: integer("is_february", { mode: "boolean" }).notNull().default(false),
  },
  (t) => [index("ix_pt_slab_state").on(t.state, t.validFrom)],
);

/* ------------------------------------------------------------------------ LWF */

export const LWF_FREQUENCIES = ["Monthly", "HalfYearly", "Annual"] as const;
export type LwfFrequency = (typeof LWF_FREQUENCIES)[number];

/** Small, and due only in the cycle's own month — most of the year nothing is owed. */
export const pyLwfRate = sqliteTable(
  "py_lwf_rate",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    state: text("state").notNull(),
    validFrom: text("valid_from").notNull(),
    validTo: text("valid_to").notNull(),
    frequency: text("frequency").notNull().default("HalfYearly"),
    employeeAmountPaise: integer("employee_amount_paise").notNull(),
    employerAmountPaise: integer("employer_amount_paise").notNull(),
    /** The month (1-12, calendar) each cycle falls due in. Two for HalfYearly: June and December. */
    dueMonth: integer("due_month").notNull(),
  },
  (t) => [index("ix_lwf_rate_state").on(t.state, t.validFrom)],
);

/* --------------------------------------------------------------- tax constants */

/** What `engines/tax.ts` held as literals: the standard deduction and the 87A rebate, by year and regime, plus cess. */
export const pyTaxConstant = sqliteTable(
  "py_tax_constant",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    financialYear: text("financial_year").notNull(),
    regime: text("regime").notNull(),
    standardDeductionPaise: integer("standard_deduction_paise").notNull(),
    rebate87aLimitPaise: integer("rebate_87a_limit_paise").notNull(),
    rebate87aMaxPaise: integer("rebate_87a_max_paise").notNull(),
    cessBasisPoints: integer("cess_basis_points").notNull().default(400),
  },
  (t) => [uniqueIndex("ux_tax_constant_year_regime").on(t.financialYear, t.regime)],
);

/* ------------------------------------------------- IT0011 statutory details */

/** UAN, ESI number and the state an employee's professional tax follows — dated, like every other infotype. */
export const paStatutoryDetails = sqliteTable(
  "pa_it0011_statutory_details",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => paEmployee.id, { onDelete: "cascade" }),
    uan: text("uan"),
    esiNumber: text("esi_number"),
    professionalTaxState: text("professional_tax_state"),
    /** Held from phase 21, for Form 16 and the 24Q return. */
    pan: text("pan"),
    validFrom: text("valid_from").notNull(),
    validTo: text("valid_to").notNull(),
    seq: integer("seq").notNull().default(1),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [uniqueIndex("ux_statutory_slice").on(t.employeeId, t.validFrom, t.seq)],
);
