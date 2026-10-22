import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { rawClient } from "@/lib/db";
import { saveComponent, saveCompanyComponent, saveCityCategory, saveDeclaration, saveRent } from "@/app/actions/tax";
import { componentsFor, rollUp, hraExemptionFor, isMetroCity } from "@/lib/services/tax-components";
import { form } from "./support/fixtures";
import { actAs, createPerson, type Person } from "./support/people";

/**
 * What may be declared is the country's catalogue, narrowed by what a
 * company offers — and HRA is worked out from rent, salary and city rather
 * than typed in, which is what makes Delhi and Bengaluru differ.
 */

const uid = () => randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase();
const one = async (sql: string, args: (string | number)[] = []) =>
  (await rawClient().execute({ sql, args })).rows[0] as Record<string, unknown> | undefined;
const rupees = (n: number) => n * 100;

/** ₹50,000 a month of basic, which is what the three-way minimum works from. */
async function givePay(employeeId: number): Promise<void> {
  await rawClient().execute({
    sql: `INSERT INTO pa_it0008_basic_pay (employee_id, pay_scale_type, pay_scale_group, amount_paise, currency,
            valid_from, valid_to, seq, created_by, created_at)
          VALUES (?, 'Monthly salaried', 'L2', ?, 'INR', '2000-01-01', '9999-12-31', 1, 'test', ?)`,
    args: [employeeId, rupees(50_000), new Date().toISOString()],
  });
}

afterEach(() => actAs(null));

describe("the catalogue", () => {
  it("is what a company offers, with its own cap never above the law's", async () => {
    const code = `X${uid()}`;
    expect(
      (await saveComponent({}, form({ country: "India", code, name: "A test deduction", kind: "chapter_via", cap: "50000", sortOrder: "500", requiresProof: "on", isActive: "on" }))).ok,
    ).toBe(true);

    const offered = await componentsFor("CO01");
    expect(offered.find((c) => c.code === code)).toMatchObject({ capPaise: rupees(50_000), kind: "chapter_via" });
    // Everything the country defines is offered until a company says otherwise.
    expect(offered.map((c) => c.code)).toContain("80C");

    // A company may be stricter.
    const tightened = await saveCompanyComponent({}, form({ companyCode: "CO01", [`enabled.${code}`]: "on", [`cap.${code}`]: "20000", "enabled.80C": "on" }));
    expect(tightened.ok, tightened.error ?? "").toBe(true);
    expect((await componentsFor("CO01")).find((c) => c.code === code)?.capPaise).toBe(rupees(20_000));

    // Never looser.
    const tooHigh = await saveCompanyComponent({}, form({ companyCode: "CO01", [`enabled.${code}`]: "on", [`cap.${code}`]: "90000" }));
    expect(tooHigh.error).toMatch(/cannot be capped above/);

    // And may switch one off entirely.
    expect((await saveCompanyComponent({}, form({ companyCode: "CO01", [`cap.${code}`]: "" }))).ok).toBe(true);
    expect((await componentsFor("CO01")).map((c) => c.code)).not.toContain(code);

    // Put it back for the tests that follow.
    await rawClient().execute({ sql: "DELETE FROM tx_company_component WHERE company_code = 'CO01'", args: [] });
  });

  it("sums declared lines by kind, capping each line against its own component", async () => {
    const components = await componentsFor("CO01");
    const totals = rollUp(
      [
        { componentCode: "80C", declaredPaise: rupees(2_00_000) }, // over the ₹1,50,000 cap
        { componentCode: "80D", declaredPaise: rupees(20_000) },
        { componentCode: "HRA", declaredPaise: rupees(1_00_000) },
        { componentCode: "OTHER_INCOME", declaredPaise: rupees(30_000) },
        { componentCode: "NOSUCH", declaredPaise: rupees(99_000) }, // no component, no effect
      ],
      components,
    );
    expect(totals).toEqual({
      // 80C capped to 1,50,000 plus 80D's 20,000
      chapterViaPaise: rupees(1_70_000),
      section10ExemptPaise: rupees(1_00_000),
      otherIncomePaise: rupees(30_000),
    });
  });
});

describe("HRA, worked out rather than typed", () => {
  /** Someone on a known basic, renting, in a named city. */
  async function renter(city: string, monthlyRent: number): Promise<Person> {
    const person = await createPerson({ roles: ["EMPLOYEE"] });
    await givePay(person.employeeId);
    await rawClient().execute({
      sql: `INSERT INTO pa_it0006_address (employee_id, address_type, line, city, valid_from, valid_to, seq, created_by, created_at)
            VALUES (?, 'Permanent', 'A street', ?, '2000-01-01', '9999-12-31', 1, 'test', ?)`,
      args: [person.employeeId, city, new Date().toISOString()],
    });
    actAs(person.session);
    const saved = await saveRent(
      {},
      form({
        financialYear: "2026-27",
        monthlyRent: String(monthlyRent),
        landlordName: "A landlord",
        landlordPan: "ABCPK5678L",
        accommodationType: "Rented",
        ...((await isMetroCity("India", city)) ? { isMetro: "on" } : {}),
      }),
    );
    actAs(null);
    expect(saved.ok, saved.error ?? "").toBe(true);
    return person;
  }

  it("gives Delhi half of basic and Bengaluru two fifths, on identical pay and rent", async () => {
    expect(await isMetroCity("India", "Delhi")).toBe(true);
    expect(await isMetroCity("India", "Bengaluru")).toBe(false);

    // The city limit only bites when HRA is actually paid above two fifths
    // of basic — at the seeded 40% the two cities tie, because what they
    // receive binds before the city does. Companies that employ people in
    // metros pay 50% for exactly this reason, so that is what is tested.
    const before = await one("SELECT percent_basis_points FROM py_wage_type WHERE code = 'HRA'");
    await rawClient().execute({ sql: "UPDATE py_wage_type SET percent_basis_points = 5000 WHERE code = 'HRA'", args: [] });
    try {
      const inDelhi = await renter("Delhi", 40_000);
      const inBengaluru = await renter("Bengaluru", 40_000);

      const delhi = await hraExemptionFor(inDelhi.employeeId, "2026-27", "2026-06-01");
      const bengaluru = await hraExemptionFor(inBengaluru.employeeId, "2026-27", "2026-06-01");

      // Half and two fifths of a ₹6,00,000 annual basic. Same pay, same
      // rent, same employer — ₹60,000 of exemption between them.
      expect(delhi).toBe(rupees(3_00_000));
      expect(bengaluru).toBe(rupees(2_40_000));
    } finally {
      await rawClient().execute({
        sql: "UPDATE py_wage_type SET percent_basis_points = ? WHERE code = 'HRA'",
        args: [Number(before?.percent_basis_points ?? 4000)],
      });
    }
  });

  it("ties the two cities when HRA is paid at two fifths, because what they receive binds first", async () => {
    const inDelhi = await renter("Delhi", 40_000);
    const inBengaluru = await renter("Bengaluru", 40_000);
    // Both get 40% of basic: the metro ceiling is higher than that, so it
    // never comes into play. This is the law working, not a bug.
    expect(await hraExemptionFor(inDelhi.employeeId, "2026-27", "2026-06-01")).toBe(rupees(2_40_000));
    expect(await hraExemptionFor(inBengaluru.employeeId, "2026-27", "2026-06-01")).toBe(rupees(2_40_000));
  });

  it("is nil for somebody who owns their home, whatever rent they enter", async () => {
    const person = await createPerson({ roles: ["EMPLOYEE"] });
    await givePay(person.employeeId);
    actAs(person.session);
    expect(
      (await saveRent({}, form({ financialYear: "2026-27", monthlyRent: "40000", landlordName: "A landlord", landlordPan: "ABCPK5678L", accommodationType: "Own house" }))).ok,
    ).toBe(true);
    actAs(null);
    expect(await hraExemptionFor(person.employeeId, "2026-27", "2026-06-01")).toBe(0);
  });

  it("is the smallest of the three, so a small rent binds instead of the city", async () => {
    const person = await renter("Delhi", 6_000);
    // Rent of ₹72,000 a year less 10% of ₹6,00,000 basic is ₹12,000 — far
    // under the ₹3,00,000 the city would otherwise allow.
    expect(await hraExemptionFor(person.employeeId, "2026-27", "2026-06-01")).toBe(rupees(12_000));
  });
});

describe("declaring against the catalogue", () => {
  it("writes a line per component, refuses one over its cap, and computes HRA", async () => {
    const person = await createPerson({ roles: ["EMPLOYEE"] });
    actAs(person.session);

    const over = await saveDeclaration({}, form({ financialYear: "2026-27", regime: "Old", "component.80C": "200000" }));
    expect(over.error).toMatch(/capped at/);

    const saved = await saveDeclaration(
      {},
      form({ financialYear: "2026-27", regime: "Old", "component.80C": "150000", "component.80D": "20000" }),
    );
    expect(saved.ok, saved.error ?? "").toBe(true);
    actAs(null);

    const declaration = await one("SELECT id FROM tds_employee_declaration WHERE employee_id = ? AND financial_year = '2026-27'", [person.employeeId]);
    const lines = await rawClient().execute({
      sql: "SELECT component_code, declared_paise FROM tds_declaration_line WHERE declaration_id = ? ORDER BY component_code",
      args: [Number(declaration!.id)],
    });
    const amounts = Object.fromEntries(lines.rows.map((r) => [String(r.component_code), Number(r.declared_paise)]));
    expect(amounts["80C"]).toBe(rupees(1_50_000));
    expect(amounts["80D"]).toBe(rupees(20_000));
    // HRA is computed, so it is written even though nobody typed it.
    expect(amounts).toHaveProperty("HRA");
  });

  it("adds a city and the exemption follows it", async () => {
    const city = `TESTCITY${uid()}`;
    expect(await isMetroCity("India", city)).toBe(false);
    expect((await saveCityCategory({}, form({ country: "India", city, category: "METRO" }))).ok).toBe(true);
    expect(await isMetroCity("India", city)).toBe(true);
  });
});
