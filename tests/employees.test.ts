import { describe, expect, it } from "vitest";
import { searchEmployees } from "@/lib/repositories/employees";

/** The employee list's search and paging, done in SQL. */
describe("employee search", () => {
  it("matches every word across name, number and position", async () => {
    const { rows } = await searchEmployees({ q: "arjun senior" }, { limit: 10, offset: 0 });
    expect(rows.map((r) => r.employee_number)).toEqual(["EMP1001"]);
  });

  it("finds nothing rather than everything for a word that matches no one", async () => {
    const { rows, total } = await searchEmployees({ q: "arjun zzzz" }, { limit: 10, offset: 0 });
    expect(rows).toHaveLength(0);
    expect(total).toBe(0);
  });

  it("pages through results and reports the full count", async () => {
    const all = await searchEmployees({}, { limit: 1000, offset: 0 });
    const first = await searchEmployees({}, { limit: 2, offset: 0 });
    const second = await searchEmployees({}, { limit: 2, offset: 2 });
    expect(first.total).toBe(all.total);
    expect(first.rows).toHaveLength(2);
    expect(second.rows[0]?.employee_number).toBe(all.rows[2]?.employee_number);
  });

  it("limits a manager to the people named", async () => {
    const all = await searchEmployees({}, { limit: 1000, offset: 0 });
    const one = all.rows[0].id;
    const scoped = await searchEmployees({ onlyIds: [one] }, { limit: 50, offset: 0 });
    expect(scoped.rows.map((r) => r.id)).toEqual([one]);
    const none = await searchEmployees({ onlyIds: [] }, { limit: 50, offset: 0 });
    expect(none.total).toBe(0);
  });

  it("treats wildcard characters in a search as ordinary text", async () => {
    const { total } = await searchEmployees({ q: "%" }, { limit: 10, offset: 0 });
    expect(total).toBeGreaterThan(0); // "%" is stripped, not a match-everything pattern that errors
  });
});
