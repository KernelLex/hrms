import { describe, expect, it } from "vitest";
import { db, rawClient } from "@/lib/db";
import { ptAbsenceQuota } from "@/db/schema";
import { systemActor } from "@/lib/change-log";
import { workingDaysBetween, consumeQuota, daysToUnits } from "@/lib/engines/quota";
import { accrueForPeriod, runYearEnd, forecastBalance, earnCompOff, compOffBalance, consumeCompOff, expireCompOffs, encashLeave } from "@/lib/engines/leave-policy";
import { calculateEmployee } from "@/lib/engines/payroll";
import { createBareEmployee } from "./support/fixtures";
import { createArea, hireForPayroll } from "./support/payroll-fixtures";

/**
 * The leave-policy engine: accrual (with pro-ration for a joiner), the
 * year-end close, comp-off, and encashment — each covering one of Phase 16's
 * "done when" criteria, on top of the calendar and quota coverage already in
 * tests/quota.test.ts.
 *
 * accrueForPeriod and runYearEnd run company-wide by design, the same as the
 * daily job calls them — every test here passes employeeIds so it only ever
 * touches the employee it just created, never the seeded demo staff or
 * another test file's.
 */

const actor = systemActor("test");

async function hire(hireDate: string, prefix = "ZZL"): Promise<number> {
  const created = await rawClient().execute({
    sql: `INSERT INTO pa_employee (employee_number, hire_date, employment_status, created_at)
          VALUES (?, ?, 'Active', ?) RETURNING id`,
    args: [`${prefix}${Math.random().toString(36).slice(2, 10).toUpperCase()}`, hireDate, new Date().toISOString()],
  });
  return Number(created.rows[0].id);
}

const balanceOf = async (employeeId: number, quotaTypeCode: string, year: number) =>
  db.query.ptAbsenceQuota.findFirst({ where: (t, { and, eq }) => and(eq(t.employeeId, employeeId), eq(t.quotaTypeCode, quotaTypeCode), eq(t.year, year)) });

const ledgerSum = async (employeeId: number, quotaTypeCode: string, year: number) => {
  const r = await rawClient().execute({
    sql: "SELECT COALESCE(SUM(half_days), 0) AS n FROM pt_quota_ledger WHERE employee_id = ? AND quota_type_code = ? AND year = ?",
    args: [employeeId, quotaTypeCode, year],
  });
  return Number(r.rows[0].n);
};

describe("monthly and yearly accrual", () => {
  it("gives a joiner a pro-rated yearly entitlement instead of the full year's", async () => {
    // ANNUAL-STD is yearly, 36 half days (18 days), pro-rated for joiners.
    // Hired 1 July: from then to 31 Dec is roughly half the year.
    const employeeId = await hire("2026-07-01");
    await accrueForPeriod(rawClient(), { year: 2026, month: 7, employeeIds: [employeeId], createdBy: "test", actor });

    const balance = await balanceOf(employeeId, "ANNUAL", 2026);
    expect(balance).toBeDefined();
    expect(balance!.entitledHalfDays).toBeGreaterThan(0);
    expect(balance!.entitledHalfDays).toBeLessThan(36);
    // Roughly half: 1 July to 31 Dec is 184 of 365 days.
    const expected = Math.round((36 * 184) / 365);
    expect(balance!.entitledHalfDays).toBe(expected);
  });

  it("grants the full entitlement to someone employed all year", async () => {
    const employeeId = await hire("2020-01-01");
    await accrueForPeriod(rawClient(), { year: 2026, month: 7, employeeIds: [employeeId], createdBy: "test", actor });
    const balance = await balanceOf(employeeId, "ANNUAL", 2026);
    expect(balance!.entitledHalfDays).toBe(36);
  });

  it("accrues sick leave a twelfth of the year at a time, monthly", async () => {
    const employeeId = await hire("2020-01-01");
    await accrueForPeriod(rawClient(), { year: 2026, month: 1, employeeIds: [employeeId], createdBy: "test", actor });
    const afterOne = await balanceOf(employeeId, "SICK", 2026);
    expect(afterOne!.entitledHalfDays).toBe(2); // 24/12

    await accrueForPeriod(rawClient(), { year: 2026, month: 2, employeeIds: [employeeId], createdBy: "test", actor });
    const afterTwo = await balanceOf(employeeId, "SICK", 2026);
    expect(afterTwo!.entitledHalfDays).toBe(4);
  });

  it("never grants the same period twice", async () => {
    const employeeId = await hire("2020-01-01");
    await accrueForPeriod(rawClient(), { year: 2026, month: 3, employeeIds: [employeeId], createdBy: "test", actor });
    await accrueForPeriod(rawClient(), { year: 2026, month: 3, employeeIds: [employeeId], createdBy: "test", actor });
    const balance = await balanceOf(employeeId, "SICK", 2026);
    expect(balance!.entitledHalfDays).toBe(2);
  });

  it("does not pro-rate casual leave for a joiner, by policy", async () => {
    // CASUAL-STD has proRataForJoiners: false.
    const employeeId = await hire("2026-09-01");
    await accrueForPeriod(rawClient(), { year: 2026, month: 9, employeeIds: [employeeId], createdBy: "test", actor });
    const balance = await balanceOf(employeeId, "CASUAL", 2026);
    expect(balance!.entitledHalfDays).toBe(12); // the full 6 days, not pro-rated
  });
});

describe("year end", () => {
  it("carries forward up to the cap and lapses the rest, each its own ledger entry", async () => {
    const employeeId = await createBareEmployee("ZZY");
    await db.insert(ptAbsenceQuota).values({
      employeeId,
      quotaTypeCode: "ANNUAL",
      year: 2024,
      entitledHalfDays: 36, // 18 days
      usedHalfDays: 6, // 3 taken; 15 days (30 units) remain
      createdAt: new Date().toISOString(),
    });

    const result = await runYearEnd(rawClient(), { year: 2024, employeeIds: [employeeId], createdBy: "test", actor });
    expect(result.processed).toBeGreaterThan(0);

    // ANNUAL-STD's cap is 10 half days (5 days): 10 carry forward, 20 lapse.
    const ledger = await rawClient().execute({
      sql: "SELECT entry_type, half_days FROM pt_quota_ledger WHERE employee_id = ? AND quota_type_code = 'ANNUAL' AND year = 2024 ORDER BY id",
      args: [employeeId],
    });
    const byType = Object.fromEntries(ledger.rows.map((r) => [String(r.entry_type), Number(r.half_days)]));
    expect(byType.CarryForward).toBe(-10);
    expect(byType.Lapse).toBe(-20);

    const closed2024 = await balanceOf(employeeId, "ANNUAL", 2024);
    expect(closed2024!.entitledHalfDays - closed2024!.usedHalfDays).toBe(0);

    const opened2025 = await balanceOf(employeeId, "ANNUAL", 2025);
    expect(opened2025!.entitledHalfDays - opened2025!.usedHalfDays).toBe(10);

    // Running it again for the same year changes nothing further.
    await runYearEnd(rawClient(), { year: 2024, employeeIds: [employeeId], createdBy: "test", actor });
    const stillClosed = await balanceOf(employeeId, "ANNUAL", 2024);
    expect(stillClosed!.entitledHalfDays - stillClosed!.usedHalfDays).toBe(0);
  });

  it("leaves a balance under the cap alone, save for closing the year at zero", async () => {
    const employeeId = await createBareEmployee("ZZY");
    await db.insert(ptAbsenceQuota).values({
      employeeId,
      quotaTypeCode: "ANNUAL",
      year: 2024,
      entitledHalfDays: 20,
      usedHalfDays: 16, // 4 units (2 days) remain, under the 10-unit cap
      createdAt: new Date().toISOString(),
    });
    await runYearEnd(rawClient(), { year: 2024, employeeIds: [employeeId], createdBy: "test", actor });

    const ledger = await rawClient().execute({
      sql: "SELECT entry_type FROM pt_quota_ledger WHERE employee_id = ? AND quota_type_code = 'ANNUAL' AND year = 2024",
      args: [employeeId],
    });
    expect(ledger.rows.map((r) => String(r.entry_type))).toEqual(["CarryForward"]);
    const opened2025 = await balanceOf(employeeId, "ANNUAL", 2025);
    expect(opened2025!.entitledHalfDays - opened2025!.usedHalfDays).toBe(4);
  });

  it("respects a policy's own lapse date when asOf is given", async () => {
    const employeeId = await createBareEmployee("ZZY");
    await db.insert(ptAbsenceQuota).values({
      employeeId,
      quotaTypeCode: "ANNUAL",
      year: 2023,
      entitledHalfDays: 10,
      usedHalfDays: 0,
      createdAt: new Date().toISOString(),
    });
    // ANNUAL-STD lapses on 03-31; well before that, nothing closes.
    await runYearEnd(rawClient(), { year: 2023, asOf: "01-15", employeeIds: [employeeId], createdBy: "test", actor });
    const untouched = await balanceOf(employeeId, "ANNUAL", 2023);
    expect(untouched!.entitledHalfDays - untouched!.usedHalfDays).toBe(10);

    await runYearEnd(rawClient(), { year: 2023, asOf: "03-31", employeeIds: [employeeId], createdBy: "test", actor });
    const closed = await balanceOf(employeeId, "ANNUAL", 2023);
    expect(closed!.entitledHalfDays - closed!.usedHalfDays).toBe(0);
  });
});

describe("a balance always equals its ledger sum", () => {
  it("holds across accrual, consumption, restoration and encashment", async () => {
    const employeeId = await hire("2020-01-01");
    await rawClient().execute({
      sql: `INSERT INTO pa_it0008_basic_pay (employee_id, pay_scale_type, pay_scale_group, amount_paise, currency, valid_from, valid_to, seq, created_by, created_at)
            VALUES (?, 'Monthly salaried', 'L1', 6000000, 'INR', '2020-01-01', '9999-12-31', 1, 'test', ?)`,
      args: [employeeId, new Date().toISOString()],
    });

    await accrueForPeriod(rawClient(), { year: 2026, month: 9, employeeIds: [employeeId], createdBy: "test", actor });
    const taken = await consumeQuota(rawClient(), { employeeId, quotaTypeCode: "ANNUAL", year: 2026, units: daysToUnits(2), refType: "test", refId: "x", createdBy: "test", actor });
    expect(taken.ok).toBe(true);
    const cashed = await encashLeave(rawClient(), { employeeId, quotaTypeCode: "ANNUAL", year: 2026, days: 1, paymentDate: "2026-09-15", createdBy: "test", actor });
    expect(cashed.ok).toBe(true);

    const balance = await balanceOf(employeeId, "ANNUAL", 2026);
    const sum = await ledgerSum(employeeId, "ANNUAL", 2026);
    expect(balance!.entitledHalfDays - balance!.usedHalfDays).toBe(sum);
  });
});

describe("forecast", () => {
  it("adds monthly accrual still to come before the forecast date", async () => {
    const employeeId = await hire("2020-01-01");
    await accrueForPeriod(rawClient(), { year: 2026, month: 9, employeeIds: [employeeId], createdBy: "test", actor });
    const current = await balanceOf(employeeId, "SICK", 2026);
    const forecast = await forecastBalance(employeeId, "SICK", "2026-12-31");
    // From today (Sept 2026) to December is 3 more months at 2 units each.
    expect(forecast).toBe(current!.entitledHalfDays - current!.usedHalfDays + 6);
  });
});

describe("compensatory off", () => {
  it("is earned, spent oldest-expiring first, and expires on its date", async () => {
    const employeeId = await createBareEmployee("ZZC");
    await earnCompOff(rawClient(), { employeeId, earnedOn: "2026-08-01", halfDays: 2, expiryDays: 30, createdBy: "test", actor });
    await earnCompOff(rawClient(), { employeeId, earnedOn: "2026-08-15", halfDays: 2, expiryDays: 90, createdBy: "test", actor });

    const balance = await compOffBalance(employeeId, "2026-08-16");
    expect(balance.availableHalfDays).toBe(4);

    const spent = await consumeCompOff(rawClient(), { employeeId, halfDays: 1, refType: "test", refId: "y", asOf: "2026-08-16", createdBy: "test", actor });
    expect(spent.ok).toBe(true);
    const afterSpend = await compOffBalance(employeeId, "2026-08-16");
    expect(afterSpend.availableHalfDays).toBe(3);

    const expired = await expireCompOffs(rawClient(), { asOf: "2026-09-05", actor });
    expect(expired.expired).toBeGreaterThanOrEqual(1); // at least this employee's 30-day grant, earned 1 Aug, expired 31 Aug
    const afterExpiry = await compOffBalance(employeeId, "2026-09-05");
    expect(afterExpiry.availableHalfDays).toBe(2);
  });

  it("refuses to overdraw", async () => {
    const employeeId = await createBareEmployee("ZZC");
    await earnCompOff(rawClient(), { employeeId, earnedOn: "2026-08-01", halfDays: 1, createdBy: "test", actor });
    const result = await consumeCompOff(rawClient(), { employeeId, halfDays: 4, refType: "test", refId: "z", createdBy: "test", actor });
    expect(result.ok).toBe(false);
  });
});

describe("encashment", () => {
  it("pays five days at the daily rate through the next payroll run", async () => {
    const area = await createArea();
    const employeeId = await hireForPayroll({ area, hireDate: "2020-01-01", pay: [{ from: "2020-01-01", amountRupees: 60_000 }] });
    await db.insert(ptAbsenceQuota).values({
      employeeId,
      quotaTypeCode: "ANNUAL",
      year: 2026,
      entitledHalfDays: 36,
      usedHalfDays: 0,
      createdAt: new Date().toISOString(),
    });

    const result = await encashLeave(rawClient(), {
      employeeId,
      quotaTypeCode: "ANNUAL",
      year: 2026,
      days: 5,
      paymentDate: "2026-09-15",
      createdBy: "test",
      actor,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const w = await workingDaysBetween("2026-09-01", "2026-09-30", "NATIONAL");
    const expectedAmount = Math.round(Math.round(6_000_000 / w) * 10 / 2);
    expect(result.amountPaise).toBe(expectedAmount);

    const balance = await balanceOf(employeeId, "ANNUAL", 2026);
    expect(balance!.entitledHalfDays - balance!.usedHalfDays).toBe(26); // 18 - 5 days

    const paid = await calculateEmployee({ employeeId, year: 2026, month: 9 });
    const lenc = paid.lines.find((l) => l.wageTypeCode === "LENC");
    expect(lenc).toBeDefined();
    expect(lenc!.amountPaise).toBe(expectedAmount);
  });

  it("refuses to encash beyond what the policy allows for the year", async () => {
    const employeeId = await hire("2020-01-01");
    await db.insert(ptAbsenceQuota).values({
      employeeId,
      quotaTypeCode: "ANNUAL",
      year: 2026,
      entitledHalfDays: 100,
      usedHalfDays: 0,
      createdAt: new Date().toISOString(),
    });
    // ANNUAL-STD allows encashing at most 10 half days (5 days) a year.
    const result = await encashLeave(rawClient(), { employeeId, quotaTypeCode: "ANNUAL", year: 2026, days: 6, paymentDate: "2026-09-15", createdBy: "test", actor });
    expect(result.ok).toBe(false);
  });
});

describe("calendars in payroll", () => {
  it("prorates Karnataka and Maharashtra against their own working days", async () => {
    // May 2026: Maharashtra Day (1 May) is a Friday, a working day everywhere
    // except on the Maharashtra calendar.
    const karnataka = await createArea();
    const maharashtra = await createArea();
    await rawClient().execute({ sql: "UPDATE om_personnel_area SET calendar_code = 'KARNATAKA' WHERE code = ?", args: [karnataka] });
    await rawClient().execute({ sql: "UPDATE om_personnel_area SET calendar_code = 'MAHARASHTRA' WHERE code = ?", args: [maharashtra] });

    const inKarnataka = await hireForPayroll({ area: karnataka, hireDate: "2020-01-01", pay: [{ from: "2020-01-01", amountRupees: 30_000 }] });
    const inMaharashtra = await hireForPayroll({ area: maharashtra, hireDate: "2020-01-01", pay: [{ from: "2020-01-01", amountRupees: 30_000 }] });

    const [kResult, mResult] = await Promise.all([
      calculateEmployee({ employeeId: inKarnataka, year: 2026, month: 5 }),
      calculateEmployee({ employeeId: inMaharashtra, year: 2026, month: 5 }),
    ]);
    expect(kResult.workingDays).toBe(mResult.workingDays + 1);
  });
});
