import "server-only";
import type { InStatement } from "@libsql/client";
import { rawClient } from "@/lib/db";
import { now } from "@/db/schema";
import { headcountAsOf, trailingMonths } from "@/lib/repositories/reports";
import { leaveLiabilityAsOf } from "@/lib/engines/leave-policy";
import { toCsv, rupees } from "@/lib/csv";
import { todayInIndia } from "@/lib/dates";
import { queueEmailStatement, renderEmail } from "@/lib/email";
import { REPORT_LABEL } from "@/lib/reports-values";

/**
 * Monthly snapshots: headcount read as of each month's end, for the last 24
 * months, backfilled once and then kept current — the time-slice engine
 * already answers "who was employed then" for any date, so a past month is
 * no different from today's.
 */

/** The last day of the month a "YYYY-MM-01" key names. */
function monthEnd(monthKey: string): string {
  const d = new Date(`${monthKey}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
}

/**
 * Snapshots headcount for every trailing month missing one — a past month,
 * once taken, never changes — plus the current month every time, since it
 * is still being lived in and headcount within it can still move.
 */
export async function backfillHeadcountSnapshots(asOf: string): Promise<number> {
  const months = trailingMonths(asOf);
  const currentMonth = months[months.length - 1];
  const existing = await rawClient().execute({
    sql: `SELECT month FROM rp_snapshot WHERE measure = 'headcount' AND dimension = 'ALL' AND month IN (${months.map(() => "?").join(", ")})`,
    args: months,
  });
  const have = new Set(existing.rows.map((r) => String(r.month)));
  const missing = months.filter((m) => !have.has(m) || m === currentMonth);

  let written = 0;
  for (const month of missing) {
    const value = await headcountAsOf(monthEnd(month));
    await rawClient().execute({
      sql: `INSERT INTO rp_snapshot (month, measure, dimension, dimension_type, value, created_at)
            VALUES (?, 'headcount', 'ALL', 'company', ?, ?)
            ON CONFLICT (month, measure, dimension) DO UPDATE SET value = excluded.value`,
      args: [month, value, now()],
    });
    written += 1;
  }
  return written;
}

export type Trend = { month: string; value: number };

/** The last 24 months' headcount, oldest first, from the snapshot table. */
export async function headcountTrend(asOf: string): Promise<Trend[]> {
  const months = trailingMonths(asOf);
  const rows = await rawClient().execute({
    sql: `SELECT month, value FROM rp_snapshot WHERE measure = 'headcount' AND dimension = 'ALL' AND month IN (${months.map(() => "?").join(", ")})`,
    args: months,
  });
  const byMonth = new Map(rows.rows.map((r) => [String(r.month), Number(r.value)]));
  return months.map((month) => ({ month, value: byMonth.get(month) ?? 0 }));
}

export { REPORT_NAMES, REPORT_LABEL, type ReportName } from "./reports-values";

/** Renders a named report to CSV, fresh each time — the recipe to make it, not stored bytes. */
export async function renderReportCsv(reportName: string): Promise<{ csv: string; fileName: string } | null> {
  const asOf = todayInIndia();
  if (reportName === "headcount_trend") {
    const trend = await headcountTrend(asOf);
    const csv = toCsv([["Month", "Headcount"], ...trend.map((t) => [t.month.slice(0, 7), t.value])]);
    return { csv, fileName: `headcount-trend-${asOf}.csv` };
  }
  if (reportName === "leave_liability") {
    const liability = await leaveLiabilityAsOf(asOf);
    const csv = toCsv([
      ["Employee ID", "Quota type", "Days", "Amount (₹)"],
      ...liability.byEmployee.map((r) => [r.employeeId, r.quotaTypeCode, r.units / 2, rupees(r.amountPaise)]),
      ["", "", "Total", rupees(liability.totalPaise)],
    ]);
    return { csv, fileName: `leave-liability-${asOf}.csv` };
  }
  return null;
}

/** Runs every monthly schedule not yet run this month, queuing its report to each recipient. Called from the 1st-of-month guard the daily job already has. */
export async function runDueSchedules(asOf: string): Promise<number> {
  const due = await rawClient().execute({
    sql: `SELECT * FROM rp_schedule WHERE last_run_at IS NULL OR substr(last_run_at, 1, 7) <> substr(?, 1, 7)`,
    args: [asOf],
  });
  let sent = 0;
  for (const row of due.rows) {
    const reportName = String(row.report_name);
    const rendered = await renderReportCsv(reportName);
    if (!rendered) continue;
    const scheduleId = Number(row.id);
    const recipients = String(row.recipients)
      .split(",")
      .map((r) => r.trim())
      .filter(Boolean);
    if (recipients.length === 0) continue;

    const statements: InStatement[] = recipients.map((to) =>
      queueEmailStatement(
        `report.delivered:${scheduleId}:${asOf}:${to}`,
        {
          to,
          ...renderEmail({
            title: `${REPORT_LABEL[reportName] ?? reportName} — ${asOf}`,
            body: "Attached as a CSV, ready to open in a spreadsheet.",
          }),
        },
        { kind: "report.delivered", scheduleId },
        [{ type: "report", reportName, scheduleId, fileName: rendered.fileName }],
      ),
    );
    await rawClient().batch(statements, "write");
    await rawClient().execute({ sql: "UPDATE rp_schedule SET last_run_at = ? WHERE id = ?", args: [asOf, scheduleId] });
    sent += recipients.length;
  }
  return sent;
}
