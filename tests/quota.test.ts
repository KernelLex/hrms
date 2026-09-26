import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { ptAbsenceQuota } from "@/db/schema";
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

describe("working days", () => {
  it("skips weekends and public holidays", async () => {
    // 24–25 Jan 2026 is a weekend; 26 Jan is Republic Day, which is seeded.
    expect(calendarDaysBetween("2026-01-23", "2026-01-27")).toBe(5);
    expect(await workingDaysBetween("2026-01-23", "2026-01-27")).toBe(2);
  });

  it("charges nothing for a pure weekend", async () => {
    expect(await workingDaysBetween("2026-01-24", "2026-01-25")).toBe(0);
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
    consumeQuota({ employeeId, quotaTypeCode: "ANNUAL", year, units: daysToUnits(days) });

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
    await restoreQuota({
      employeeId,
      quotaTypeCode: "ANNUAL",
      year: 2026,
      units: daysToUnits(3.5),
    });
    expect(await used()).toBe(0);
  });

  it("never lets two requests at once spend the same days", async () => {
    // 10 days left; two approvals of 6 arrive together. One wins.
    const results = await Promise.all([take(6), take(6)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(await used()).toBe(daysToUnits(6));
    await restoreQuota({ employeeId, quotaTypeCode: "ANNUAL", year: 2026, units: daysToUnits(6) });
  });

  it("refuses to consume a quota that was never granted", async () => {
    expect((await take(1, 2099)).ok).toBe(false);
  });
});
