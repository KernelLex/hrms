/**
 * Dates at the render edge — HANDOVER.md §8.12: "26 Sept 2026", "10:50 pm".
 *
 * Dates are stored as ISO `YYYY-MM-DD` text and only formatted here, the same
 * way money is stored as paise and only formatted in money.ts. Parsing is by
 * hand rather than through `new Date()`, so a date never shifts by a day with
 * the server's time zone.
 */

import { OPEN_ENDED } from "@/db/schema/_shared";

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "June",
  "July", "Aug", "Sept", "Oct", "Nov", "Dec",
];

const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function parts(iso: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return null;
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
}

/** "26 Sept 2026". Anything that is not an ISO date is returned unchanged. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const p = parts(iso);
  if (!p) return iso;
  return `${p.d} ${MONTHS[p.m - 1]} ${p.y}`;
}

/** "26 Sept", for lists where the year is obvious from context. */
export function formatDayMonth(iso: string): string {
  const p = parts(iso);
  if (!p) return iso;
  return `${p.d} ${MONTHS[p.m - 1]}`;
}

/**
 * A span of days, sharing whatever the two ends have in common:
 *   "23 Jan 2026"  ·  "23 to 27 Jan 2026"  ·  "30 Jan to 2 Feb 2026"
 *   "1 Jan 2024 onwards" for an open-ended validity.
 */
export function formatDateRange(from: string, to: string | null | undefined): string {
  if (!to || to === OPEN_ENDED) return `${formatDate(from)} onwards`;
  if (from === to) return formatDate(from);
  const a = parts(from);
  const b = parts(to);
  if (!a || !b) return `${from} to ${to}`;
  if (a.y !== b.y) return `${formatDate(from)} to ${formatDate(to)}`;
  if (a.m !== b.m) return `${a.d} ${MONTHS[a.m - 1]} to ${formatDate(to)}`;
  return `${a.d} to ${formatDate(to)}`;
}

/** "September 2026", for payroll periods. */
export function formatMonth(year: number, month: number): string {
  return `${MONTHS_LONG[month - 1]} ${year}`;
}

/** "2:30 pm" from a stored "14:30". */
export function formatTime(hhmm: string | null | undefined): string {
  if (!hhmm) return "";
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm);
  if (!m) return hhmm;
  const h = Number(m[1]);
  const suffix = h >= 12 ? "pm" : "am";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m[2]} ${suffix}`;
}

const TIME = new Intl.DateTimeFormat("en-GB", {
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
  timeZone: "Asia/Kolkata",
});

const DAY_IN_INDIA = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZone: "Asia/Kolkata",
});

/**
 * "26 Sept 2026, 10:50 pm" for a stored UTC timestamp, shown in India time —
 * every company in this system is in India, and a timestamp read in UTC would
 * put an evening approval on the wrong day.
 */
export function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const time = TIME.format(d).replace(/\s/g, " ").toLowerCase();
  return `${formatDate(DAY_IN_INDIA.format(d))}, ${time}`;
}

/** Today in India as `YYYY-MM-DD`, for comparisons against stored dates. */
export function todayInIndia(): string {
  return DAY_IN_INDIA.format(new Date());
}
