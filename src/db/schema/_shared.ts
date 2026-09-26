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

const INDIA_DATE = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZone: "Asia/Kolkata",
});

/**
 * Today as `YYYY-MM-DD`, in India. Every company here is in India, and the
 * servers run in UTC — which is still yesterday until 5:30 in the morning.
 */
export function today(): string {
  return INDIA_DATE.format(new Date());
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
