import { describe, expect, it } from "vitest";
import { reports } from "@/lib/repositories/reports";

/** The reports page's aggregates, against the seeded organisation. */
describe("HR reports", () => {
  it("splits today's headcount across departments without losing anyone", async () => {
    const r = await reports("2026-09-26");
    expect(r.headcount).toBeGreaterThanOrEqual(3);
    expect(r.byDepartment.reduce((s, d) => s + d.value, 0)).toBe(r.headcount);
    expect(r.financialYear).toBe("2026-27");
  });

  it("measures attrition as a share of headcount", async () => {
    const r = await reports("2026-09-26");
    expect(r.attrition).not.toBeNull();
    expect(r.attrition!).toBeGreaterThanOrEqual(0);
  });
});
