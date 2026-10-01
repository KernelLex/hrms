import { sqliteTable, text, integer, uniqueIndex, index } from "drizzle-orm/sqlite-core";

/**
 * Analytics: monthly snapshots, so a trend is a read rather than a
 * recomputation every time, and scheduled reports.
 */

/** A measure's own unit: count, paise or days — fixed by which measure it is, not stored. */
export const SNAPSHOT_MEASURES = ["headcount", "joiners", "leavers", "payroll_cost", "overtime", "leave"] as const;
export type SnapshotMeasure = (typeof SNAPSHOT_MEASURES)[number];

export const rpSnapshot = sqliteTable(
  "rp_snapshot",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** The month this is as of, the first of the month: "2026-09-01". */
    month: text("month").notNull(),
    measure: text("measure").notNull(),
    /** An org unit or personnel-area code, or "ALL" for the organisation-wide figure. */
    dimension: text("dimension").notNull().default("ALL"),
    dimensionType: text("dimension_type").notNull().default("company"),
    value: integer("value").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("ux_snapshot_month_measure_dimension").on(t.month, t.measure, t.dimension),
    index("ix_snapshot_measure").on(t.measure, t.month),
  ],
);

export const REPORT_FREQUENCIES = ["Monthly"] as const;
export const REPORT_FORMATS = ["CSV"] as const;

export const rpSchedule = sqliteTable("rp_schedule", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  /** Which report: "headcount_trend" or "leave_liability" today. */
  reportName: text("report_name").notNull(),
  /** Free-form JSON the report's own renderer reads, such as a department filter. */
  filters: text("filters"),
  /** Comma-separated email addresses. */
  recipients: text("recipients").notNull(),
  frequency: text("frequency").notNull().default("Monthly"),
  format: text("format").notNull().default("CSV"),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull(),
  lastRunAt: text("last_run_at"),
});
