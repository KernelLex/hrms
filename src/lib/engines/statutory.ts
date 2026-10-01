import "server-only";
import { and, lte, gte } from "drizzle-orm";
import { db } from "@/lib/db";
import { pyPfRate, pyEsiRate, pyProfessionalTaxSlab, pyLwfRate } from "@/db/schema";

/**
 * PF, ESI, professional tax and the labour welfare fund — each read from
 * dated rows rather than a formula in code, so a rate change is a row edit.
 * Every amount is INTEGER paise; rates are basis points.
 */

/* ------------------------------------------------------------------------ PF */

export type PfRate = {
  employeeRateBasisPoints: number;
  employerRateBasisPoints: number;
  epsRateBasisPoints: number;
  edliRateBasisPoints: number;
  adminChargeBasisPoints: number;
  wageCeilingPaise: number;
};

export async function pfRateFor(date: string): Promise<PfRate | null> {
  const r = await db.query.pyPfRate.findFirst({
    where: and(lte(pyPfRate.validFrom, date), gte(pyPfRate.validTo, date)),
    orderBy: (t, { desc }) => desc(t.validFrom),
  });
  return r ?? null;
}

/** PF wages, employee and employer PF, EPS, EDLI and the admin charge — all capped at the ceiling. */
export function pfContribution(basicPaise: number, rate: PfRate) {
  const pfWages = Math.min(basicPaise, rate.wageCeilingPaise);
  const employee = Math.round((pfWages * rate.employeeRateBasisPoints) / 10_000);
  const eps = Math.round((pfWages * rate.epsRateBasisPoints) / 10_000);
  const employerTotal = Math.round((pfWages * rate.employerRateBasisPoints) / 10_000);
  const epf = Math.max(0, employerTotal - eps);
  const edli = Math.round((pfWages * rate.edliRateBasisPoints) / 10_000);
  const adminCharge = Math.round((pfWages * rate.adminChargeBasisPoints) / 10_000);
  return { pfWages, employee, eps, epf, edli, adminCharge };
}

/* ----------------------------------------------------------------------- ESI */

export type EsiRate = { employeeRateBasisPoints: number; employerRateBasisPoints: number; wageCeilingPaise: number };

export async function esiRateFor(date: string): Promise<EsiRate | null> {
  const r = await db.query.pyEsiRate.findFirst({
    where: and(lte(pyEsiRate.validFrom, date), gte(pyEsiRate.validTo, date)),
    orderBy: (t, { desc }) => desc(t.validFrom),
  });
  return r ?? null;
}

/** April–September or October–March: the two ESI contribution periods, from a date within one. */
export function esiContributionPeriod(date: string): { from: string; to: string } {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  return month >= 4 && month <= 9
    ? { from: `${year}-04-01`, to: `${year}-09-30` }
    : month >= 10
      ? { from: `${year}-10-01`, to: `${year + 1}-03-31` }
      : { from: `${year - 1}-10-01`, to: `${year}-03-31` };
}

export function esiContribution(grossPaise: number, rate: EsiRate) {
  return {
    employee: Math.round((grossPaise * rate.employeeRateBasisPoints) / 10_000),
    employer: Math.round((grossPaise * rate.employerRateBasisPoints) / 10_000),
  };
}

/* --------------------------------------------------------- professional tax */

export type PtSlabRow = {
  state: string;
  validFrom: string;
  validTo: string;
  fromPaise: number;
  toPaise: number | null;
  amountPaise: number;
  isFebruary: boolean;
};

/** Every state's slabs, loaded once per payroll batch rather than once per employee. */
export async function loadPtSlabs(): Promise<PtSlabRow[]> {
  return db.select().from(pyProfessionalTaxSlab);
}

/** A February-specific row, where the state has one for the matching band, beats the general row. */
export function professionalTaxFromSlabs(slabs: PtSlabRow[], state: string, date: string, grossPaise: number): number {
  const isFebruary = Number(date.slice(5, 7)) === 2;
  const candidates = slabs.filter(
    (s) => s.state === state && s.validFrom <= date && s.validTo >= date && grossPaise >= s.fromPaise && (s.toPaise === null || grossPaise <= s.toPaise),
  );
  if (candidates.length === 0) return 0;
  const februaryRow = isFebruary ? candidates.find((s) => s.isFebruary) : undefined;
  return (februaryRow ?? candidates.find((s) => !s.isFebruary) ?? candidates[0]).amountPaise;
}

export async function professionalTaxFor(state: string, date: string, grossPaise: number): Promise<number> {
  return professionalTaxFromSlabs(await loadPtSlabs(), state, date, grossPaise);
}

/* ------------------------------------------------------------------------ LWF */

export type LwfDue = { employeeAmountPaise: number; employerAmountPaise: number };

export type LwfRateRow = {
  state: string;
  validFrom: string;
  validTo: string;
  dueMonth: number;
  employeeAmountPaise: number;
  employerAmountPaise: number;
};

/** Every state's rates, loaded once per payroll batch rather than once per employee. */
export async function loadLwfRates(): Promise<LwfRateRow[]> {
  return db.select().from(pyLwfRate);
}

/** Non-null only in the month a cycle actually falls due; every other month, nothing is owed. */
export function lwfDueFromRates(rates: LwfRateRow[], state: string, date: string): LwfDue | null {
  const month = Number(date.slice(5, 7));
  const r = rates.find((r) => r.state === state && r.dueMonth === month && r.validFrom <= date && r.validTo >= date);
  return r ? { employeeAmountPaise: r.employeeAmountPaise, employerAmountPaise: r.employerAmountPaise } : null;
}

export async function lwfDueFor(state: string, date: string): Promise<LwfDue | null> {
  return lwfDueFromRates(await loadLwfRates(), state, date);
}

// Income-tax constants (standard deduction, the Section 87A rebate, cess)
// live in engines/tax.ts, alongside the slab lookups they compute against.

/* ------------------------------------------------------------------------ ECR */

/**
 * EPFO's Electronic Challan cum Return: one text line per member, eleven
 * "#~#"-delimited fields, amounts in whole rupees. Field order:
 *
 *   UAN, member name, gross wages, EPF wages, EPS wages, EDLI wages,
 *   EPF contribution (employee share), EPS contribution, EPF contribution
 *   (employer share), NCP days, refund of advances.
 *
 * A best-effort implementation of the published format; validating an actual
 * file against EPFO's own portal is out of scope until phase 25.
 */
export type EcrRow = {
  uan: string;
  memberName: string;
  grossWagesPaise: number;
  pfWagesPaise: number;
  epsWagesPaise: number;
  edliWagesPaise: number;
  employeePfPaise: number;
  epsPaise: number;
  employerPfPaise: number;
  ncpDays: number;
  refundOfAdvancesPaise: number;
};

const ecrRupees = (paise: number) => String(Math.round(paise / 100));

export function generateEcrText(rows: EcrRow[]): string {
  return rows
    .map((r) =>
      [
        r.uan,
        r.memberName,
        ecrRupees(r.grossWagesPaise),
        ecrRupees(r.pfWagesPaise),
        ecrRupees(r.epsWagesPaise),
        ecrRupees(r.edliWagesPaise),
        ecrRupees(r.employeePfPaise),
        ecrRupees(r.epsPaise),
        ecrRupees(r.employerPfPaise),
        String(r.ncpDays),
        ecrRupees(r.refundOfAdvancesPaise),
      ].join("#~#"),
    )
    .join("\r\n");
}
