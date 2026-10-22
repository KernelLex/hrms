import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { db, rawClient } from "@/lib/db";
import {
  txComponent,
  txCompanyComponent,
  txCityCategory,
  tdsDeclarationLine,
  type ComponentKind,
} from "@/db/schema";
import { hraExemption } from "@/lib/engines/tax";

/**
 * The declaration's components, as one company sees them.
 *
 * What an employee may declare is the country's catalogue, narrowed by what
 * their own company offers. The engine never reads a component by name: the
 * declared lines sum by `kind` into the two figures the computation has
 * always taken, so adding a component is a row rather than a change to how
 * tax is worked out.
 */

export type Component = {
  code: string;
  name: string;
  kind: ComponentKind;
  /** The company's own cap where it has one, else the statutory ceiling. */
  capPaise: number | null;
  requiresProof: boolean;
  isDerived: boolean;
  sortOrder: number;
};

/** The country a company keeps its books in, which is whose tax law applies. */
export async function countryOf(companyCode: string): Promise<string> {
  const r = await rawClient().execute({ sql: "SELECT country FROM om_company WHERE code = ?", args: [companyCode] });
  const country = r.rows[0]?.country;
  return typeof country === "string" && country.trim() ? country.trim() : "India";
}

/** Whose law applies when nothing says otherwise. */
export const DEFAULT_COUNTRY = "India";

/**
 * What this company offers, in the order HR set. A company with no row for
 * a component offers it as the country defines it — absence is the default,
 * not exclusion, so a new statutory component reaches everyone at once.
 *
 * Without a company — an employee whose org assignment has not been written
 * yet — the country's own catalogue stands, unnarrowed. A declaration is
 * never silently worth nothing because a record is missing elsewhere.
 */
export async function componentsFor(companyCode: string | null): Promise<Component[]> {
  const country = companyCode ? await countryOf(companyCode) : DEFAULT_COUNTRY;
  const [all, chosen] = await Promise.all([
    db
      .select()
      .from(txComponent)
      .where(and(eq(txComponent.country, country), eq(txComponent.isActive, true)))
      .orderBy(asc(txComponent.sortOrder), asc(txComponent.code)),
    companyCode
      ? db.select().from(txCompanyComponent).where(eq(txCompanyComponent.companyCode, companyCode))
      : Promise.resolve([]),
  ]);
  const byCode = new Map(chosen.map((c) => [c.componentCode, c]));

  return all
    .filter((c) => byCode.get(c.code)?.isEnabled !== false)
    .map((c) => {
      const override = byCode.get(c.code)?.capOverridePaise ?? null;
      return {
        code: c.code,
        name: c.name,
        kind: c.kind as ComponentKind,
        // A company may be stricter than the law, never looser.
        capPaise: override === null ? c.capPaise : c.capPaise === null ? override : Math.min(override, c.capPaise),
        requiresProof: c.requiresProof,
        isDerived: c.isDerived,
        sortOrder: c.sortOrder,
      };
    });
}

/** The company an employee belonged to on a date, for whose catalogue applies. */
export async function companyOf(employeeId: number, asOf: string): Promise<string | null> {
  const r = await rawClient().execute({
    sql: `SELECT company_code FROM pa_it0001_org_assignment
          WHERE employee_id = ? AND valid_from <= ? AND valid_to >= ?
          ORDER BY valid_from DESC LIMIT 1`,
    args: [employeeId, asOf, asOf],
  });
  const code = r.rows[0]?.company_code;
  return typeof code === "string" ? code : null;
}

export type DeclaredLine = { componentCode: string; declaredPaise: number };

/** What one declaration actually says, line by line. */
export async function linesFor(declarationId: number): Promise<DeclaredLine[]> {
  const rows = await db
    .select()
    .from(tdsDeclarationLine)
    .where(eq(tdsDeclarationLine.declarationId, declarationId));
  return rows.map((r) => ({ componentCode: r.componentCode, declaredPaise: r.declaredPaise }));
}

/**
 * The declared lines as the computation takes them: exemptions under
 * section 10, deductions under Chapter VI-A, and other income — each
 * capped per component first, because a cap belongs to its own line and
 * not to the total.
 */
export function rollUp(
  lines: DeclaredLine[],
  components: Component[],
): { section10ExemptPaise: number; chapterViaPaise: number; otherIncomePaise: number } {
  const byCode = new Map(components.map((c) => [c.code, c]));
  const total = { section10ExemptPaise: 0, chapterViaPaise: 0, otherIncomePaise: 0 };

  for (const line of lines) {
    const component = byCode.get(line.componentCode);
    if (!component) continue;
    const capped = component.capPaise === null ? line.declaredPaise : Math.min(line.declaredPaise, component.capPaise);
    const amount = Math.max(0, capped);
    if (component.kind === "section_10") total.section10ExemptPaise += amount;
    else if (component.kind === "chapter_via") total.chapterViaPaise += amount;
    else total.otherIncomePaise += amount;
  }
  return total;
}

/** Whether the city someone lives in is one the law treats as a metro. */
export async function isMetroCity(country: string, city: string | null): Promise<boolean> {
  if (!city?.trim()) return false;
  const [row] = await db
    .select()
    .from(txCityCategory)
    .where(and(eq(txCityCategory.country, country), eq(txCityCategory.city, city.trim().toUpperCase())));
  return row?.category === "METRO";
}

/**
 * The HRA exemption, worked out rather than typed: the least of the HRA
 * actually received, the rent paid over 10% of basic, and half or two
 * fifths of basic depending on the city. Returns zero when they pay no
 * rent or do not rent at all, which is what the law says.
 */
export async function hraExemptionFor(
  employeeId: number,
  financialYear: string,
  asOf: string,
): Promise<number> {
  const rent = await rawClient().execute({
    sql: "SELECT monthly_rent_paise, is_metro, accommodation_type FROM tds_rent WHERE employee_id = ? AND financial_year = ?",
    args: [employeeId, financialYear],
  });
  const row = rent.rows[0];
  if (!row) return 0;
  if (String(row.accommodation_type ?? "Rented") !== "Rented") return 0;

  const pay = await rawClient().execute({
    sql: `SELECT amount_paise FROM pa_it0008_basic_pay
          WHERE employee_id = ? AND valid_from <= ? AND valid_to >= ?
          ORDER BY valid_from DESC LIMIT 1`,
    args: [employeeId, asOf, asOf],
  });
  const monthlyBasic = Number(pay.rows[0]?.amount_paise ?? 0);
  if (monthlyBasic <= 0) return 0;

  // The HRA they actually receive, from the wage type that pays it.
  const hra = await rawClient().execute({
    sql: `SELECT amount_type, percent_basis_points, fixed_amount_paise
          FROM py_wage_type WHERE code = 'HRA' AND is_active = 1`,
    args: [],
  });
  const w = hra.rows[0];
  const monthlyHra = !w
    ? 0
    : String(w.amount_type) === "PercentOfBasic"
      ? Math.round((monthlyBasic * Number(w.percent_basis_points ?? 0)) / 10_000)
      : Number(w.fixed_amount_paise ?? 0);

  return hraExemption({
    actualHraPaise: monthlyHra * 12,
    rentPaise: Number(row.monthly_rent_paise ?? 0) * 12,
    basicPaise: monthlyBasic * 12,
    isMetro: Number(row.is_metro) === 1,
  });
}
