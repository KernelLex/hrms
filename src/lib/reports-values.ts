/**
 * Reports' fixed lists, in a plain module so the schedule form (a client
 * component) can use them without pulling in `lib/reports.ts`, which is
 * marked `server-only`.
 */

export const REPORT_NAMES = ["headcount_trend", "leave_liability"] as const;
export type ReportName = (typeof REPORT_NAMES)[number];
export const REPORT_LABEL: Record<string, string> = { headcount_trend: "Headcount trend", leave_liability: "Leave liability" };
