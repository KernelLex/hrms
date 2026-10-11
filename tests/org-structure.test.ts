import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { rawClient } from "@/lib/db";
import { saveLevelType, deleteLevelType, saveOrgUnit, saveCompany } from "@/app/actions/org";
import { loadOrgTree, ancestryOf, nearestAncestorWithRole, payrollGroupMembers, subtreeOf } from "@/lib/org-tree";
import { OPEN_ENDED } from "@/db/schema";
import { form } from "./support/fixtures";
import { actAs } from "./support/people";

/**
 * The org tree: the shape is the client's configuration, so what is tested
 * here is that the *rules* hold whatever shape they choose — a behaviour is
 * found by walking up to the level that carries it, and a unit cannot be put
 * somewhere its level does not allow.
 */

const uid = () => randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase();
const one = async (sql: string, args: (string | number)[] = []) =>
  (await rawClient().execute({ sql, args })).rows[0] as Record<string, unknown> | undefined;

/** A levelled node written straight in, so a test can build a shape to walk. */
async function node(opts: {
  code: string;
  level: string;
  parent?: string | null;
  company?: string | null;
  calendar?: string | null;
  active?: boolean;
}): Promise<string> {
  await rawClient().execute({
    sql: `INSERT INTO om_org_unit (code, name, parent_code, company_code, level_type_code, calendar_code, valid_from, valid_to, is_active)
          VALUES (?, ?, ?, ?, ?, ?, '2000-01-01', ?, ?)`,
    args: [
      opts.code,
      `Node ${opts.code}`,
      opts.parent ?? null,
      opts.company === undefined ? "CO01" : opts.company,
      opts.level,
      opts.calendar ?? null,
      OPEN_ENDED,
      opts.active === false ? 0 : 1,
    ],
  });
  return opts.code;
}

/** A private set of levels, so one test's shape cannot disturb another's. */
async function levels(prefix: string) {
  const top = `${prefix}TOP`;
  const mid = `${prefix}MID`;
  const leaf = `${prefix}LEAF`;
  await rawClient().batch(
    [
      {
        sql: `INSERT INTO om_level_type (code, name, parent_level_type_code, rank, is_payroll_group, is_calendar_level, is_cost_centre, is_business_centre, is_active)
              VALUES (?, ?, NULL, 0, 0, 0, 0, 0, 1)`,
        args: [top, `Top ${prefix}`],
      },
      {
        sql: `INSERT INTO om_level_type (code, name, parent_level_type_code, rank, is_payroll_group, is_calendar_level, is_cost_centre, is_business_centre, is_active)
              VALUES (?, ?, ?, 1, 1, 1, 0, 1, 1)`,
        args: [mid, `Centre ${prefix}`, top],
      },
      {
        sql: `INSERT INTO om_level_type (code, name, parent_level_type_code, rank, is_payroll_group, is_calendar_level, is_cost_centre, is_business_centre, is_active)
              VALUES (?, ?, ?, 2, 0, 0, 0, 0, 1)`,
        args: [leaf, `Leaf ${prefix}`, mid],
      },
    ],
    "write",
  );
  return { top, mid, leaf };
}

beforeAll(() => {
  // Every action here is HR's to take; the suite's default session is HR.
  actAs(null);
});
afterEach(() => actAs(null));

describe("walking the tree", () => {
  it("finds a behaviour at whichever level carries it, however deep the node", async () => {
    const p = uid();
    const l = await levels(p);
    const top = await node({ code: `${p}T`, level: l.top, parent: null, company: null });
    const centre = await node({ code: `${p}C`, level: l.mid, parent: top, calendar: "KARNATAKA" });
    const dept = await node({ code: `${p}D`, level: l.leaf, parent: centre });
    const sub = await node({ code: `${p}S`, level: l.leaf, parent: dept });

    const tree = await loadOrgTree();
    expect(ancestryOf(tree, sub).map((n) => n.code)).toEqual([sub, dept, centre, top]);
    expect(nearestAncestorWithRole(tree, sub, "isCalendarLevel")?.code).toBe(centre);
    expect(nearestAncestorWithRole(tree, sub, "isPayrollGroup")?.code).toBe(centre);
    expect(nearestAncestorWithRole(tree, top, "isPayrollGroup")).toBeNull();
    expect(subtreeOf(tree, centre)).toEqual(new Set([centre, dept, sub]));
  });

  it("gives a payroll group only the nodes no closer group has claimed", async () => {
    const p = uid();
    const l = await levels(p);
    const top = await node({ code: `${p}T`, level: l.top, parent: null, company: null });
    const outer = await node({ code: `${p}O`, level: l.mid, parent: top, calendar: "NATIONAL" });
    const under = await node({ code: `${p}U`, level: l.leaf, parent: outer });
    // A second group node deeper down takes its own descendants with it.
    const inner = await node({ code: `${p}I`, level: l.mid, parent: outer, calendar: "NATIONAL" });
    const deep = await node({ code: `${p}X`, level: l.leaf, parent: inner });

    const tree = await loadOrgTree();
    expect(payrollGroupMembers(tree, outer)).toEqual(new Set([outer, under]));
    expect(payrollGroupMembers(tree, inner)).toEqual(new Set([inner, deep]));
  });
});

describe("where a unit may be put", () => {
  it("refuses a unit whose level says it needs a parent", async () => {
    const p = uid();
    const l = await levels(p);
    const r = await saveOrgUnit(
      {},
      form({ code: `${p}ORPHAN`, name: "No parent", levelTypeCode: l.leaf, companyCode: "CO01", validFrom: "2026-01-01", isActive: "on" }),
    );
    expect(r.error).toMatch(/must sit under/);
  });

  it("refuses a parent at the wrong level, and takes the right one", async () => {
    const p = uid();
    const l = await levels(p);
    const top = await node({ code: `${p}T`, level: l.top, parent: null, company: null });
    const centre = await node({ code: `${p}C`, level: l.mid, parent: top, calendar: "NATIONAL" });

    const wrong = await saveOrgUnit(
      {},
      form({ code: `${p}W`, name: "Wrongly placed", levelTypeCode: l.leaf, parentCode: top, companyCode: "CO01", validFrom: "2026-01-01", isActive: "on" }),
    );
    expect(wrong.error).toMatch(/may sit only under/);

    const right = await saveOrgUnit(
      {},
      form({ code: `${p}R`, name: "Rightly placed", levelTypeCode: l.leaf, parentCode: centre, companyCode: "CO01", validFrom: "2026-01-01", isActive: "on" }),
    );
    expect(right.error).toBeUndefined();
    expect((await one("SELECT parent_code FROM om_org_unit WHERE code = ?", [`${p}R`]))?.parent_code).toBe(centre);
  });

  it("refuses an inactive parent, and one not yet valid on the day", async () => {
    const p = uid();
    const l = await levels(p);
    const top = await node({ code: `${p}T`, level: l.top, parent: null, company: null });
    const dead = await node({ code: `${p}C`, level: l.mid, parent: top, calendar: "NATIONAL", active: false });

    const inactive = await saveOrgUnit(
      {},
      form({ code: `${p}A`, name: "Under a dead parent", levelTypeCode: l.leaf, parentCode: dead, companyCode: "CO01", validFrom: "2026-01-01", isActive: "on" }),
    );
    expect(inactive.error).toMatch(/is inactive/);

    const live = await node({ code: `${p}L`, level: l.mid, parent: top, calendar: "NATIONAL" });
    await rawClient().execute({ sql: "UPDATE om_org_unit SET valid_from = '2027-06-01' WHERE code = ?", args: [live] });
    const early = await saveOrgUnit(
      {},
      form({ code: `${p}E`, name: "Starting too early", levelTypeCode: l.leaf, parentCode: live, companyCode: "CO01", validFrom: "2026-01-01", isActive: "on" }),
    );
    expect(early.error).toMatch(/not valid on/);
  });

  it("asks a calendar level for a calendar and a business centre for its kind", async () => {
    const p = uid();
    const l = await levels(p);
    const top = await node({ code: `${p}T`, level: l.top, parent: null, company: null });

    const noCalendar = await saveOrgUnit(
      {},
      form({ code: `${p}C`, name: "Centre", levelTypeCode: l.mid, parentCode: top, companyCode: "CO01", centreType: "PROFIT", validFrom: "2026-01-01", isActive: "on" }),
    );
    expect(noCalendar.error).toMatch(/holiday calendar/);

    const noKind = await saveOrgUnit(
      {},
      form({ code: `${p}C`, name: "Centre", levelTypeCode: l.mid, parentCode: top, companyCode: "CO01", calendarCode: "NATIONAL", validFrom: "2026-01-01", isActive: "on" }),
    );
    expect(noKind.error).toMatch(/profit centre or shared services/);

    const ok = await saveOrgUnit(
      {},
      form({
        code: `${p}C`,
        name: "Centre",
        levelTypeCode: l.mid,
        parentCode: top,
        companyCode: "CO01",
        calendarCode: "NATIONAL",
        centreType: "SHARED",
        validFrom: "2026-01-01",
        isActive: "on",
      }),
    );
    expect(ok.error).toBeUndefined();
    const saved = await one("SELECT centre_type, calendar_code FROM om_org_unit WHERE code = ?", [`${p}C`]);
    expect(saved).toMatchObject({ centre_type: "SHARED", calendar_code: "NATIONAL" });
  });

  it("will not switch off a unit that still has active children or positions", async () => {
    const p = uid();
    const l = await levels(p);
    const top = await node({ code: `${p}T`, level: l.top, parent: null, company: null });
    const centre = await node({ code: `${p}C`, level: l.mid, parent: top, calendar: "NATIONAL" });
    await node({ code: `${p}D`, level: l.leaf, parent: centre });

    const deactivate = (code: string, extra: Record<string, string> = {}) =>
      saveOrgUnit(
        {},
        form({ originalCode: code, code, name: `Node ${code}`, levelTypeCode: l.mid, parentCode: top, companyCode: "CO01", calendarCode: "NATIONAL", centreType: "PROFIT", validFrom: "2000-01-01", ...extra }),
      );

    const withChild = await deactivate(centre);
    expect(withChild.error).toMatch(/active org unit/);

    await rawClient().execute({ sql: "UPDATE om_org_unit SET is_active = 0 WHERE code = ?", args: [`${p}D`] });
    await rawClient().execute({
      sql: `INSERT INTO om_position (code, title, org_unit_code, job_code, is_manager, is_vacant, valid_from, valid_to, is_active)
            VALUES (?, 'A seat', ?, 'JB0001', 0, 1, '2000-01-01', ?, 1)`,
      args: [`PS${p}`, centre, OPEN_ENDED],
    });
    const withPosition = await deactivate(centre);
    expect(withPosition.error).toMatch(/active position/);

    await rawClient().execute({ sql: "UPDATE om_position SET is_active = 0 WHERE code = ?", args: [`PS${p}`] });
    const cleared = await deactivate(centre);
    expect(cleared.error).toBeUndefined();
    expect(Number((await one("SELECT is_active FROM om_org_unit WHERE code = ?", [centre]))?.is_active)).toBe(0);
  });
});

describe("the levels themselves", () => {
  it("refuses a loop, and refuses removing a level still in use", async () => {
    const p = uid();
    const l = await levels(p);

    const loop = await saveLevelType(
      {},
      form({ originalCode: l.top, code: l.top, name: "Top", parentLevelTypeCode: l.leaf, rank: "0", isActive: "on" }),
    );
    expect(loop.error).toMatch(/loop/);

    const top = await node({ code: `${p}T`, level: l.top, parent: null, company: null });
    const inUse = await deleteLevelType({}, form({ code: l.top }));
    expect(inUse.error).toMatch(/is used by 1 org unit/);

    await rawClient().execute({ sql: "DELETE FROM om_org_unit WHERE code = ?", args: [top] });
    const stillParent = await deleteLevelType({}, form({ code: l.top }));
    expect(stillParent.error).toMatch(/sits under/);
  });
});

describe("a company keeps books", () => {
  it("records the currency and fiscal year the reference design calls for", async () => {
    const code = `CX${uid().slice(0, 4)}`;
    const bad = await saveCompany({}, form({ code, name: "Odd books", currency: "RUPEES", fiscalYearStart: "04-01", isActive: "on" }));
    expect(bad.error).toMatch(/three-letter code/);

    const badYear = await saveCompany({}, form({ code, name: "Odd books", currency: "USD", fiscalYearStart: "April", isActive: "on" }));
    expect(badYear.error).toMatch(/MM-DD/);

    const ok = await saveCompany({}, form({ code, name: "Good books", currency: "usd", fiscalYearStart: "01-01", isActive: "on" }));
    expect(ok.error).toBeUndefined();
    expect(await one("SELECT currency, fiscal_year_start FROM om_company WHERE code = ?", [code])).toMatchObject({
      currency: "USD",
      fiscal_year_start: "01-01",
    });
  });
});
