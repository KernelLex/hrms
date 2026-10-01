import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { tdsTaxSlab, pyTaxConstant, type TaxRegime } from "@/db/schema";

/**
 * Income tax computation.
 *
 * Slab based, from data rather than hardcoded numbers, so Form 16 Part B shows
 * a computation that actually adds up and a rate change is a row edit rather
 * than a code change. The standard deduction, the Section 87A rebate and the
 * cess rate are the same kind of data, read from py_tax_constant.
 *
 * Everything is INTEGER paise; rates are basis points (1200 = 12.00%).
 */

export type TaxConstants = {
  standardDeductionPaise: number;
  rebate87aLimitPaise: number;
  rebate87aMaxPaise: number;
  cessBasisPoints: number;
};

/** Used only where a financial year has no py_tax_constant row at all. */
const FALLBACK_CONSTANTS: Record<TaxRegime, TaxConstants> = {
  Old: { standardDeductionPaise: 5_000_000, rebate87aLimitPaise: 50_000_000, rebate87aMaxPaise: 1_250_000, cessBasisPoints: 400 },
  New: { standardDeductionPaise: 7_500_000, rebate87aLimitPaise: 120_000_000, rebate87aMaxPaise: 6_000_000, cessBasisPoints: 400 },
};

export async function constantsFor(regime: TaxRegime, financialYear: string): Promise<TaxConstants> {
  const row = await db.query.pyTaxConstant.findFirst({
    where: and(eq(pyTaxConstant.financialYear, financialYear), eq(pyTaxConstant.regime, regime)),
  });
  if (row) return row;
  // No row for this year: the latest one on record, so a new financial year
  // not yet seeded still computes rather than silently using zero.
  const latest = await db.query.pyTaxConstant.findFirst({
    where: eq(pyTaxConstant.regime, regime),
    orderBy: (t, { desc }) => desc(t.financialYear),
  });
  return latest ?? FALLBACK_CONSTANTS[regime];
}

/** Both regimes' constants for a year, for callers that compute many times over. */
export async function constantsForYear(financialYear: string): Promise<Record<TaxRegime, TaxConstants>> {
  const [Old, New] = await Promise.all([constantsFor("Old", financialYear), constantsFor("New", financialYear)]);
  return { Old, New };
}

export type TaxComputation = {
  grossSalaryPaise: number;
  section10ExemptPaise: number;
  standardDeductionPaise: number;
  chapterViaPaise: number;
  taxableIncomePaise: number;
  taxOnIncomePaise: number;
  rebate87aPaise: number;
  cessPaise: number;
  totalTaxPaise: number;
};

/** The financial year a date falls in: April to March. "2025-26". */
export function financialYearOf(date: string): string {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const start = month >= 4 ? year : year - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

/** The quarter of a financial year: Q1 is April to June. */
export function financialQuarterOf(date: string): number {
  const month = Number(date.slice(5, 7));
  return Math.floor(((month - 4 + 12) % 12) / 3) + 1;
}

export type Slab = { fromPaise: number; toPaise: number | null; rateBasisPoints: number };

export async function slabsFor(regime: TaxRegime, financialYear: string): Promise<Slab[]> {
  return db
    .select({
      fromPaise: tdsTaxSlab.fromPaise,
      toPaise: tdsTaxSlab.toPaise,
      rateBasisPoints: tdsTaxSlab.rateBasisPoints,
    })
    .from(tdsTaxSlab)
    .where(and(eq(tdsTaxSlab.regime, regime), eq(tdsTaxSlab.financialYear, financialYear)))
    .orderBy(asc(tdsTaxSlab.fromPaise));
}

/** Both regimes' slabs for a year, for callers that compute many times over. */
export async function slabsForYear(
  financialYear: string,
): Promise<Record<TaxRegime, Slab[]>> {
  const [Old, New] = await Promise.all([
    slabsFor("Old", financialYear),
    slabsFor("New", financialYear),
  ]);
  return { Old, New };
}

/** Tax on a taxable income, before rebate and cess. */
export async function taxOnIncome(
  taxableIncomePaise: number,
  regime: TaxRegime,
  financialYear: string,
): Promise<number> {
  return taxOnIncomeWith(taxableIncomePaise, await slabsFor(regime, financialYear));
}

function taxOnIncomeWith(taxableIncomePaise: number, slabs: Slab[]): number {
  if (taxableIncomePaise <= 0 || slabs.length === 0) return 0;

  let tax = 0;
  for (const slab of slabs) {
    const upper = slab.toPaise ?? Number.MAX_SAFE_INTEGER;
    if (taxableIncomePaise <= slab.fromPaise) break;
    const amountInSlab = Math.min(taxableIncomePaise, upper) - slab.fromPaise;
    if (amountInSlab > 0) {
      tax += Math.round((amountInSlab * slab.rateBasisPoints) / 10_000);
    }
  }
  return tax;
}

/**
 * The full annual computation, which both the monthly TDS estimate and Form 16
 * Part B are derived from — so the certificate reconciles with what was
 * actually deducted month by month.
 */
export type AnnualTaxInput = {
  grossSalaryPaise: number;
  regime: TaxRegime;
  financialYear: string;
  /** Section 10 exemptions, chiefly HRA. Ignored under the new regime. */
  section10ExemptPaise?: number;
  /** Chapter VI-A, chiefly 80C and 80D. Ignored under the new regime. */
  chapterViaPaise?: number;
  otherIncomePaise?: number;
};

export async function computeAnnualTax(opts: AnnualTaxInput): Promise<TaxComputation> {
  const [slabs, constants] = await Promise.all([
    slabsFor(opts.regime, opts.financialYear),
    constantsFor(opts.regime, opts.financialYear),
  ]);
  return computeAnnualTaxWith(opts, slabs, constants);
}

/**
 * The same computation against slabs and constants already loaded — payroll
 * computes tax several times per employee, and fetching them each time would
 * be a round trip per computation.
 */
export function computeAnnualTaxWith(opts: AnnualTaxInput, slabs: Slab[], constants: TaxConstants): TaxComputation {
  const { grossSalaryPaise, regime, otherIncomePaise = 0 } = opts;

  // The new regime gives a larger standard deduction and almost nothing else.
  const section10ExemptPaise = regime === "Old" ? (opts.section10ExemptPaise ?? 0) : 0;
  const chapterViaPaise = regime === "Old" ? (opts.chapterViaPaise ?? 0) : 0;
  const standardDeductionPaise = constants.standardDeductionPaise;

  const afterExemptions = Math.max(0, grossSalaryPaise - section10ExemptPaise);
  const afterStandard = Math.max(0, afterExemptions - standardDeductionPaise);
  const taxableIncomePaise = Math.max(
    0,
    afterStandard + otherIncomePaise - chapterViaPaise,
  );

  const gross = taxOnIncomeWith(taxableIncomePaise, slabs);

  // Section 87A. Under the new regime, income just over the limit also gets
  // marginal relief: the tax cannot exceed the income above the limit, or a
  // ₹1 raise past ₹12 lakh would cost ₹60,000 in tax.
  let rebate87aPaise = 0;
  if (taxableIncomePaise <= constants.rebate87aLimitPaise) {
    rebate87aPaise = Math.min(gross, constants.rebate87aMaxPaise);
  } else if (regime === "New") {
    const excess = taxableIncomePaise - constants.rebate87aLimitPaise;
    rebate87aPaise = Math.max(0, gross - excess);
  }

  const afterRebate = Math.max(0, gross - rebate87aPaise);
  const cessPaise = Math.round((afterRebate * constants.cessBasisPoints) / 10_000);

  return {
    grossSalaryPaise,
    section10ExemptPaise,
    standardDeductionPaise,
    chapterViaPaise,
    taxableIncomePaise,
    taxOnIncomePaise: gross,
    rebate87aPaise,
    cessPaise,
    totalTaxPaise: afterRebate + cessPaise,
  };
}

/**
 * Tax on a whole year's salary, for a declaration — the regime and the amounts
 * it claims. The payroll engine and Form 16 both go through this, so the
 * monthly deductions and the certificate cannot use different rules.
 */
export function annualTaxFor(
  grossSalaryPaise: number,
  declaration: {
    regime: TaxRegime;
    section10ExemptPaise: number;
    chapterViaPaise: number;
    otherIncomePaise: number;
  },
  financialYear: string,
  slabs: Record<TaxRegime, Slab[]>,
  constants: Record<TaxRegime, TaxConstants>,
): number {
  return computeAnnualTaxWith(
    { grossSalaryPaise, financialYear, ...declaration },
    slabs[declaration.regime],
    constants[declaration.regime],
  ).totalTaxPaise;
}
