import { randomUUID } from "node:crypto";
import { rawClient } from "@/lib/db";

/**
 * A bare employee with no infotypes, for tests that build exactly the records
 * they need. The number is unique across test files; the database is fresh
 * for each run, so nothing needs cleaning up afterwards.
 */
export async function createBareEmployee(prefix = "ZZ"): Promise<number> {
  const created = await rawClient().execute({
    sql: `INSERT INTO pa_employee (employee_number, hire_date, employment_status, created_at)
          VALUES (?, '2020-01-01', 'Active', ?) RETURNING id`,
    args: [`${prefix}${randomUUID().slice(0, 8)}`, new Date().toISOString()],
  });
  return Number(created.rows[0].id);
}

/** A FormData from a plain object, the way a Server Function receives it. */
export function form(values: Record<string, string | number | File>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) f.set(k, v instanceof File ? v : String(v));
  return f;
}
