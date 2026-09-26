import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { paEmployee } from "@/db/schema";
import { hrHome, selfHome, teamHome, celebrationsBetween } from "@/lib/repositories/home";
import { listDirectReports } from "@/lib/repositories/employees";

/**
 * The three home screens read through hand-written SQL, so these run each one
 * against the seeded organisation: a table or column name that does not exist
 * fails here rather than on someone's home screen.
 *
 * Other test files add throwaway employees to the same database, so counts
 * are asserted as lower bounds where those could move them.
 */

const TODAY = "2026-09-26";

async function employeeId(number: string): Promise<number> {
  const e = await db.query.paEmployee.findFirst({ where: eq(paEmployee.employeeNumber, number) });
  if (!e) throw new Error(`Seeded employee ${number} is missing.`);
  return e.id;
}

describe("HR home", () => {
  it("counts what the seed leaves waiting", async () => {
    const h = await hrHome(TODAY);
    expect(h.headcount).toBeGreaterThanOrEqual(3);
    expect(h.positions).toBeGreaterThanOrEqual(4);
    expect(h.vacancies).toBeGreaterThanOrEqual(1);
    expect(h.pendingLeave).toBeGreaterThanOrEqual(1); // Arjun's December request
    expect(h.offered).toBeGreaterThanOrEqual(1); // the candidate ready to convert
  });

  it("names the month whose payroll has not been run", async () => {
    const h = await hrHome(TODAY);
    // The seed opens a period for the current month and runs nothing.
    const now = new Date();
    expect(h.unrunPeriods).toContainEqual(
      expect.objectContaining({ year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 }),
    );
  });

  it("lists coming events in date order", async () => {
    const h = await hrHome(TODAY);
    const dates = h.upcoming.map((e) => e.date);
    expect([...dates].sort()).toEqual(dates);
    expect(dates.every((d) => d >= TODAY)).toBe(true);
  });
});

describe("employee home", () => {
  it("reads an employee's own leave, appraisal and tax position", async () => {
    const arjun = await employeeId("EMP1001");
    const year = new Date().getUTCFullYear();
    const s = await selfHome(arjun, `${year}-09-26`);

    expect(s.annualEntitled).toBe(36); // 18 days in half-day units
    expect(s.pendingRequests).toBe(1);
    expect(s.appraisal?.cycleName).toBeTruthy();
    expect(s.financialYear).toBe(`${year}-${String((year + 1) % 100).padStart(2, "0")}`);
  });

  it("shows the calibrated rating only once finalised", async () => {
    const arjun = await employeeId("EMP1001");
    const s = await selfHome(arjun, TODAY);
    if (s.appraisal && s.appraisal.status !== "Completed") {
      expect(s.appraisal.finalRating).toBeNull();
    }
  });
});

describe("manager home", () => {
  it("covers only the manager's direct reports", async () => {
    const ravi = await employeeId("EMP1000");
    const reports = await listDirectReports(ravi, TODAY);
    const t = await teamHome(
      reports.map((r) => r.id),
      TODAY,
    );
    expect(t.teamSize).toBe(reports.length);
    expect(t.teamSize).toBeGreaterThan(0);
  });

  it("returns an empty team without querying for one", async () => {
    const t = await teamHome([], TODAY);
    expect(t).toEqual({
      teamSize: 0,
      pendingLeave: 0,
      awaitingRating: 0,
      awayThisWeek: 0,
      upcoming: [],
    });
  });
});

describe("birthdays and work anniversaries", () => {
  it("finds a birthday in the window", async () => {
    const arjun = await employeeId("EMP1001"); // born 21 August
    const events = await celebrationsBetween("2026-08-15", 14, [arjun]);
    expect(events).toContainEqual(
      expect.objectContaining({ kind: "birthday", date: "2026-08-21", title: "Arjun Mehta" }),
    );
  });

  it("counts the years of service across the new year", async () => {
    const arjun = await employeeId("EMP1001"); // joined 15 January 2024
    const events = await celebrationsBetween("2026-12-25", 30, [arjun]);
    expect(events).toContainEqual(
      expect.objectContaining({ kind: "anniversary", date: "2027-01-15", detail: "3 years at the company" }),
    );
  });

  it("finds nothing for an empty team", async () => {
    expect(await celebrationsBetween("2026-08-15", 14, [])).toEqual([]);
  });
});
