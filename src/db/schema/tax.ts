import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { paEmployee } from "./personnel";

/**
 * Income tax deducted at source.
 *
 * The slab table exists because Form 16 Part B has to show a real computation.
 * The reference mockup hardcoded the tax figure; a certificate an employee
 * files with has to add up, so the slabs are data and the arithmetic is done.
 *
 * All amounts are INTEGER paise. Rates are basis points: 1200 is 12.00%.
 */

export const TAX_REGIME = ["Old", "New"] as const;
export type TaxRegime = (typeof TAX_REGIME)[number];

export const tdsSectionMaster = sqliteTable("tds_section_master", {
  code: text("code").primaryKey(),
  description: text("description").notNull(),
  /** Null when the section is slab based, as salary under 192 is. */
  rateBasisPoints: integer("rate_basis_points"),
  isSlabBased: integer("is_slab_based", { mode: "boolean" }).notNull().default(false),
  thresholdPaise: integer("threshold_paise"),
  applicableTo: text("applicable_to").notNull().default("Employee"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
});

export const tdsTaxSlab = sqliteTable(
  "tds_tax_slab",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    regime: text("regime").notNull(),
    /** "2025-26". */
    financialYear: text("financial_year").notNull(),
    fromPaise: integer("from_paise").notNull(),
    /** Null means no upper bound. */
    toPaise: integer("to_paise"),
    rateBasisPoints: integer("rate_basis_points").notNull(),
  },
  (t) => [index("ix_slab_regime_year").on(t.regime, t.financialYear, t.fromPaise)],
);

export const tdsEmployeeDeclaration = sqliteTable(
  "tds_employee_declaration",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => paEmployee.id, { onDelete: "cascade" }),
    financialYear: text("financial_year").notNull(),
    regime: text("regime").notNull().default("New"),
    section80CPaise: integer("section_80c_paise").notNull().default(0),
    section80DPaise: integer("section_80d_paise").notNull().default(0),
    hraExemptionPaise: integer("hra_exemption_paise").notNull().default(0),
    otherIncomePaise: integer("other_income_paise").notNull().default(0),
    status: text("status").notNull().default("Declared"),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [uniqueIndex("ux_declaration_employee_year").on(t.employeeId, t.financialYear)],
);

/** Per-quarter record of tax deducted and deposited — the Form 24Q source. */
export const tdsDeductionRegister = sqliteTable(
  "tds_deduction_register",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => paEmployee.id, { onDelete: "cascade" }),
    financialYear: text("financial_year").notNull(),
    /** 1 to 4, where 1 is April to June. */
    quarter: integer("quarter").notNull(),
    grossPaidPaise: integer("gross_paid_paise").notNull().default(0),
    tdsDeductedPaise: integer("tds_deducted_paise").notNull().default(0),
    challanBsr: text("challan_bsr"),
    depositDate: text("deposit_date"),
    receipt24q: text("receipt_24q"),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("ux_register_employee_quarter").on(
      t.employeeId,
      t.financialYear,
      t.quarter,
    ),
  ],
);

export const tdsForm16 = sqliteTable(
  "tds_form16",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => paEmployee.id, { onDelete: "cascade" }),
    financialYear: text("financial_year").notNull(),
    certificateNo: text("certificate_no").notNull(),
    employerName: text("employer_name").notNull(),
    employerTan: text("employer_tan").notNull(),
    employerPan: text("employer_pan").notNull(),
    employeePan: text("employee_pan"),
    regime: text("regime").notNull(),

    /* Part B computation, stored so a reissued certificate is identical. */
    grossSalaryPaise: integer("gross_salary_paise").notNull().default(0),
    section10ExemptPaise: integer("section_10_exempt_paise").notNull().default(0),
    standardDeductionPaise: integer("standard_deduction_paise").notNull().default(0),
    chapterViaPaise: integer("chapter_via_paise").notNull().default(0),
    taxableIncomePaise: integer("taxable_income_paise").notNull().default(0),
    taxOnIncomePaise: integer("tax_on_income_paise").notNull().default(0),
    rebate87aPaise: integer("rebate_87a_paise").notNull().default(0),
    cessPaise: integer("cess_paise").notNull().default(0),
    totalTaxPaise: integer("total_tax_paise").notNull().default(0),
    tdsDeductedPaise: integer("tds_deducted_paise").notNull().default(0),
    /** Positive means the employee still owes; negative means a refund. */
    balancePaise: integer("balance_paise").notNull().default(0),

    generatedAt: text("generated_at").notNull(),
    generatedBy: text("generated_by").notNull(),
  },
  (t) => [uniqueIndex("ux_form16_employee_year").on(t.employeeId, t.financialYear)],
);
