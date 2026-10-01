import type { Client } from "@libsql/client";

/**
 * The last 24 months' headcount, so the trend has something to show from
 * the first run rather than waiting on 24 months of daily ticks, and one
 * demo report schedule. Computed directly against the seed's own client,
 * not through `lib/reports.ts` — that module is marked `server-only` and
 * would throw under this script's plain Node runtime, which has none of
 * Next.js's or Vitest's handling for that marker.
 */
export async function seedReports(client: Client): Promise<string[]> {
  const notes: string[] = [];
  const today = new Date().toISOString().slice(0, 10);
  const createdAt = new Date().toISOString();

  const months: string[] = [];
  const d = new Date(`${today.slice(0, 7)}-01T00:00:00Z`);
  for (let i = 23; i >= 0; i--) {
    const m = new Date(d);
    m.setUTCMonth(m.getUTCMonth() - i);
    months.push(m.toISOString().slice(0, 10));
  }

  for (const month of months) {
    const end = new Date(`${month}T00:00:00Z`);
    end.setUTCMonth(end.getUTCMonth() + 1);
    end.setUTCDate(0);
    const asOf = end.toISOString().slice(0, 10);

    const r = await client.execute({
      sql: `SELECT COUNT(*) AS n FROM pa_employee WHERE hire_date <= ? AND (termination_date IS NULL OR termination_date > ?)`,
      args: [asOf, asOf],
    });
    await client.execute({
      sql: `INSERT INTO rp_snapshot (month, measure, dimension, dimension_type, value, created_at)
            VALUES (?, 'headcount', 'ALL', 'company', ?, ?)
            ON CONFLICT (month, measure, dimension) DO UPDATE SET value = excluded.value`,
      args: [month, Number(r.rows[0].n), createdAt],
    });
  }

  await client.execute({
    sql: `INSERT INTO rp_schedule (report_name, recipients, created_by, created_at)
          SELECT 'headcount_trend', 'hr.admin@example.com', 'seed', ?
          WHERE NOT EXISTS (SELECT 1 FROM rp_schedule WHERE report_name = 'headcount_trend')`,
    args: [createdAt],
  });

  notes.push("  24 months of headcount snapshots, and one scheduled report");
  return notes;
}
