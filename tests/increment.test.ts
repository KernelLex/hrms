import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, rawClient } from "@/lib/db";
import {
  pmAppraisalCycle,
  pmAppraisal,
  pmCalibration,
  pmIncrementRecommendation,
  OPEN_ENDED,
} from "@/db/schema";
import { readAsOf, readHistory, SLICED_TABLES } from "@/lib/engines/timeslice";
import {
  generateIncrements,
  approveIncrement,
  pushIncrementsToPayroll,
} from "@/app/actions/performance";
import { createBareEmployee, form } from "./support/fixtures";

/**
 * The increment push, performance into payroll: an approved increment becomes
 * a new basic-pay record through the time-slice engine rather than an update
 * in place. The chain runs in order, each step on what the last one left.
 */

const EFFECTIVE = "2026-04-01";
const OLD_SALARY = 6_000_000; // ₹60,000

let employeeId: number;
let cycleId: number;

const recommendation = () =>
  db.query.pmIncrementRecommendation.findFirst({
    where: and(
      eq(pmIncrementRecommendation.cycleId, cycleId),
      eq(pmIncrementRecommendation.employeeId, employeeId),
    ),
  });

type Pay = { valid_from: string; valid_to: string; amount_paise: number; source_ref: string };
const history = () => readHistory<Pay>(SLICED_TABLES.basicPay, employeeId);

describe("increment push", () => {
  beforeAll(async () => {
    employeeId = await createBareEmployee("ZZINC");

    await rawClient().execute({
      sql: `INSERT INTO pa_it0008_basic_pay
            (employee_id, valid_from, valid_to, seq, created_by, created_at,
             pay_scale_type, pay_scale_area, pay_scale_group, amount_paise, currency)
            VALUES (?, '2024-01-01', ?, 1, 'test', ?,
             'Monthly salaried', 'Bengaluru', 'L2', ?, 'INR')`,
      args: [employeeId, OPEN_ENDED, new Date().toISOString(), OLD_SALARY],
    });

    const [cycle] = await db
      .insert(pmAppraisalCycle)
      .values({
        name: "Increment test cycle",
        periodLabel: "test",
        startDate: "2025-04-01",
        endDate: "2026-03-31",
        templateCode: "STANDARD",
        status: "Active",
        createdAt: new Date().toISOString(),
      })
      .returning({ id: pmAppraisalCycle.id });
    cycleId = cycle.id;

    const [appraisal] = await db
      .insert(pmAppraisal)
      .values({
        cycleId,
        employeeId,
        selfRating: 4,
        managerRating: 4,
        status: "Completed",
        updatedAt: new Date().toISOString(),
      })
      .returning({ id: pmAppraisal.id });

    await db.insert(pmCalibration).values({
      appraisalId: appraisal.id,
      calibratedRating: 4,
      status: "Finalised",
      finalisedBy: "test",
      finalisedAt: new Date().toISOString(),
    });
  });

  it("turns a finalised rating into a draft increment", async () => {
    const result = await generateIncrements({}, form({ cycleId, effectiveDate: EFFECTIVE }));
    expect(result.error).toBeUndefined();
    expect((await recommendation())?.status).toBe("Draft");
  });

  it("applies the increment to the current salary", async () => {
    const rec = (await recommendation())!;
    expect(rec.currentSalaryPaise).toBe(OLD_SALARY);
    expect(rec.newSalaryPaise).toBe(
      rec.currentSalaryPaise +
        Math.round((rec.currentSalaryPaise * rec.incrementBasisPoints) / 10_000),
    );
  });

  it("refuses to push a draft", async () => {
    const result = await pushIncrementsToPayroll({}, form({ cycleId }));
    expect(result.ok).not.toBe(true);
    expect(result.error).toBeTruthy();
  });

  it("pushes once approved", async () => {
    const rec = (await recommendation())!;
    await approveIncrement({}, form({ id: rec.id }));
    const result = await pushIncrementsToPayroll({}, form({ cycleId }));
    expect(result.error).toBeUndefined();
    expect((await recommendation())?.status).toBe("Pushed");
  });

  it("leaves basic pay with two records rather than one overwritten", async () => {
    const h = await history();
    expect(h).toHaveLength(2);
    expect(h.map((x) => x.valid_from).sort()).toEqual(["2024-01-01", EFFECTIVE]);
  });

  it("delimits the old salary rather than destroying it", async () => {
    const older = (await history()).find((x) => x.valid_from === "2024-01-01");
    expect(older?.valid_to).toBe("2026-03-31");
    expect(Number(older?.amount_paise)).toBe(OLD_SALARY);
  });

  it("gives payroll the old figure before the date and the new one after", async () => {
    const rec = (await recommendation())!;
    const before = await readAsOf<Pay>(SLICED_TABLES.basicPay, employeeId, "2026-01-15");
    const after = await readAsOf<Pay>(SLICED_TABLES.basicPay, employeeId, "2026-06-15");
    expect(Number(before?.amount_paise)).toBe(OLD_SALARY);
    expect(Number(after?.amount_paise)).toBe(rec.newSalaryPaise);
  });

  it("records where the new salary came from", async () => {
    const newer = (await history()).find((x) => x.valid_from === EFFECTIVE);
    expect(newer?.source_ref).toContain("Increment");
  });

  it("does nothing when pushed a second time", async () => {
    const again = await pushIncrementsToPayroll({}, form({ cycleId }));
    expect(again.ok).not.toBe(true);
    expect(await history()).toHaveLength(2);
  });
});
