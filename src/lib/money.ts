/**
 * Money is stored as INTEGER paise, never as a float.
 *
 * SQLite has no DECIMAL type, and REAL is IEEE-754 binary floating point —
 * 0.1 + 0.2 !== 0.3, and those errors compound across a payroll run of
 * hundreds of employees. So every amount crosses the database boundary as a
 * whole number of paise, and is formatted only here, at the render edge.
 *
 *   ₹72,000.00  ->  7_200_000 paise
 */

/** Rupees (as typed by a user) to integer paise. Rounds to the nearest paisa. */
export function toPaise(rupees: number | string): number {
  const n = typeof rupees === "string" ? Number(rupees.replace(/[^0-9.-]/g, "")) : rupees;
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

/** Integer paise to a rupee number. For display and arithmetic at the edge only. */
export function toRupees(paise: number): number {
  return paise / 100;
}

const INR = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const INR_PAISE = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * "₹72,000" — Indian digit grouping, no decimals.
 * §12: numbers carry their units and use local formats.
 */
export function formatINR(paise: number): string {
  return INR.format(toRupees(paise));
}

/** "₹72,000.00" — for payslips and certificates, where paise must show. */
export function formatINRExact(paise: number): string {
  return INR_PAISE.format(toRupees(paise));
}

/** "₹14.8 L" — for figures where the exact rupee does not help the reader. */
export function formatLakh(paise: number): string {
  const rupees = toRupees(paise);
  if (Math.abs(rupees) < 100_000) return formatINR(paise);
  const lakhs = rupees / 100_000;
  if (Math.abs(lakhs) >= 100) {
    return `₹${(lakhs / 100).toFixed(1)} Cr`;
  }
  return `₹${lakhs.toFixed(1)} L`;
}

/** Split a whole amount into n parts in paise, distributing the remainder. */
export function splitPaise(total: number, parts: number): number[] {
  if (parts <= 0) return [];
  const base = Math.floor(total / parts);
  const remainder = total - base * parts;
  return Array.from({ length: parts }, (_, i) => base + (i < remainder ? 1 : 0));
}

/** Percentage of an amount, in paise, rounded to the nearest paisa. */
export function percentOf(paise: number, percent: number): number {
  return Math.round((paise * percent) / 100);
}
