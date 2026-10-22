import { sqliteTable, text, integer, index, primaryKey } from "drizzle-orm/sqlite-core";
import { omCompany } from "./org";
import { tdsEmployeeDeclaration } from "./tax";

/**
 * What an employee may declare, as configuration rather than as columns.
 *
 * The statutory list belongs to a country — India's 80C, 80D, 24(b), HRA,
 * LTA — so that is where a component is defined. A company then says which
 * of them it offers and may tighten a cap, the same override-with-fallback
 * shape `py_gl_mapping` uses for GL accounts.
 *
 * Every component declares its `kind`, and that is what the tax engine
 * reads: the declared lines sum by kind into the two figures the
 * computation has always taken — exemptions under section 10, and
 * deductions under Chapter VI-A — so adding a component is a row, not a
 * change to how tax is worked out.
 */

/** Where a component lands in the computation. */
export const COMPONENT_KINDS = ["section_10", "chapter_via", "other_income"] as const;
export type ComponentKind = (typeof COMPONENT_KINDS)[number];

export const txComponent = sqliteTable(
  "tx_component",
  {
    /** ISO country code: the statutory list is national. */
    country: text("country").notNull(),
    /** "80C", "HRA", "24B" — what the section is called where it applies. */
    code: text("code").notNull(),
    name: text("name").notNull(),
    kind: text("kind").notNull(),
    /** The statutory ceiling in paise, where the law sets one. */
    capPaise: integer("cap_paise"),
    /** Whether a receipt has to be filed and verified before it reduces tax. */
    requiresProof: integer("requires_proof", { mode: "boolean" }).notNull().default(true),
    /**
     * Worked out rather than typed: HRA is the one the law computes from
     * rent, salary and city. A derived component's declared amount is
     * replaced on save by what the engine makes of it.
     */
    isDerived: integer("is_derived", { mode: "boolean" }).notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  },
  (t) => [primaryKey({ columns: [t.country, t.code] })],
);

/**
 * Which of a country's components one company offers, and at what cap.
 * A company with no row for a component simply offers it as defined —
 * absence means the default, not exclusion.
 */
export const txCompanyComponent = sqliteTable(
  "tx_company_component",
  {
    companyCode: text("company_code")
      .notNull()
      .references(() => omCompany.code),
    componentCode: text("component_code").notNull(),
    isEnabled: integer("is_enabled", { mode: "boolean" }).notNull().default(true),
    /** Lower than the statutory cap, never higher: a company may be stricter. */
    capOverridePaise: integer("cap_override_paise"),
  },
  (t) => [primaryKey({ columns: [t.companyCode, t.componentCode] })],
);

/**
 * One declared figure, against one component. Replaces the four fixed
 * columns the declaration used to carry, so what can be declared is data.
 */
export const tdsDeclarationLine = sqliteTable(
  "tds_declaration_line",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    declarationId: integer("declaration_id")
      .notNull()
      .references(() => tdsEmployeeDeclaration.id, { onDelete: "cascade" }),
    componentCode: text("component_code").notNull(),
    declaredPaise: integer("declared_paise").notNull().default(0),
  },
  (t) => [index("ix_declaration_line").on(t.declarationId, t.componentCode)],
);

/** Metro or not, which is the only thing section 10(13A) asks of a city. */
export const CITY_CATEGORIES = ["METRO", "NON_METRO"] as const;
export type CityCategory = (typeof CITY_CATEGORIES)[number];

/**
 * Which cities count as metro for HRA. Delhi, Mumbai, Kolkata and Chennai
 * are the four the law names, and holding them as rows rather than as a
 * literal is what lets the client add one without a release.
 */
export const txCityCategory = sqliteTable(
  "tx_city_category",
  {
    country: text("country").notNull(),
    /** Stored upper case, matched against the employee's address city. */
    city: text("city").notNull(),
    category: text("category").notNull(),
  },
  (t) => [primaryKey({ columns: [t.country, t.city] })],
);
