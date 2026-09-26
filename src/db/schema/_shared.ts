/**
 * Conventions shared by every table.
 *
 * Dates are TEXT in ISO-8601 `YYYY-MM-DD`. They sort lexicographically, compare
 * correctly with `<` and `>`, and need no parsing in SQL. Timestamps are
 * ISO-8601 UTC strings.
 *
 * Booleans are INTEGER 0/1 — SQLite has no BIT.
 *
 * Money is INTEGER paise — see src/lib/money.ts for why.
 */

/** The open-ended end of a validity period, as SAP writes it. */
export const OPEN_ENDED = "9999-12-31";

/** Today as `YYYY-MM-DD`. */
export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Now as an ISO-8601 UTC timestamp. */
export function now(): string {
  return new Date().toISOString();
}

/** The day before `date`, used to delimit a superseded time slice. */
export function dayBefore(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
