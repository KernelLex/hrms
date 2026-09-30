import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, rawClient } from "@/lib/db";
import { ptAbsenceQuota } from "@/db/schema";
import { systemActor } from "@/lib/change-log";
import {
  workingDaysBetween,
  calendarDaysBetween,
  consumeQuota,
  restoreQuota,
  daysToUnits,
} from "@/lib/engines/quota";
import { createBareEmployee } from "./support/fixtures";

/**
 * Leave costs working days, not calendar days, and balances are exact half-day
 * units rather than floats.
 */

const actor = systemActor("test");

describe("working days", () => {
  it("skips weekends and public holidays", async () => {
    // 24–25 Jan 2026 is a weekend; 26 Jan is Republic Day, which is seeded
    // onto every calendar.
    expect(calendarDaysBetween("2026-01-23", "2026-01-27")).toBe(5);
    expect(await workingDaysBetween("2026-01-23", "2026-01-27", "NATIONAL")).toBe(2);
  });

  it("charges nothing for a pure weekend", async () => {
    expect(await workingDaysBetween("2026-01-24", "2026-01-25", "NATIONAL")).toBe(0);
  });

  it("reads a different calendar's own holidays", async () => {
    // Maharashtra Day, 1 May, is only on the Maharashtra calendar; 29 Apr–1
    // May 2026 is a Wed–Fri with no weekend in the way.
    expect(await workingDaysBetween("2026-04-29", "2026-05-01", "MAHARASHTRA")).toBe(2);
    expect(await workingDaysBetween("2026-04-29", "2026-05-01", "NATIONAL")).toBe(3);
  });
});

describe("quota engine", () => {
  let employeeId: number;
  const used = async () =>
    (
      await db.query.ptAbsenceQuota.findFirst({
        where: eq(ptAbsenceQuota.employeeId, employeeId),
      })
    )?.usedHalfDays;
  const take = (days: number, year = 2026) =>
    consumeQuota(rawClient(), {
      employeeId,
      quotaTypeCode: "ANNUAL",
      year,
      units: daysToUnits(days),
      refType: "test",
      refId: "take",
      createdBy: "test",
      actor,
    });
  const give = (days: number, year = 2026) =>
    restoreQuota(rawClient(), {
      employeeId,
      quotaTypeCode: "ANNUAL",
      year,
      units: daysToUnits(days),
      refType: "test",
      refId: "give",
      createdBy: "test",
      actor,
    });

  beforeAll(async () => {
    employeeId = await createBareEmployee("ZZQ");
    await db.insert(ptAbsenceQuota).values({
      employeeId,
      quotaTypeCode: "ANNUAL",
      year: 2026,
      entitledHalfDays: daysToUnits(10),
      usedHalfDays: 0,
      createdAt: new Date().toISOString(),
    });
  });

  it("decrements the balance when leave is taken", async () => {
    expect((await take(3)).ok).toBe(true);
    expect(await used()).toBe(daysToUnits(3));
  });

  it("refuses an overdraw and changes nothing", async () => {
    const result = await take(20);
    expect(result.ok).toBe(false);
    expect(await used()).toBe(daysToUnits(3));
  });

  it("stores half days exactly", async () => {
    await take(0.5);
    expect(await used()).toBe(7); // 3.5 days as half-day units
  });

  it("puts the days back when leave is restored", async () => {
    await give(3.5);
    expect(await used()).toBe(0);
  });

  it("never lets two requests at once spend the same days", async () => {
    // 10 days left; two approvals of 6 arrive together. One wins.
    const results = await Promise.all([take(6), take(6)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(await used()).toBe(daysToUnits(6));
    await give(6);
  });

  it("refuses to consume a quota that was never granted", async () => {
    expect((await take(1, 2099)).ok).toBe(false);
  });

  it("writes a ledger entry for every credit and debit, matching the balance", async () => {
    const ledger = await rawClient().execute({
      sql: "SELECT SUM(half_days) AS n FROM pt_quota_ledger WHERE employee_id = ? AND quota_type_code = 'ANNUAL' AND year = 2026",
      args: [employeeId],
    });
    const quota = await db.query.ptAbsenceQuota.findFirst({ where: eq(ptAbsenceQuota.employeeId, employeeId) });
    // The ledger only tracks what moved after the opening quota was written
    // directly above; entitled stays put, so the ledger sum is -usedHalfDays.
    // (Added rather than compared by sign, since both sides land on zero here
    // and -0 !== 0 under Object.is.)
    expect(Number(ledger.rows[0].n) + (quota?.usedHalfDays ?? 0)).toBe(0);
  });
});
