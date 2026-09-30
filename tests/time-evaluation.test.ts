import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, rawClient } from "@/lib/db";
import { ptTimeEvaluation } from "@/db/schema";
import { evaluatePeriod } from "@/lib/engines/time-evaluation";
import { createArea, hireForPayroll } from "./support/payroll-fixtures";

/** Time evaluation, rewritten to read in bulk. Quota generation is now
 * policy-driven; see tests/leave-policies.test.ts. */

async function absence(employeeId: number, type: string, from: string, to: string, half = false) {
  await rawClient().execute({
    sql: `INSERT INTO pt_it2001_absence
            (employee_id, absence_type_code, start_date, end_date, payroll_days, calendar_days, is_half_day, created_by, created_at)
          VALUES (?, ?, ?, ?, 1, 1, ?, 'test', ?)`,
    args: [employeeId, type, from, to, half ? 1 : 0, new Date().toISOString()],
  });
}

describe("time evaluation", () => {
  it("counts working days, absences and unpaid days for the period", async () => {
    const area = await createArea();
    const id = await hireForPayroll({ area, hireDate: "2020-01-01", pay: [{ from: "2020-01-01", amountRupees: 1 }] });
    // July 2026: 23 working days. Two unpaid days, a paid half day.
    await absence(id, "0300", "2026-07-06", "2026-07-07");
    await absence(id, "0100", "2026-07-15", "2026-07-15", true);

    const [row] = await evaluatePeriod({ year: 2026, month: 7, employeeIds: [id] });
    expect(row).toMatchObject({ workingDays: 23, absentDays: 2.5, unpaidDays: 2, presentDays: 20.5 });
  });

  it("counts only the days a joiner was employed", async () => {
    const area = await createArea();
    const id = await hireForPayroll({ area, hireDate: "2026-07-20", pay: [{ from: "2026-07-20", amountRupees: 1 }] });
    const [row] = await evaluatePeriod({ year: 2026, month: 7, employeeIds: [id] });
    expect(row.workingDays).toBe(10); // 20 to 31 July
  });

  it("stores one row per person and month, however often it runs", async () => {
    const area = await createArea();
    const id = await hireForPayroll({ area, hireDate: "2020-01-01", pay: [{ from: "2020-01-01", amountRupees: 1 }] });
    await evaluatePeriod({ year: 2026, month: 8, employeeIds: [id] });
    await absence(id, "0300", "2026-08-03", "2026-08-03");
    await evaluatePeriod({ year: 2026, month: 8, employeeIds: [id] });

    const rows = await db
      .select()
      .from(ptTimeEvaluation)
      .where(and(eq(ptTimeEvaluation.employeeId, id), eq(ptTimeEvaluation.periodMonth, 8)));
    expect(rows).toHaveLength(1);
    expect(rows[0].unpaidDays).toBe(1);
  });
});
