import { describe, expect, it } from "vitest";
import { runPayroll } from "@/lib/engines/payroll";
import { saveTimeSlice, SLICED_TABLES } from "@/lib/engines/timeslice";
import { varianceFor } from "@/lib/repositories/variance";
import { createArea, createPeriod, hireForPayroll, postPeriod } from "./support/payroll-fixtures";

/** The check before posting: who is new, whose pay moved, and why. */
describe("payroll variance", () => {
  it("flags new people and big moves, and says why", async () => {
    const area = await createArea();
    const steady = await hireForPayroll({ area, hireDate: "2020-01-01", pay: [{ from: "2020-01-01", amountRupees: 40_000 }] });
    const raised = await hireForPayroll({ area, hireDate: "2020-01-01", pay: [{ from: "2020-01-01", amountRupees: 40_000 }] });

    const may = await createPeriod(area, 2026, 5);
    const first = await runPayroll({ periodId: may, runBy: "test" });
    await postPeriod(may);

    // Everyone is new in the first run.
    const initial = await varianceFor(first.runId);
    expect(initial.flagged.map((v) => v.reasons[0])).toEqual([
      "first payroll in the system",
      "first payroll in the system",
    ]);

    // A 25% raise from June for one of them.
    await saveTimeSlice({
      table: SLICED_TABLES.basicPay,
      employeeId: raised,
      validFrom: "2026-06-01",
      data: { pay_scale_type: "Monthly salaried", pay_scale_area: null, pay_scale_group: "L1", amount_paise: 5_000_000, currency: "INR" },
      createdBy: "test",
    });
    const june = await createPeriod(area, 2026, 6);
    const second = await runPayroll({ periodId: june, runBy: "test" });

    const check = await varianceFor(second.runId);
    expect(check.checked).toBe(2);
    expect(check.flagged.map((v) => v.employeeId)).toEqual([raised]);
    expect(check.flagged[0].change).toBeGreaterThan(0.1);
    expect(check.flagged[0].reasons).toEqual(["basic pay changed from ₹40,000 to ₹50,000"]);
    expect(check.flagged.some((v) => v.employeeId === steady)).toBe(false);
  });
});
