/**
 * The pure maths a settlement needs: gratuity under the Payment of Gratuity
 * Act, and a notice shortfall. No database access here — `services/exits.ts`
 * reads what these need and queues the one-off payments they produce.
 */

const MS_PER_DAY = 86_400_000;
const dateOf = (d: string) => new Date(`${d}T00:00:00Z`);

/**
 * Completed years of service for gratuity: full years from the hire date,
 * plus one more if at least 240 days have passed in the year after the last
 * completed one. That 240-day figure is section 2A's own definition of a
 * full year of "continuous service" — courts have read it into section
 * 4(1)'s five-year eligibility the same way, so four years and 240 days is
 * treated as five.
 */
export function gratuityYears(hireDate: string, lastDay: string): number {
  const hire = dateOf(hireDate);
  const last = dateOf(lastDay);
  let years = last.getUTCFullYear() - hire.getUTCFullYear();
  const thisYearsAnniversary = new Date(Date.UTC(hire.getUTCFullYear() + years, hire.getUTCMonth(), hire.getUTCDate()));
  if (thisYearsAnniversary > last) years -= 1;
  const lastAnniversary = new Date(Date.UTC(hire.getUTCFullYear() + years, hire.getUTCMonth(), hire.getUTCDate()));
  const daysSince = Math.round((last.getTime() - lastAnniversary.getTime()) / MS_PER_DAY);
  return daysSince >= 240 ? years + 1 : years;
}

export const GRATUITY_MIN_YEARS = 5;
export const GRATUITY_CAP_PAISE = 20_00_000 * 100; // section 10(10)(iii)'s ₹20 lakh ceiling

/**
 * 15/26 of the last basic for each completed year, capped at ₹20 lakh —
 * the statutory formula and, for anyone outside government service, also
 * its own tax exemption, so the amount paid is exactly the amount exempt.
 * Nothing below five years' service (by `gratuityYears`) is eligible.
 */
export function computeGratuity(lastBasicPaise: number, years: number): { eligible: boolean; amountPaise: number } {
  if (years < GRATUITY_MIN_YEARS) return { eligible: false, amountPaise: 0 };
  const amount = Math.round(((lastBasicPaise * 15) / 26) * years);
  return { eligible: true, amountPaise: Math.min(amount, GRATUITY_CAP_PAISE) };
}

/**
 * Days short of the notice policy, from when notice was given to the day
 * actually worked to. Zero once they have served it in full, or longer.
 */
export function noticeShortfallDays(noticeDays: number, requestedAt: string, lastDay: string): number {
  const served = Math.round((dateOf(lastDay).getTime() - dateOf(requestedAt).getTime()) / MS_PER_DAY);
  return Math.max(0, noticeDays - served);
}

/** What a notice shortfall costs, at the monthly basic over a 30-day month — the same convention the loan engine's EMI maths uses for a flat month. */
export function noticePayPaise(monthlyBasicPaise: number, shortfallDays: number): number {
  return Math.round((monthlyBasicPaise * shortfallDays) / 30);
}
