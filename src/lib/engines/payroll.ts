import "server-only";
import type { InStatement } from "@libsql/client";
import { rawClient } from "@/lib/db";
import { now, type RunType, type TaxRegime } from "@/db/schema";
import { annualTaxFor, financialYearOf, slabsForYear, constantsForYear, type Slab, type TaxConstants } from "./tax";
import {
  pfRateFor,
  esiRateFor,
  loadPtSlabs,
  loadLwfRates,
  pfContribution,
  esiContribution,
  esiContributionPeriod,
  professionalTaxFromSlabs,
  lwfDueFromRates,
  type PfRate,
  type EsiRate,
  type PtSlabRow,
  type LwfRateRow,
} from "./statutory";

/**
 * The payroll engine: gross to net.
 *
 * Order matters, because each step feeds the next:
 *
 *   basic pay for the days employed and paid in the period
 *     -> percentage allowances on that prorated basic
 *     -> recurring and one-off payments
 *     -> arrears for earlier periods whose inputs have since changed
 *     -> PF and TDS
 *     -> net
 *
 * Every amount is INTEGER paise and each division rounds once, where it
 * happens, so the lines always sum exactly to the totals.
 *
 * Proration is by working days, the same measure leave is charged in. Basic
 * pay is prorated slice by slice, so a raise effective on the 16th pays the
 * old rate for the first half of the month and the new rate for the second,
 * and a joiner or leaver is paid for the days they were actually employed.
 *
 * A run is calculated in batches (see startRun and processRunBatch). Each
 * employee costs two round trips to the database — one batch of reads, one
 * atomic batch of writes — however much history retro and TDS have to consult.
 *
 * An employee who cannot be paid is recorded as an error rather than skipped:
 * a run that quietly pays fewer people than expected is worse than one that
 * says which people it could not pay.
 */

export type PayrollLine = {
  wageTypeCode: string;
  wageTypeName: string;
  kind: "Earning" | "Deduction" | "EmployerContribution";
  amountPaise: number;
  sortOrder: number;
  /** Set on arrears: the earlier period this line corrects. */
  forPeriodId?: number | null;
};

export type EmployeeResult = {
  employeeId: number;
  grossPaise: number;
  deductionsPaise: number;
  netPaise: number;
  unpaidDays: number;
  workingDays: number;
  employedDays: number;
  status: "Calculated" | "Error";
  errorMessage?: string;
  lines: PayrollLine[];
  /** One-off payments this result pays, so they are paid exactly once. */
  paidAdditionalIds: number[];
};

/** Employees calculated per request. Small enough for any serverless limit. */
export const BATCH_SIZE = 20;

/* ------------------------------------------------------------- calendar */

export function periodStart(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

export function periodEnd(year: number, month: number): string {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
}

const ym = (year: number, month: number) => year * 100 + month;

function eachDate(from: string, to: string): string[] {
  const out: string[] = [];
  const cursor = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (cursor <= end) {
    out.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

function workingDates(from: string, to: string, holidays: Set<string>): string[] {
  if (to < from) return [];
  return eachDate(from, to).filter((d) => {
    const day = new Date(`${d}T00:00:00Z`).getUTCDay();
    return day !== 0 && day !== 6 && !holidays.has(d);
  });
}

/** The twelve months of a financial year, April first. */
function monthsOfYear(financialYear: string): { year: number; month: number }[] {
  const start = Number(financialYear.slice(0, 4));
  return Array.from({ length: 12 }, (_, i) => {
    const month = ((3 + i) % 12) + 1;
    return { year: month >= 4 ? start : start + 1, month };
  });
}

function yearBounds(financialYear: string) {
  const start = Number(financialYear.slice(0, 4));
  return {
    from: `${start}-04-01`,
    to: `${start + 1}-03-31`,
    fromYm: ym(start, 4),
    toYm: ym(start + 1, 3),
  };
}

/* ---------------------------------------------------------------- facts */

type WageType = {
  code: string;
  name: string;
  kind: "Earning" | "Deduction" | "EmployerContribution";
  amountType: string;
  percentBasisPoints: number | null;
  formulaKey: string | null;
  isTaxable: boolean;
  isAutomatic: boolean;
  sortOrder: number;
};

/** What is loaded once per batch and shared by every employee in it. */
type Context = {
  financialYear: string;
  /** Every calendar's holidays for the year, keyed by calendar code — an
   * employee's own calendar decides which set applies to them. */
  holidaysByCalendar: Map<string, Set<string>>;
  wageTypes: Map<string, WageType>;
  slabs: Record<TaxRegime, Slab[]>;
  constants: Record<TaxRegime, TaxConstants>;
  pfRate: PfRate;
  esiRate: EsiRate;
  ptSlabs: PtSlabRow[];
  lwfRates: LwfRateRow[];
};

/** Used only where the database somehow has no rate row at all. */
const FALLBACK_PF_RATE: PfRate = {
  employeeRateBasisPoints: 1200,
  employerRateBasisPoints: 1200,
  epsRateBasisPoints: 833,
  edliRateBasisPoints: 50,
  adminChargeBasisPoints: 50,
  wageCeilingPaise: 1_500_000,
};
const FALLBACK_ESI_RATE: EsiRate = { employeeRateBasisPoints: 75, employerRateBasisPoints: 325, wageCeilingPaise: 2_100_000 };

const DEFAULT_CALENDAR = "NATIONAL";
const holidaysFor = (ctx: Context, calendarCode: string): Set<string> => ctx.holidaysByCalendar.get(calendarCode) ?? new Set();

type Dated = { valid_from: string; valid_to: string; created_at: string };

/** Everything about one employee the year's calculation can need. */
type Facts = {
  hireDate: string;
  terminationDate: string | null;
  /** Which holidays are theirs, from their personnel area. */
  calendarCode: string;
  basic: (Dated & { amount_paise: number })[];
  bank: Dated[];
  recurring: {
    code: string;
    amount_paise: number;
    start_date: string;
    end_date: string;
    created_at: string;
  }[];
  unpaidAbsences: { start_date: string; end_date: string; is_half_day: number; created_at: string }[];
  changedAbsences: { start_date: string; end_date: string; created_at: string }[];
  oneOffs: {
    id: number;
    code: string;
    amount_paise: number;
    payment_date: string;
    paid_run_id: number | null;
  }[];
  declaration: {
    regime: TaxRegime;
    section10ExemptPaise: number;
    chapterViaPaise: number;
    otherIncomePaise: number;
  };
  history: {
    result_id: number;
    run_id: number;
    run_type: RunType;
    run_at: string;
    period_id: number;
    year: number;
    month: number;
    period_status: string;
  }[];
  historyLines: {
    result_id: number;
    wage_type_code: string;
    kind: string;
    amount_paise: number;
    for_period_id: number | null;
  }[];
  /** What an imported employee earned and paid before this system held their history. */
  openingBalance: { asOfYm: number; grossPaidPaise: number; tdsDeductedPaise: number } | null;
  statutoryDetails: { professionalTaxState: string | null } | null;
};

async function loadContext(financialYear: string): Promise<Context> {
  const { from, to } = yearBounds(financialYear);
  const client = rawClient();
  const [holidays, wageTypes] = await client.batch(
    [
      { sql: "SELECT date, calendar_code FROM pt_holiday WHERE date BETWEEN ? AND ?", args: [from, to] },
      {
        sql: `SELECT code, name, kind, amount_type, percent_basis_points, formula_key,
                     is_taxable, is_automatic, sort_order
              FROM py_wage_type WHERE is_active = 1 ORDER BY sort_order`,
        args: [],
      },
    ],
    "read",
  );
  const holidaysByCalendar = new Map<string, Set<string>>();
  for (const h of holidays.rows) {
    const code = String(h.calendar_code);
    if (!holidaysByCalendar.has(code)) holidaysByCalendar.set(code, new Set());
    holidaysByCalendar.get(code)!.add(String(h.date));
  }
  const [slabs, constants, pfRate, esiRate, ptSlabs, lwfRates] = await Promise.all([
    slabsForYear(financialYear),
    constantsForYear(financialYear),
    pfRateFor(to),
    esiRateFor(to),
    loadPtSlabs(),
    loadLwfRates(),
  ]);
  return {
    financialYear,
    holidaysByCalendar,
    wageTypes: new Map(
      wageTypes.rows.map((r) => [
        String(r.code),
        {
          code: String(r.code),
          name: String(r.name),
          kind: String(r.kind) as "Earning" | "Deduction" | "EmployerContribution",
          amountType: String(r.amount_type),
          percentBasisPoints: r.percent_basis_points === null ? null : Number(r.percent_basis_points),
          formulaKey: r.formula_key === null ? null : String(r.formula_key),
          isTaxable: Number(r.is_taxable) === 1,
          isAutomatic: Number(r.is_automatic) === 1,
          sortOrder: Number(r.sort_order),
        },
      ]),
    ),
    slabs,
    constants,
    pfRate: pfRate ?? FALLBACK_PF_RATE,
    esiRate: esiRate ?? FALLBACK_ESI_RATE,
    ptSlabs,
    lwfRates,
  };
}

async function loadFacts(
  employeeId: number,
  financialYear: string,
  excludeRunId: number,
): Promise<Facts | null> {
  const { from, to, fromYm, toYm } = yearBounds(financialYear);
  const e = employeeId;
  const rs = await rawClient().batch(
    [
      { sql: "SELECT hire_date, termination_date FROM pa_employee WHERE id = ?", args: [e] },
      {
        sql: `SELECT valid_from, valid_to, amount_paise, created_at FROM pa_it0008_basic_pay
              WHERE employee_id = ? AND valid_to >= ? AND valid_from <= ? ORDER BY valid_from`,
        args: [e, from, to],
      },
      {
        sql: `SELECT valid_from, valid_to, created_at FROM pa_it0009_bank_details
              WHERE employee_id = ? AND valid_to >= ? AND valid_from <= ?`,
        args: [e, from, to],
      },
      {
        sql: `SELECT wage_type_code AS code, amount_paise, start_date, end_date, created_at
              FROM py_it0014_recurring_payment
              WHERE employee_id = ? AND end_date >= ? AND start_date <= ?`,
        args: [e, from, to],
      },
      {
        sql: `SELECT a.start_date, a.end_date, a.is_half_day, a.created_at, t.is_paid
              FROM pt_it2001_absence a JOIN pt_absence_type t ON t.code = a.absence_type_code
              WHERE a.employee_id = ? AND a.end_date >= ? AND a.start_date <= ?`,
        args: [e, from, to],
      },
      {
        sql: `SELECT id, wage_type_code AS code, amount_paise, payment_date, paid_run_id
              FROM py_it0015_additional_payment
              WHERE employee_id = ? AND payment_date BETWEEN ? AND ?`,
        args: [e, from, to],
      },
      {
        sql: `SELECT regime, section_80c_paise, section_80d_paise, hra_exemption_paise,
                     other_income_paise
              FROM tds_employee_declaration WHERE employee_id = ? AND financial_year = ?`,
        args: [e, financialYear],
      },
      {
        sql: `SELECT r.id AS result_id, r.run_id, run.run_type, run.run_at,
                     p.id AS period_id, p.year, p.month, p.status AS period_status
              FROM py_payroll_result r
              JOIN py_payroll_run run ON run.id = r.run_id AND run.status = 'Completed'
              JOIN py_payroll_period p ON p.id = run.period_id
              WHERE r.employee_id = ? AND r.status = 'Calculated' AND r.run_id != ?
                AND p.year * 100 + p.month BETWEEN ? AND ?`,
        args: [e, excludeRunId, fromYm, toYm],
      },
      {
        sql: `SELECT l.result_id, l.wage_type_code, l.kind, l.amount_paise, l.for_period_id
              FROM py_payroll_result_line l
              JOIN py_payroll_result r ON r.id = l.result_id
              JOIN py_payroll_run run ON run.id = r.run_id AND run.status = 'Completed'
              JOIN py_payroll_period p ON p.id = run.period_id
              WHERE r.employee_id = ? AND r.status = 'Calculated' AND r.run_id != ?
                AND p.year * 100 + p.month BETWEEN ? AND ?`,
        args: [e, excludeRunId, fromYm, toYm],
      },
      {
        sql: `SELECT as_of_ym, gross_paid_paise, tds_deducted_paise FROM py_opening_balance
              WHERE employee_id = ? AND financial_year = ?`,
        args: [e, financialYear],
      },
      {
        sql: `SELECT a.calendar_code FROM pa_it0001_org_assignment o
              JOIN om_personnel_area a ON a.code = o.area_code
              WHERE o.employee_id = ? AND o.valid_from <= ? AND o.valid_to >= ?
              ORDER BY o.valid_from DESC LIMIT 1`,
        args: [e, to, to],
      },
      {
        sql: `SELECT professional_tax_state FROM pa_it0011_statutory_details
              WHERE employee_id = ? AND valid_from <= ? AND valid_to >= ?
              ORDER BY valid_from DESC LIMIT 1`,
        args: [e, to, to],
      },
    ],
    "read",
  );

  const [emp, basic, bank, recurring, absences, oneOffs, declaration, history, lines, openingBalance, calendar, statutoryDetails] = rs;
  if (emp.rows.length === 0) return null;
  const d = declaration.rows[0];
  const rows = <T>(r: (typeof rs)[number]) => r.rows as unknown as T[];

  const allAbsences = rows<{
    start_date: string;
    end_date: string;
    is_half_day: number;
    created_at: string;
    is_paid: number;
  }>(absences);

  return {
    hireDate: String(emp.rows[0].hire_date),
    terminationDate: emp.rows[0].termination_date ? String(emp.rows[0].termination_date) : null,
    calendarCode: calendar.rows[0] ? String(calendar.rows[0].calendar_code) : DEFAULT_CALENDAR,
    basic: rows<Facts["basic"][number]>(basic).map((b) => ({ ...b, amount_paise: Number(b.amount_paise) })),
    bank: rows(bank),
    recurring: rows<Facts["recurring"][number]>(recurring).map((r) => ({
      ...r,
      amount_paise: Number(r.amount_paise),
    })),
    unpaidAbsences: allAbsences.filter((a) => Number(a.is_paid) !== 1),
    changedAbsences: allAbsences,
    oneOffs: rows<Facts["oneOffs"][number]>(oneOffs).map((o) => ({
      ...o,
      id: Number(o.id),
      amount_paise: Number(o.amount_paise),
      paid_run_id: o.paid_run_id === null ? null : Number(o.paid_run_id),
    })),
    declaration: {
      regime: ((d?.regime as TaxRegime | undefined) ?? "New") as TaxRegime,
      section10ExemptPaise: Number(d?.hra_exemption_paise ?? 0),
      chapterViaPaise: Number(d?.section_80c_paise ?? 0) + Number(d?.section_80d_paise ?? 0),
      otherIncomePaise: Number(d?.other_income_paise ?? 0),
    },
    history: rows<Facts["history"][number]>(history).map((h) => ({
      ...h,
      result_id: Number(h.result_id),
      run_id: Number(h.run_id),
      period_id: Number(h.period_id),
      year: Number(h.year),
      month: Number(h.month),
    })),
    historyLines: rows<Facts["historyLines"][number]>(lines).map((l) => ({
      ...l,
      result_id: Number(l.result_id),
      amount_paise: Number(l.amount_paise),
      for_period_id: l.for_period_id === null ? null : Number(l.for_period_id),
    })),
    openingBalance: openingBalance.rows[0]
      ? {
          asOfYm: Number(openingBalance.rows[0].as_of_ym),
          grossPaidPaise: Number(openingBalance.rows[0].gross_paid_paise),
          tdsDeductedPaise: Number(openingBalance.rows[0].tds_deducted_paise),
        }
      : null,
    statutoryDetails: statutoryDetails.rows[0]
      ? { professionalTaxState: statutoryDetails.rows[0].professional_tax_state === null ? null : String(statutoryDetails.rows[0].professional_tax_state) }
      : null,
  };
}

/* ------------------------------------------------- the regular month */

type RegularPart = {
  lines: PayrollLine[];
  basicPaise: number;
  workingDays: number;
  employedDays: number;
  unpaidDays: number;
  /** A full month's taxable pay at the current rates, for projecting the year. */
  fullMonthTaxablePaise: number;
};

function overlaps(aFrom: string, aTo: string, bFrom: string, bTo: string): boolean {
  return aFrom <= bTo && aTo >= bFrom;
}

/** Employed at all during a month. */
function employedIn(f: Facts, year: number, month: number): boolean {
  return (
    f.hireDate <= periodEnd(year, month) &&
    (f.terminationDate === null || f.terminationDate >= periodStart(year, month))
  );
}

/**
 * Basic, allowances and recurring payments for one month, from the facts as
 * they stand now. Used for the current month, and again for earlier months
 * when retro calculation asks what they should have paid.
 */
function regularPart(
  f: Facts,
  year: number,
  month: number,
  ctx: Context,
): RegularPart | { error: string } | { notEmployed: true } {
  const from = periodStart(year, month);
  const to = periodEnd(year, month);
  const windowFrom = f.hireDate > from ? f.hireDate : from;
  const windowTo = f.terminationDate && f.terminationDate < to ? f.terminationDate : to;
  if (windowTo < windowFrom) return { notEmployed: true };

  const periodDates = workingDates(from, to, holidaysFor(ctx, f.calendarCode));
  const W = periodDates.length;
  if (W === 0) return { error: "The period has no working days." };
  const employed = periodDates.filter((d) => d >= windowFrom && d <= windowTo);

  // Unpaid share of each employed working day: 1 for a full day, 0.5 for a half.
  const unpaid = new Map<string, number>();
  for (const a of f.unpaidAbsences) {
    if (!overlaps(a.start_date, a.end_date, windowFrom, windowTo)) continue;
    if (Number(a.is_half_day) === 1) {
      if (employed.includes(a.start_date)) {
        unpaid.set(a.start_date, Math.min(1, (unpaid.get(a.start_date) ?? 0) + 0.5));
      }
      continue;
    }
    for (const d of employed) {
      if (d >= a.start_date && d <= a.end_date) unpaid.set(d, 1);
    }
  }
  const paidIn = (validFrom: string, validTo: string) =>
    employed
      .filter((d) => d >= validFrom && d <= validTo)
      .reduce((s, d) => s + 1 - (unpaid.get(d) ?? 0), 0);
  const unpaidDays = [...unpaid.values()].reduce((s, v) => s + v, 0);

  const slices = f.basic.filter((b) => overlaps(b.valid_from, b.valid_to, windowFrom, windowTo));
  if (slices.length === 0) {
    return { error: "No basic pay is valid for this period (IT0008)." };
  }

  // Each slice pays its own rate for its own days.
  let basic = 0;
  for (const s of slices) {
    basic += Math.round((s.amount_paise * paidIn(s.valid_from, s.valid_to)) / W);
  }

  const lines: PayrollLine[] = [];
  const wt = (code: string) => ctx.wageTypes.get(code);
  lines.push({
    wageTypeCode: "BASIC",
    wageTypeName: wt("BASIC")?.name ?? "Basic salary",
    kind: "Earning",
    amountPaise: basic,
    sortOrder: wt("BASIC")?.sortOrder ?? 10,
  });
  if (unpaidDays > 0) {
    lines.push({
      wageTypeCode: "UNPAID",
      wageTypeName: `Unpaid absence (${unpaidDays} of ${W} days)`,
      kind: "Deduction",
      amountPaise: 0, // already reflected in the prorated basic
      sortOrder: 15,
    });
  }

  // Percentage allowances, on the prorated basic.
  const percentTypes = [...ctx.wageTypes.values()].filter(
    (w) =>
      w.isAutomatic && w.kind === "Earning" && w.amountType === "PercentOfBasic" && w.percentBasisPoints,
  );
  for (const w of percentTypes) {
    const amount = Math.round((basic * w.percentBasisPoints!) / 10_000);
    if (amount === 0) continue;
    lines.push({ wageTypeCode: w.code, wageTypeName: w.name, kind: "Earning", amountPaise: amount, sortOrder: w.sortOrder });
  }

  // Recurring earnings follow the days paid; recurring deductions do not.
  for (const r of f.recurring) {
    if (!overlaps(r.start_date, r.end_date, windowFrom, windowTo)) continue;
    const type = wt(r.code);
    if (!type) continue;
    const amount =
      type.kind === "Earning"
        ? Math.round((r.amount_paise * paidIn(r.start_date, r.end_date)) / W)
        : r.amount_paise;
    if (amount === 0) continue;
    lines.push({ wageTypeCode: r.code, wageTypeName: type.name, kind: type.kind, amountPaise: amount, sortOrder: type.sortOrder });
  }

  // A full month at the rates in force at the end of the window.
  const rateSlice = [...slices].reverse().find((s) => s.valid_from <= windowTo) ?? slices[slices.length - 1];
  const fullBasic = rateSlice.amount_paise;
  let fullMonthTaxable = wt("BASIC")?.isTaxable === false ? 0 : fullBasic;
  for (const w of percentTypes) {
    if (w.isTaxable) fullMonthTaxable += Math.round((fullBasic * w.percentBasisPoints!) / 10_000);
  }
  for (const r of f.recurring) {
    const type = wt(r.code);
    if (type?.kind === "Earning" && type.isTaxable && r.start_date <= windowTo && r.end_date >= windowTo) {
      fullMonthTaxable += r.amount_paise;
    }
  }

  return {
    lines,
    basicPaise: basic,
    workingDays: W,
    employedDays: employed.length,
    unpaidDays,
    fullMonthTaxablePaise: fullMonthTaxable,
  };
}

function providentFund(basicPaise: number, ctx: Context): PayrollLine | null {
  const pfType = [...ctx.wageTypes.values()].find((w) => w.formulaKey === "PF");
  if (!pfType) return null;
  const { employee } = pfContribution(basicPaise, ctx.pfRate);
  return {
    wageTypeCode: pfType.code,
    wageTypeName: pfType.name,
    kind: "Deduction",
    amountPaise: employee,
    sortOrder: pfType.sortOrder,
  };
}

/** Employer PF, EPS, EDLI and the admin charge — company cost, never subtracted from net pay. */
function employerPfLines(basicPaise: number, ctx: Context): PayrollLine[] {
  const c = pfContribution(basicPaise, ctx.pfRate);
  const byFormula = (key: string) => [...ctx.wageTypes.values()].find((w) => w.formulaKey === key);
  const lines: PayrollLine[] = [];
  const push = (formulaKey: string, amountPaise: number) => {
    const wt = byFormula(formulaKey);
    if (wt && amountPaise > 0) lines.push({ wageTypeCode: wt.code, wageTypeName: wt.name, kind: "EmployerContribution", amountPaise, sortOrder: wt.sortOrder });
  };
  push("EPF_ER", c.epf);
  push("EPS_ER", c.eps);
  push("EDLI_ER", c.edli);
  push("PF_ADMIN", c.adminCharge);
  return lines;
}

/**
 * Once enrolled, ESI continues for the rest of the six-month contribution
 * period even if a raise since has pushed gross over the ceiling — the law
 * locks eligibility in at the period's start, not month by month.
 */
function hadEsiEarlierInPeriod(f: Facts, year: number, month: number, esiCode: string): boolean {
  const { from } = esiContributionPeriod(periodEnd(year, month));
  const fromYm = ym(Number(from.slice(0, 4)), Number(from.slice(5, 7)));
  const current = ym(year, month);
  const periodResultIds = new Set(
    f.history.filter((h) => h.run_type === "Regular" && ym(h.year, h.month) >= fromYm && ym(h.year, h.month) < current).map((h) => h.result_id),
  );
  return f.historyLines.some((l) => periodResultIds.has(l.result_id) && l.wage_type_code === esiCode && l.for_period_id === null && l.amount_paise > 0);
}

/** Employee and employer ESI, only where the month's wages are within the ceiling or the period already locked them in. */
function esiLines(esiWagesPaise: number, eligible: boolean, ctx: Context): PayrollLine[] {
  if (!eligible) return [];
  const c = esiContribution(esiWagesPaise, ctx.esiRate);
  const lines: PayrollLine[] = [];
  const emp = [...ctx.wageTypes.values()].find((w) => w.formulaKey === "ESI");
  if (emp && c.employee > 0) lines.push({ wageTypeCode: emp.code, wageTypeName: emp.name, kind: "Deduction", amountPaise: c.employee, sortOrder: emp.sortOrder });
  const er = [...ctx.wageTypes.values()].find((w) => w.formulaKey === "ESI_ER");
  if (er && c.employer > 0) lines.push({ wageTypeCode: er.code, wageTypeName: er.name, kind: "EmployerContribution", amountPaise: c.employer, sortOrder: er.sortOrder });
  return lines;
}

function professionalTaxLine(state: string | null, date: string, grossPaise: number, ctx: Context): PayrollLine | null {
  if (!state) return null;
  const wt = [...ctx.wageTypes.values()].find((w) => w.formulaKey === "PT");
  if (!wt) return null;
  const amount = professionalTaxFromSlabs(ctx.ptSlabs, state, date, grossPaise);
  if (amount <= 0) return null;
  return { wageTypeCode: wt.code, wageTypeName: wt.name, kind: "Deduction", amountPaise: amount, sortOrder: wt.sortOrder };
}

/** Labour welfare fund, employee and employer sides, only in a due month. */
function lwfLines(state: string | null, date: string, ctx: Context): PayrollLine[] {
  if (!state) return [];
  const due = lwfDueFromRates(ctx.lwfRates, state, date);
  if (!due) return [];
  const lines: PayrollLine[] = [];
  const emp = [...ctx.wageTypes.values()].find((w) => w.formulaKey === "LWF");
  if (emp && due.employeeAmountPaise > 0) lines.push({ wageTypeCode: emp.code, wageTypeName: emp.name, kind: "Deduction", amountPaise: due.employeeAmountPaise, sortOrder: emp.sortOrder });
  const er = [...ctx.wageTypes.values()].find((w) => w.formulaKey === "LWF_ER");
  if (er && due.employerAmountPaise > 0) lines.push({ wageTypeCode: er.code, wageTypeName: er.name, kind: "EmployerContribution", amountPaise: due.employerAmountPaise, sortOrder: er.sortOrder });
  return lines;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/* ----------------------------------------------------- CTC breakdown */

export type CtcBreakdownLine = { wageTypeCode: string; wageTypeName: string; amountPaise: number };
export type CtcBreakdown = {
  monthlyCtcPaise: number;
  lines: CtcBreakdownLine[];
  grossPaise: number;
  employerPfPaise: number;
  employerEsiPaise: number;
};

type StructureComponent = {
  wageTypeCode: string;
  wageTypeName: string;
  componentType: "PercentOfCTC" | "PercentOfBasic" | "Fixed" | "Balancing";
  percentBasisPoints: number | null;
  fixedAmountPaise: number | null;
};

/**
 * A CTC broken into its monthly components: basic from the structure, the
 * automatic wage-type allowances basic drives (HRA, conveyance), employer PF
 * on top, and whatever is left balancing to the CTC.
 *
 * ESI eligibility depends on gross, which depends on the balancing line,
 * which depends on ESI — solved with two passes: the first assumes no ESI,
 * and if the gross it produces is still within the ceiling, a second pass
 * includes the employer's ESI share too.
 */
export function computeCtcBreakdown(opts: {
  annualCtcPaise: number;
  components: StructureComponent[];
  automaticPercentOfBasic: { code: string; name: string; percentBasisPoints: number }[];
  pfRate: PfRate;
  esiRate: EsiRate;
}): CtcBreakdown {
  const { components, automaticPercentOfBasic, pfRate, esiRate } = opts;
  const monthlyCtcPaise = Math.round(opts.annualCtcPaise / 12);
  const nonBalancing = components.filter((c) => c.componentType !== "Balancing");
  const balancing = components.find((c) => c.componentType === "Balancing");

  const baseLines = (): { lines: CtcBreakdownLine[]; basic: number } => {
    const lines: CtcBreakdownLine[] = [];
    let basic = 0;
    for (const c of nonBalancing) {
      if (c.componentType === "PercentOfBasic") continue; // resolved once basic is known, below
      const amount = c.componentType === "PercentOfCTC" ? Math.round((monthlyCtcPaise * (c.percentBasisPoints ?? 0)) / 10_000) : (c.fixedAmountPaise ?? 0);
      lines.push({ wageTypeCode: c.wageTypeCode, wageTypeName: c.wageTypeName, amountPaise: amount });
      if (c.wageTypeCode === "BASIC") basic = amount;
    }
    for (const c of nonBalancing) {
      if (c.componentType !== "PercentOfBasic") continue;
      lines.push({ wageTypeCode: c.wageTypeCode, wageTypeName: c.wageTypeName, amountPaise: Math.round((basic * (c.percentBasisPoints ?? 0)) / 10_000) });
    }
    for (const w of automaticPercentOfBasic) {
      if (lines.some((l) => l.wageTypeCode === w.code)) continue; // the structure already names it explicitly
      lines.push({ wageTypeCode: w.code, wageTypeName: w.name, amountPaise: Math.round((basic * w.percentBasisPoints) / 10_000) });
    }
    return { lines, basic };
  };

  const pass = (esiEligible: boolean) => {
    const { lines, basic } = baseLines();
    const pf = pfContribution(basic, pfRate);
    const employerPfPaise = pf.epf + pf.eps + pf.edli + pf.adminCharge;
    const grossBeforeBalancing = lines.reduce((s, l) => s + l.amountPaise, 0);
    const employerEsiPaise = esiEligible ? esiContribution(grossBeforeBalancing, esiRate).employer : 0;
    if (balancing) {
      const amount = Math.max(0, monthlyCtcPaise - grossBeforeBalancing - employerPfPaise - employerEsiPaise);
      lines.push({ wageTypeCode: balancing.wageTypeCode, wageTypeName: balancing.wageTypeName, amountPaise: amount });
    }
    const grossPaise = lines.reduce((s, l) => s + l.amountPaise, 0);
    return { lines, grossPaise, employerPfPaise, employerEsiPaise };
  };

  const first = pass(false);
  const result = first.grossPaise <= esiRate.wageCeilingPaise ? pass(true) : first;
  return { monthlyCtcPaise, ...result };
}

/** The same breakdown, loading the structure and today's rates from the database — for a preview screen. */
export async function previewCtc(structureCode: string, annualCtcPaise: number, asOfDate: string): Promise<CtcBreakdown> {
  const client = rawClient();
  const [componentsRes, wageTypesRes, pfRate, esiRate] = await Promise.all([
    client.execute({
      sql: `SELECT sc.wage_type_code, wt.name AS wage_type_name, sc.component_type, sc.percent_basis_points, sc.fixed_amount_paise
            FROM py_salary_structure_component sc JOIN py_wage_type wt ON wt.code = sc.wage_type_code
            WHERE sc.structure_code = ? ORDER BY sc.sort_order`,
      args: [structureCode],
    }),
    client.execute({
      sql: `SELECT code, name, percent_basis_points FROM py_wage_type
            WHERE is_active = 1 AND is_automatic = 1 AND kind = 'Earning' AND amount_type = 'PercentOfBasic'`,
      args: [],
    }),
    pfRateFor(asOfDate),
    esiRateFor(asOfDate),
  ]);
  const components: StructureComponent[] = componentsRes.rows.map((r) => ({
    wageTypeCode: String(r.wage_type_code),
    wageTypeName: String(r.wage_type_name),
    componentType: String(r.component_type) as StructureComponent["componentType"],
    percentBasisPoints: r.percent_basis_points === null ? null : Number(r.percent_basis_points),
    fixedAmountPaise: r.fixed_amount_paise === null ? null : Number(r.fixed_amount_paise),
  }));
  const automaticPercentOfBasic = wageTypesRes.rows.map((r) => ({
    code: String(r.code),
    name: String(r.name),
    percentBasisPoints: Number(r.percent_basis_points),
  }));
  return computeCtcBreakdown({
    annualCtcPaise,
    components,
    automaticPercentOfBasic,
    pfRate: pfRate ?? FALLBACK_PF_RATE,
    esiRate: esiRate ?? FALLBACK_ESI_RATE,
  });
}

/* ------------------------------------------------------------- retro */

/**
 * Arrears for earlier posted months of the year whose inputs changed after
 * they were paid — a raise backdated by an increment, an unpaid absence
 * approved late, a recurring allowance added for a past month.
 *
 * A month is recalculated only when something that feeds it was recorded
 * after the employee's last regular run: once that run has paid the
 * difference, the next one finds nothing new and does not look again.
 *
 * What a month should have paid, less what it did pay, less arrears already
 * paid for it since, is what is owed now. A negative figure is a recovery.
 */
function retroLines(
  f: Facts,
  year: number,
  month: number,
  ctx: Context,
): PayrollLine[] {
  const current = ym(year, month);
  const regularHistory = f.history.filter(
    (h) => h.run_type === "Regular" && ym(h.year, h.month) < current,
  );
  if (regularHistory.length === 0) return [];
  const lastRunAt = regularHistory.reduce((m, h) => (h.run_at > m ? h.run_at : m), "");

  const changes = [
    ...f.basic.map((b) => ({ from: b.valid_from, to: b.valid_to, at: b.created_at })),
    ...f.recurring.map((r) => ({ from: r.start_date, to: r.end_date, at: r.created_at })),
    ...f.changedAbsences.map((a) => ({ from: a.start_date, to: a.end_date, at: a.created_at })),
  ].filter((c) => c.at > lastRunAt);
  if (changes.length === 0) return [];

  const retroType = ctx.wageTypes.get("RETRO");
  const lines: PayrollLine[] = [];
  const sum = (pred: (l: Facts["historyLines"][number]) => boolean) =>
    f.historyLines.filter(pred).reduce((s, l) => s + l.amount_paise, 0);

  for (const h of regularHistory) {
    if (h.period_status !== "Posted") continue;
    const from = periodStart(h.year, h.month);
    const to = periodEnd(h.year, h.month);
    if (!changes.some((c) => overlaps(c.from, c.to, from, to))) continue;

    const again = regularPart(f, h.year, h.month, ctx);
    if ("error" in again || "notEmployed" in again) continue;

    // One-off payments that month's run paid are the same either way.
    const oneOffsPaid = f.oneOffs
      .filter((o) => o.paid_run_id === h.run_id && ctx.wageTypes.get(o.code)?.kind === "Earning")
      .reduce((s, o) => s + o.amount_paise, 0);
    const shouldHaveEarned =
      again.lines.filter((l) => l.kind === "Earning").reduce((s, l) => s + l.amountPaise, 0) +
      oneOffsPaid;
    const earned = sum((l) => l.result_id === h.result_id && l.kind === "Earning" && l.for_period_id === null);
    const arrearsPaid = sum((l) => l.for_period_id === h.period_id && l.kind === "Earning");
    const arrears = shouldHaveEarned - earned - arrearsPaid;

    const label = `${MONTHS[h.month - 1]} ${h.year}`;
    if (arrears !== 0) {
      lines.push({
        wageTypeCode: "RETRO",
        wageTypeName: `${retroType?.name ?? "Arrears"} for ${label}`,
        kind: "Earning",
        amountPaise: arrears,
        sortOrder: retroType?.sortOrder ?? 45,
        forPeriodId: h.period_id,
      });
    }

    const pf = providentFund(again.basicPaise, ctx);
    if (pf) {
      const pfPaid = sum((l) => l.result_id === h.result_id && l.wage_type_code === pf.wageTypeCode && l.for_period_id === null);
      const pfArrearsPaid = sum((l) => l.for_period_id === h.period_id && l.wage_type_code === pf.wageTypeCode);
      const pfArrears = pf.amountPaise - pfPaid - pfArrearsPaid;
      if (pfArrears !== 0) {
        lines.push({
          ...pf,
          wageTypeName: `${pf.wageTypeName} arrears for ${label}`,
          amountPaise: pfArrears,
          forPeriodId: h.period_id,
        });
      }
    }
  }
  return lines;
}

/* --------------------------------------------------------------- tax */

/**
 * The TDS to deduct in this result.
 *
 * The year's taxable income is projected as what has been paid so far, plus
 * this month, plus the months still to come at today's rates. Tax on that,
 * less what has already been deducted, is spread over the months left, so
 * deductions stay even and March holds no surprise.
 *
 * Tax on a one-off amount — a bonus, arrears — is taken in full in the month
 * it is paid rather than spread, because it is not income the rest of the
 * year will repeat.
 *
 * Months before the system was in use, where there is no stored result, are
 * assumed paid at today's rate with an even share of the tax deducted; a
 * joiner's months before joining count as nothing. An imported employee's
 * opening balance (services/imports.ts) replaces that assumption for the
 * months it covers with what they actually earned and actually paid,
 * bringing the projection back to the real figure the moment it is known.
 */
function incomeTax(opts: {
  f: Facts;
  year: number;
  month: number;
  runType: RunType;
  ctx: Context;
  regularTaxablePaise: number;
  oneOffTaxablePaise: number;
  fullMonthTaxablePaise: number;
}): number {
  const { f, year, month, runType, ctx } = opts;
  const current = ym(year, month);
  const isTaxable = (code: string) => ctx.wageTypes.get(code)?.isTaxable ?? true;

  const recorded = new Set(
    f.history.filter((h) => ym(h.year, h.month) <= current).map((h) => h.result_id),
  );
  const recordedLines = f.historyLines.filter((l) => recorded.has(l.result_id));
  const obAsOfYm = f.openingBalance?.asOfYm ?? 0;
  const taxablePaid =
    (f.openingBalance?.grossPaidPaise ?? 0) +
    recordedLines
      .filter((l) => l.kind === "Earning" && isTaxable(l.wage_type_code))
      .reduce((s, l) => s + l.amount_paise, 0);
  const tdsDeducted =
    (f.openingBalance?.tdsDeductedPaise ?? 0) +
    recordedLines.filter((l) => l.wage_type_code === "TDS").reduce((s, l) => s + l.amount_paise, 0);

  const regularMonths = new Set(
    f.history.filter((h) => h.run_type === "Regular").map((h) => ym(h.year, h.month)),
  );
  const months = monthsOfYear(ctx.financialYear).filter((m) => employedIn(f, m.year, m.month));
  const unrecorded = months.filter(
    (m) => ym(m.year, m.month) < current && !regularMonths.has(ym(m.year, m.month)) && ym(m.year, m.month) > obAsOfYm,
  ).length;
  const future = months.filter((m) => ym(m.year, m.month) > current).length;
  // An off-cycle run before this month's regular run still expects it.
  const thisMonthToCome =
    runType === "Off-cycle" && !regularMonths.has(current) && employedIn(f, year, month) ? 1 : 0;

  const F = opts.fullMonthTaxablePaise;
  const base =
    taxablePaid + (unrecorded + future + thisMonthToCome) * F + opts.regularTaxablePaise;
  const tax = (gross: number) => annualTaxFor(gross, f.declaration, ctx.financialYear, ctx.slabs, ctx.constants);

  const taxOnBase = tax(base);
  const taxWithOneOffs = opts.oneOffTaxablePaise ? tax(base + opts.oneOffTaxablePaise) : taxOnBase;
  const oneOffShare = taxWithOneOffs - taxOnBase;

  if (runType === "Off-cycle") return Math.max(0, Math.round(oneOffShare));

  const assumedDeducted = unrecorded * (taxOnBase / 12);
  const monthsLeft = 1 + future;
  const regularShare = Math.max(0, (taxOnBase - tdsDeducted - assumedDeducted) / monthsLeft);
  return Math.max(0, Math.round(regularShare + oneOffShare));
}

/* ------------------------------------------------------- one employee */

function calculateFromFacts(opts: {
  employeeId: number;
  year: number;
  month: number;
  runType: RunType;
  runId: number;
  f: Facts;
  ctx: Context;
}): EmployeeResult {
  const { employeeId, year, month, runType, runId, f, ctx } = opts;
  const from = periodStart(year, month);
  const to = periodEnd(year, month);

  const empty: EmployeeResult = {
    employeeId,
    grossPaise: 0,
    deductionsPaise: 0,
    netPaise: 0,
    unpaidDays: 0,
    workingDays: 0,
    employedDays: 0,
    status: "Calculated",
    lines: [],
    paidAdditionalIds: [],
  };
  const error = (message: string, part?: Partial<EmployeeResult>): EmployeeResult => ({
    ...empty,
    ...part,
    status: "Error",
    errorMessage: message,
  });

  const regular = regularPart(f, year, month, ctx);
  // Off-cycle may pay someone after they have left — a final settlement.
  if ("notEmployed" in regular && runType === "Regular") {
    return error("Not employed in this period.");
  }

  const bankDate = f.terminationDate && f.terminationDate < to ? f.terminationDate : to;
  if (!f.bank.some((b) => b.valid_from <= bankDate && b.valid_to >= bankDate)) {
    return error("No bank details on record (IT0009), so the salary cannot be paid.");
  }

  const lines: PayrollLine[] = [];
  let days = { workingDays: 0, employedDays: 0, unpaidDays: 0 };

  // One-off payments: in a regular run, those dated in the month and not paid
  // elsewhere; off-cycle, anything still unpaid up to the month's end.
  const oneOffs = f.oneOffs.filter((o) =>
    runType === "Regular"
      ? o.payment_date >= from && o.payment_date <= to && (o.paid_run_id === null || o.paid_run_id === runId)
      : o.payment_date <= to && o.paid_run_id === null,
  );

  let regularTaxable = 0;
  if (runType === "Regular") {
    if (!("lines" in regular)) return error("error" in regular ? regular.error : "Not employed in this period.");
    lines.push(...regular.lines);
    days = {
      workingDays: regular.workingDays,
      employedDays: regular.employedDays,
      unpaidDays: regular.unpaidDays,
    };
    regularTaxable = regular.lines
      .filter((l) => l.kind === "Earning" && (ctx.wageTypes.get(l.wageTypeCode)?.isTaxable ?? true))
      .reduce((s, l) => s + l.amountPaise, 0);
  } else if (oneOffs.length === 0) {
    return error("There are no unpaid one-off payments to pay off-cycle.");
  }

  for (const o of oneOffs) {
    const type = ctx.wageTypes.get(o.code);
    if (!type) continue;
    lines.push({
      wageTypeCode: o.code,
      wageTypeName: type.name,
      kind: type.kind,
      amountPaise: o.amount_paise,
      sortOrder: type.sortOrder,
    });
  }

  const retro = runType === "Regular" ? retroLines(f, year, month, ctx) : [];
  lines.push(...retro);

  if (runType === "Regular" && "lines" in regular) {
    const pf = providentFund(regular.basicPaise, ctx);
    if (pf && pf.amountPaise > 0) lines.push(pf);
    lines.push(...employerPfLines(regular.basicPaise, ctx));

    const esiCode = [...ctx.wageTypes.values()].find((w) => w.formulaKey === "ESI")?.code ?? "ESI";
    const esiEligible = regularTaxable > 0 && (regularTaxable <= ctx.esiRate.wageCeilingPaise || hadEsiEarlierInPeriod(f, year, month, esiCode));
    lines.push(...esiLines(regularTaxable, esiEligible, ctx));

    const ptState = f.statutoryDetails?.professionalTaxState ?? null;
    const pt = professionalTaxLine(ptState, to, regularTaxable, ctx);
    if (pt) lines.push(pt);
    lines.push(...lwfLines(ptState, to, ctx));
  }

  const oneOffTaxable =
    oneOffs
      .filter((o) => ctx.wageTypes.get(o.code)?.kind === "Earning" && ctx.wageTypes.get(o.code)?.isTaxable)
      .reduce((s, o) => s + o.amount_paise, 0) +
    retro.filter((l) => l.kind === "Earning").reduce((s, l) => s + l.amountPaise, 0);

  const tdsType = [...ctx.wageTypes.values()].find((w) => w.formulaKey === "TDS");
  if (tdsType) {
    const tds = incomeTax({
      f,
      year,
      month,
      runType,
      ctx,
      regularTaxablePaise: regularTaxable,
      oneOffTaxablePaise: oneOffTaxable,
      fullMonthTaxablePaise: "lines" in regular ? regular.fullMonthTaxablePaise : 0,
    });
    if (tds > 0) {
      lines.push({
        wageTypeCode: tdsType.code,
        wageTypeName: tdsType.name,
        kind: "Deduction",
        amountPaise: tds,
        sortOrder: tdsType.sortOrder,
      });
    }
  }

  const grossPaise = lines.filter((l) => l.kind === "Earning").reduce((s, l) => s + l.amountPaise, 0);
  const deductionsPaise = lines.filter((l) => l.kind === "Deduction").reduce((s, l) => s + l.amountPaise, 0);

  return {
    employeeId,
    grossPaise,
    deductionsPaise,
    netPaise: grossPaise - deductionsPaise,
    ...days,
    status: "Calculated",
    lines: lines.sort((a, b) => a.sortOrder - b.sortOrder),
    paidAdditionalIds: oneOffs.map((o) => o.id),
  };
}

/**
 * One employee's result for a month, without storing anything. The run uses
 * the same path; this is for checks and previews.
 */
export async function calculateEmployee(opts: {
  employeeId: number;
  year: number;
  month: number;
  runType?: RunType;
  runId?: number;
}): Promise<EmployeeResult> {
  const { employeeId, year, month, runType = "Regular", runId = 0 } = opts;
  const financialYear = financialYearOf(periodEnd(year, month));
  const [ctx, f] = await Promise.all([
    loadContext(financialYear),
    loadFacts(employeeId, financialYear, runId),
  ]);
  if (!f) {
    return {
      employeeId,
      grossPaise: 0,
      deductionsPaise: 0,
      netPaise: 0,
      unpaidDays: 0,
      workingDays: 0,
      employedDays: 0,
      status: "Error",
      errorMessage: "That employee does not exist.",
      lines: [],
      paidAdditionalIds: [],
    };
  }
  return calculateFromFacts({ employeeId, year, month, runType, runId, f, ctx });
}

/* ------------------------------------------------------------------ runs */

type RunRow = {
  id: number;
  period_id: number;
  run_type: RunType;
  status: string;
  planned_count: number;
  employee_count: number;
  year: number;
  month: number;
  period_status: string;
  area_code: string;
};

async function getRun(runId: number): Promise<RunRow | undefined> {
  const r = await rawClient().execute({
    sql: `SELECT run.id, run.period_id, run.run_type, run.status, run.planned_count,
                 run.employee_count, p.year, p.month, p.status AS period_status, p.area_code
          FROM py_payroll_run run JOIN py_payroll_period p ON p.id = run.period_id
          WHERE run.id = ?`,
    args: [runId],
  });
  const row = r.rows[0];
  if (!row) return undefined;
  return {
    id: Number(row.id),
    period_id: Number(row.period_id),
    run_type: String(row.run_type) as RunType,
    status: String(row.status),
    planned_count: Number(row.planned_count),
    employee_count: Number(row.employee_count),
    year: Number(row.year),
    month: Number(row.month),
    period_status: String(row.period_status),
    area_code: String(row.area_code),
  };
}

/**
 * Removes a run and everything made from it, and releases the one-off
 * payments it paid. Written out rather than left to ON DELETE CASCADE, so it
 * behaves the same on a local SQLite file, which does not enforce foreign keys
 * unless asked, as it does on Turso.
 */
export function deleteRunStatements(runId: number): InStatement[] {
  const results = "SELECT id FROM py_payroll_result WHERE run_id = ?";
  const files = "SELECT id FROM py_bank_transfer_file WHERE run_id = ?";
  const postings = "SELECT id FROM py_gl_posting WHERE run_id = ?";
  return [
    { sql: "UPDATE py_it0015_additional_payment SET paid_run_id = NULL WHERE paid_run_id = ?", args: [runId] },
    { sql: `DELETE FROM py_payroll_result_line WHERE result_id IN (${results})`, args: [runId] },
    { sql: "DELETE FROM py_payroll_result WHERE run_id = ?", args: [runId] },
    { sql: "DELETE FROM py_run_member WHERE run_id = ?", args: [runId] },
    { sql: `DELETE FROM py_bank_transfer_line WHERE file_id IN (${files})`, args: [runId] },
    { sql: "DELETE FROM py_bank_transfer_file WHERE run_id = ?", args: [runId] },
    { sql: `DELETE FROM py_gl_posting_line WHERE posting_id IN (${postings})`, args: [runId] },
    { sql: "DELETE FROM py_gl_posting WHERE run_id = ?", args: [runId] },
    { sql: "DELETE FROM py_statutory_remittance WHERE run_id = ?", args: [runId] },
    { sql: "DELETE FROM py_payroll_run WHERE id = ?", args: [runId] },
  ];
}

/**
 * Starts a run: checks the control record, fixes the list of people to
 * calculate, and returns straight away. processRunBatch does the work.
 *
 * A regular run replaces any earlier regular run for the period, so re-running
 * after fixing a record does not leave two sets of numbers for one month.
 * Off-cycle runs are never replaced; each is its own payment.
 */
export async function startRun(opts: {
  periodId: number;
  runBy: string;
  runType?: RunType;
  employeeIds?: number[];
  reason?: string | null;
  payDate?: string | null;
}): Promise<{ runId: number; planned: number }> {
  const { periodId, runBy, runType = "Regular" } = opts;
  const client = rawClient();

  const periodRows = await client.execute({
    sql: "SELECT id, area_code, year, month, status FROM py_payroll_period WHERE id = ?",
    args: [periodId],
  });
  const period = periodRows.rows[0];
  if (!period) throw new Error("That payroll period no longer exists.");
  const status = String(period.status);

  if (runType === "Regular") {
    if (status === "Open") throw new Error("Release the period before running payroll.");
    if (status === "Posted") {
      throw new Error("This period is posted and can no longer be run. Use an off-cycle run to pay anything owed.");
    }
  } else {
    if (status === "Open") throw new Error("Release the period before running off-cycle.");
    if (!opts.employeeIds?.length) throw new Error("Choose who the off-cycle run pays.");
  }

  const from = periodStart(Number(period.year), Number(period.month));
  const to = periodEnd(Number(period.year), Number(period.month));

  let members: number[];
  if (runType === "Regular") {
    // Everyone employed at any point in the month, assigned to this area on
    // their last day in it — a joiner and a leaver both belong to the run.
    const rows = await client.execute({
      sql: `SELECT DISTINCT e.id FROM pa_employee e
            JOIN pa_it0001_org_assignment o ON o.employee_id = e.id
             AND o.area_code = ?1
             AND o.valid_from <= min(?3, coalesce(e.termination_date, ?3))
             AND o.valid_to >= min(?3, coalesce(e.termination_date, ?3))
            WHERE e.hire_date <= ?3
              AND (e.termination_date IS NULL OR e.termination_date >= ?2)
            ORDER BY e.id`,
      args: [String(period.area_code), from, to],
    });
    members = rows.rows.map((r) => Number(r.id));
  } else {
    members = [...new Set(opts.employeeIds!)];
  }

  const previous =
    runType === "Regular"
      ? (
          await client.execute({
            sql: "SELECT id FROM py_payroll_run WHERE period_id = ? AND run_type = 'Regular'",
            args: [periodId],
          })
        ).rows.map((r) => Number(r.id))
      : [];

  const tx = await client.transaction("write");
  try {
    for (const id of previous) {
      for (const stmt of deleteRunStatements(id)) await tx.execute(stmt);
    }
    const created = await tx.execute({
      sql: `INSERT INTO py_payroll_run
              (period_id, run_at, run_by, run_type, status, reason, pay_date, planned_count)
            VALUES (?, ?, ?, ?, 'In progress', ?, ?, ?) RETURNING id`,
      args: [periodId, now(), runBy, runType, opts.reason ?? null, opts.payDate ?? null, members.length],
    });
    const runId = Number(created.rows[0].id);
    for (let i = 0; i < members.length; i += 200) {
      const chunk = members.slice(i, i + 200);
      await tx.execute({
        sql: `INSERT INTO py_run_member (run_id, employee_id) VALUES ${chunk.map(() => "(?, ?)").join(", ")}`,
        args: chunk.flatMap((id) => [runId, id]),
      });
    }
    if (members.length === 0) {
      await tx.execute({
        sql: "UPDATE py_payroll_run SET status = 'Completed', completed_at = ? WHERE id = ?",
        args: [now(), runId],
      });
    }
    await tx.commit();
    return { runId, planned: members.length };
  } catch (err) {
    await tx.rollback();
    throw err;
  } finally {
    tx.close();
  }
}

export type RunProgress = {
  runId: number;
  planned: number;
  done: number;
  errors: number;
  completed: boolean;
};

/** Where a run stands, without doing any of its work. */
export async function readRunProgress(runId: number): Promise<RunProgress | null> {
  const r = await rawClient().execute({
    sql: "SELECT planned_count, employee_count, error_count, status FROM py_payroll_run WHERE id = ?",
    args: [runId],
  });
  const row = r.rows[0];
  if (!row) return null;
  return {
    runId,
    planned: Number(row.planned_count),
    done: Number(row.employee_count),
    errors: Number(row.error_count),
    completed: row.status === "Completed",
  };
}

/**
 * Calculates and stores the next few people in a run. Each person's result,
 * lines, the one-off payments it settles and the run's running totals are
 * written in one atomic batch, so a batch cut short by a timeout leaves every
 * person either fully done or untouched, and the next call carries on.
 */
export async function processRunBatch(
  runId: number,
  size: number = BATCH_SIZE,
): Promise<RunProgress> {
  const client = rawClient();
  const run = await getRun(runId);
  if (!run) throw new Error("That payroll run no longer exists.");

  const progress = async (): Promise<RunProgress> => {
    const r = await getRun(runId);
    const errors = await client.execute({
      sql: "SELECT error_count FROM py_payroll_run WHERE id = ?",
      args: [runId],
    });
    return {
      runId,
      planned: r?.planned_count ?? 0,
      done: r?.employee_count ?? 0,
      errors: Number(errors.rows[0]?.error_count ?? 0),
      completed: r?.status === "Completed",
    };
  };

  if (run.status === "Completed") return progress();
  if (run.run_type === "Regular" && run.period_status === "Posted") {
    throw new Error("This period was posted while the run was in progress.");
  }

  const pending = await client.execute({
    sql: "SELECT employee_id FROM py_run_member WHERE run_id = ? AND done = 0 ORDER BY employee_id LIMIT ?",
    args: [runId, Math.max(1, size)],
  });
  const ids = pending.rows.map((r) => Number(r.employee_id));

  if (ids.length > 0) {
    const financialYear = financialYearOf(periodEnd(run.year, run.month));
    const ctx = await loadContext(financialYear);

    for (const employeeId of ids) {
      const f = await loadFacts(employeeId, financialYear, runId);
      const result: EmployeeResult = f
        ? calculateFromFacts({ employeeId, year: run.year, month: run.month, runType: run.run_type, runId, f, ctx })
        : {
            employeeId,
            grossPaise: 0,
            deductionsPaise: 0,
            netPaise: 0,
            unpaidDays: 0,
            workingDays: 0,
            employedDays: 0,
            status: "Error",
            errorMessage: "That employee no longer exists.",
            lines: [],
            paidAdditionalIds: [],
          };
      await client.batch(storeResultStatements(runId, result), "write");
    }
  }

  const remaining = await client.execute({
    sql: "SELECT COUNT(*) AS n FROM py_run_member WHERE run_id = ? AND done = 0",
    args: [runId],
  });
  if (Number(remaining.rows[0].n) === 0) {
    await client.execute({
      sql: "UPDATE py_payroll_run SET status = 'Completed', completed_at = ? WHERE id = ? AND status != 'Completed'",
      args: [now(), runId],
    });
  }
  return progress();
}

function storeResultStatements(runId: number, r: EmployeeResult): InStatement[] {
  const ok = r.status === "Calculated";
  const resultId = "(SELECT id FROM py_payroll_result WHERE run_id = ? AND employee_id = ?)";
  const statements: InStatement[] = [
    {
      sql: `INSERT INTO py_payroll_result
              (run_id, employee_id, gross_paise, deductions_paise, net_paise, unpaid_days,
               working_days, employed_days, status, error_message)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        runId,
        r.employeeId,
        r.grossPaise,
        r.deductionsPaise,
        r.netPaise,
        r.unpaidDays,
        r.workingDays,
        r.employedDays,
        r.status,
        r.errorMessage ?? null,
      ],
    },
    ...r.lines.map<InStatement>((l) => ({
      sql: `INSERT INTO py_payroll_result_line
              (result_id, wage_type_code, wage_type_name, kind, amount_paise, sort_order, for_period_id)
            VALUES (${resultId}, ?, ?, ?, ?, ?, ?)`,
      args: [runId, r.employeeId, l.wageTypeCode, l.wageTypeName, l.kind, l.amountPaise, l.sortOrder, l.forPeriodId ?? null],
    })),
    {
      sql: "UPDATE py_run_member SET done = 1 WHERE run_id = ? AND employee_id = ?",
      args: [runId, r.employeeId],
    },
    {
      sql: `UPDATE py_payroll_run SET
              employee_count = employee_count + 1,
              error_count = error_count + ?,
              gross_total_paise = gross_total_paise + ?,
              net_total_paise = net_total_paise + ?
            WHERE id = ?`,
      args: [ok ? 0 : 1, ok ? r.grossPaise : 0, ok ? r.netPaise : 0, runId],
    },
  ];
  if (ok && r.paidAdditionalIds.length > 0) {
    statements.push({
      sql: `UPDATE py_it0015_additional_payment SET paid_run_id = ?
            WHERE id IN (${r.paidAdditionalIds.map(() => "?").join(", ")})`,
      args: [runId, ...r.paidAdditionalIds],
    });
  }
  return statements;
}

/**
 * Starts a run and drives it to the end in one call. For checks, seeds and
 * small organisations; the screen drives the batches itself so it can show
 * progress and never meets a request time limit.
 */
export async function runPayroll(opts: {
  periodId: number;
  runBy: string;
  runType?: RunType;
  employeeIds?: number[];
  reason?: string | null;
  payDate?: string | null;
}): Promise<RunProgress> {
  const { runId } = await startRun(opts);
  for (;;) {
    const p = await processRunBatch(runId);
    if (p.completed) return p;
  }
}
