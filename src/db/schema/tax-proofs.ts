import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { paEmployee } from "./personnel";
import { appDocument } from "./app";

/**
 * Tax completeness: proof against each declared item, rent for the HRA
 * exemption, perquisites for Form 12BA, and the Form 10E working for
 * arrears that relate to an earlier year.
 */

/** One per financial year. After `closesAt`, an unverified item no longer reduces TDS. */
export const tdsProofWindow = sqliteTable("tds_proof_window", {
  financialYear: text("financial_year").primaryKey(),
  opensAt: text("opens_at").notNull(),
  closesAt: text("closes_at").notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull(),
});

export const PROOF_SECTIONS = ["80C", "80D", "HRA"] as const;
export type ProofSection = (typeof PROOF_SECTIONS)[number];
export const PROOF_STATUSES = ["Pending", "Verified", "Rejected"] as const;
export type ProofStatus = (typeof PROOF_STATUSES)[number];

/** One piece of evidence against a declared section — an employee may file more than one per section. */
export const tdsProof = sqliteTable(
  "tds_proof",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => paEmployee.id, { onDelete: "cascade" }),
    financialYear: text("financial_year").notNull(),
    section: text("section").notNull(),
    amountPaise: integer("amount_paise").notNull(),
    documentId: integer("document_id").references(() => appDocument.id),
    status: text("status").notNull().default("Pending"),
    note: text("note"),
    verifiedBy: text("verified_by"),
    verifiedAt: text("verified_at"),
    submittedAt: text("submitted_at").notNull(),
  },
  (t) => [index("ix_proof_employee_year").on(t.employeeId, t.financialYear, t.section)],
);

/** Rent for one employee's one financial year — a single figure, not tracked by period within the year. */
export const tdsRent = sqliteTable(
  "tds_rent",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => paEmployee.id, { onDelete: "cascade" }),
    financialYear: text("financial_year").notNull(),
    monthlyRentPaise: integer("monthly_rent_paise").notNull(),
    landlordName: text("landlord_name").notNull(),
    /** Required once annual rent crosses ₹1 lakh. */
    landlordPan: text("landlord_pan"),
    isMetro: integer("is_metro", { mode: "boolean" }).notNull().default(false),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [uniqueIndex("ux_rent_employee_year").on(t.employeeId, t.financialYear)],
);

/** A perquisite for Form 12BA. Loans are the only source today; a car or accommodation would add rows the same way. */
export const tdsPerquisite = sqliteTable(
  "tds_perquisite",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => paEmployee.id, { onDelete: "cascade" }),
    financialYear: text("financial_year").notNull(),
    perquisiteType: text("perquisite_type").notNull(),
    /** "py_loan:14", so re-running the computation finds and replaces what it already wrote rather than piling up. */
    source: text("source").notNull(),
    amountPaise: integer("amount_paise").notNull(),
    computedAt: text("computed_at").notNull(),
  },
  (t) => [uniqueIndex("ux_perquisite_source").on(t.source, t.financialYear), index("ix_perquisite_employee_year").on(t.employeeId, t.financialYear)],
);

/** The Form 10E working for one year's arrears that relate to an earlier one. */
export const tdsArrearsRelief = sqliteTable(
  "tds_arrears_relief",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => paEmployee.id, { onDelete: "cascade" }),
    financialYear: text("financial_year").notNull(),
    relatesToYear: text("relates_to_year").notNull(),
    arrearsPaise: integer("arrears_paise").notNull(),
    taxWithArrearsThisYearPaise: integer("tax_with_arrears_this_year_paise").notNull(),
    taxWithoutArrearsThisYearPaise: integer("tax_without_arrears_this_year_paise").notNull(),
    taxWithArrearsThatYearPaise: integer("tax_with_arrears_that_year_paise").notNull(),
    taxWithoutArrearsThatYearPaise: integer("tax_without_arrears_that_year_paise").notNull(),
    reliefPaise: integer("relief_paise").notNull(),
    computedAt: text("computed_at").notNull(),
  },
  (t) => [uniqueIndex("ux_arrears_relief_employee_years").on(t.employeeId, t.financialYear, t.relatesToYear)],
);
