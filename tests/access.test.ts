import { afterEach, describe, expect, it } from "vitest";
import { rawClient } from "@/lib/db";
import { accessFor, inScope, PERMISSION_DENIED } from "@/lib/access";
import { ALL_PERMISSIONS, BUILT_IN_ROLES, PERMISSIONS } from "@/lib/permissions";
import { navFor } from "@/lib/nav";
import { commandsFor } from "@/lib/commands";
import { saveCandidate, convertToEmployee } from "@/app/actions/recruitment";
import { startRunAction } from "@/app/actions/payroll";
import { saveInfotypeSlice } from "@/app/actions/core-hr";
import { saveRole, addRoleMember, removeRoleMember } from "@/app/actions/access";
import { searchEmployees } from "@/lib/repositories/employees";
import { GET as exportEmployees } from "@/app/api/export/employees/route";
import { createBareEmployee, form } from "./support/fixtures";
import { actAs, createPerson } from "./support/people";

/**
 * Permissions instead of roles: what the catalogue grants, what a role HR
 * made can and cannot do — on screen and by direct POST — and the guard that
 * keeps someone able to manage access.
 */

afterEach(() => actAs(null));

const hrefs = (perms: ReadonlySet<(typeof ALL_PERMISSIONS)[number]>) =>
  navFor(perms).flatMap((g) => g.items.map((i) => i.href));

async function refusal(run: () => Promise<unknown>): Promise<string | null> {
  try {
    await run();
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

describe("the catalogue", () => {
  it("is in the database exactly as the code defines it", async () => {
    const r = await rawClient().execute("SELECT code, group_name, description, is_sensitive FROM sec_permission ORDER BY code");
    expect(r.rows.map((p) => String(p.code))).toEqual([...ALL_PERMISSIONS].sort());
    for (const p of r.rows) {
      const def = PERMISSIONS[String(p.code) as keyof typeof PERMISSIONS] as { group: string; can: string; sensitive?: boolean };
      expect(String(p.group_name)).toBe(def.group);
      expect(String(p.description)).toBe(def.can);
      expect(Number(p.is_sensitive) === 1).toBe(Boolean(def.sensitive));
    }
  });

  it("grants the built-in roles what they had before permissions existed", async () => {
    for (const [code, role] of Object.entries(BUILT_IN_ROLES)) {
      const r = await rawClient().execute({
        sql: "SELECT permission_code FROM sec_role_permission WHERE role_code = ? ORDER BY 1",
        args: [code],
      });
      expect(r.rows.map((p) => String(p.permission_code))).toEqual([...role.permissions].sort());
    }
  });

  // As before permissions existed, plus the interviews they are asked to take.
  it("gives each built-in role the sidebar it had", async () => {
    const hr = await createPerson({ roles: ["HR_ADMIN"] });
    const manager = await createPerson({ roles: ["MANAGER", "EMPLOYEE"] });
    const employee = await createPerson({ roles: ["EMPLOYEE"] });
    const [h, m, e] = await Promise.all([hr, manager, employee].map((p) => accessFor(p.session)));

    expect(hrefs(h.permissions)).toEqual(expect.arrayContaining(["/org", "/core-hr", "/payroll", "/approvals", "/admin/roles", "/change-log"]));
    expect(hrefs(m.permissions)).toEqual(["/me", "/core-hr", "/tasks", "/headcount-requests", "/exit", "/approvals", "/time/calendar", "/time/my-leave", "/time/my-attendance", "/payroll/my-payslips", "/tax/declarations", "/tax/form16", "/loans-claims/my-loans", "/loans-claims/my-claims", "/recruitment/my-interviews", "/refer", "/performance", "/performance/mine"]);
    expect(hrefs(e.permissions)).toEqual(["/me", "/tasks", "/exit", "/time/my-leave", "/time/my-attendance", "/payroll/my-payslips", "/tax/declarations", "/tax/form16", "/loans-claims/my-loans", "/loans-claims/my-claims", "/recruitment/my-interviews", "/refer", "/performance/mine"]);
    expect(m.roleNames[0]).toBe("Manager");
  });
});

describe("a recruiter", () => {
  it("sees candidates and no pay, on screen and by direct POST", async () => {
    const recruiter = await createPerson({ roles: ["RECRUITER"], email: false });
    const access = await accessFor(recruiter.session);

    // On screen: recruitment, and nothing that shows pay.
    const nav = hrefs(access.permissions);
    expect(nav).toContain("/recruitment");
    for (const href of ["/payroll", "/core-hr", "/reports", "/performance", "/tax"]) expect(nav).not.toContain(href);
    const pages = commandsFor(access.permissions).pages.map((p) => p.href);
    expect(pages).not.toContain("/payroll/run");

    // By direct POST: candidates yes, payroll and conversion (which sets a salary) no.
    actAs(recruiter.session);
    const saved = await saveCandidate({}, form({ fullName: "Kavya Rao", email: `kavya.${Date.now()}@example.test`, source: "Referral" }));
    expect(saved).toEqual({ ok: true });
    expect(await refusal(() => startRunAction({}, form({ periodId: 1 })))).toBe(PERMISSION_DENIED);
    expect(await refusal(() => convertToEmployee({}, form({ applicationId: 1 })))).toBe(PERMISSION_DENIED);
    const exported = await exportEmployees(new Request("http://localhost/api/export/employees"));
    expect(exported.status).toBe(403);
  });
});

describe("changing roles", () => {
  it("applies at once, without signing out", async () => {
    const person = await createPerson({ roles: ["RECRUITER"], email: false });
    const code = `AUDIT_${Date.now() % 100000}`;
    await saveRole({}, form({ code, name: "Auditor" })).catch(() => {}); // creating redirects
    expect((await accessFor(person.session)).permissions.has("audit.view")).toBe(false);

    const f = form({ originalCode: code, name: "Auditor" });
    f.append("permission", "audit.view");
    expect(await saveRole({}, f)).toEqual({ ok: true });
    await addRoleMember({}, form({ roleCode: code, userId: person.userId }));
    expect((await accessFor(person.session)).permissions.has("audit.view")).toBe(true);

    await removeRoleMember({}, form({ roleCode: code, userId: person.userId }));
    expect((await accessFor(person.session)).permissions.has("audit.view")).toBe(false);
  });

  it("never leaves nobody able to manage access", async () => {
    const f = form({ originalCode: "HR_ADMIN", name: "HR administrator" });
    for (const p of BUILT_IN_ROLES.HR_ADMIN.permissions.filter((p) => p !== "access.manage")) f.append("permission", p);
    const result = await saveRole({}, f);
    expect(result.error).toMatch(/nobody able to manage access/);
    const still = await rawClient().execute(
      "SELECT 1 FROM sec_role_permission WHERE role_code = 'HR_ADMIN' AND permission_code = 'access.manage'",
    );
    expect(still.rows).toHaveLength(1);
  });

  it("refuses the role screens to anyone who does not manage access", async () => {
    const manager = await createPerson({ roles: ["MANAGER"] });
    actAs(manager.session);
    expect(await refusal(() => saveRole({}, form({ code: "SNEAKY", name: "Sneaky" })))).toBe(PERMISSION_DENIED);
  });
});

describe("sensitive fields and scope", () => {
  it("keeps pay out of reach of a role that can edit records but not see pay", async () => {
    const code = `EDITOR_${Date.now() % 100000}`;
    await saveRole({}, form({ code, name: "Records editor" })).catch(() => {});
    const f = form({ originalCode: code, name: "Records editor" });
    for (const p of ["employee.view_all", "employee.edit"]) f.append("permission", p);
    await saveRole({}, f);
    const editor = await createPerson({ roles: [code], email: false });
    const id = await createBareEmployee("SC");

    actAs(editor.session);
    const pay = await saveInfotypeSlice({}, form({ employeeId: id, infotype: "0008", validFrom: "2025-01-01", amount: 50_000 }));
    expect(pay.error).toBe("Changing basic pay needs permission to see pay.");
    const personal = await saveInfotypeSlice({}, form({ employeeId: id, infotype: "0002", validFrom: "2025-01-01", firstName: "Asha", lastName: "Nair" }));
    expect(personal).toEqual({ ok: true });
  });

  it("limits a scoped role to its companies", async () => {
    const code = `CO02_HR_${Date.now() % 100000}`;
    await saveRole({}, form({ code, name: "HR for CO02" })).catch(() => {});
    const f = form({ originalCode: code, name: "HR for CO02" });
    for (const p of ["employee.view_all", "employee.edit"]) f.append("permission", p);
    f.append("company", "CO02");
    await saveRole({}, f);
    const person = await createPerson({ roles: [code], email: false });
    const access = await accessFor(person.session);
    expect(access.scope).toEqual({ companies: ["CO02"], areas: [] });

    // The seeded organisation is all in CO01, so none of it is visible.
    const outside = await createPerson(); // assigned to CO01
    expect(await inScope(access, outside.employeeId)).toBe(false);
    const { rows } = await searchEmployees({ scope: access.scope }, { limit: 50, offset: 0 });
    expect(rows.every((e) => e.company_code === "CO02")).toBe(true);

    actAs(person.session);
    const refused = await saveInfotypeSlice({}, form({ employeeId: outside.employeeId, infotype: "0002", validFrom: "2025-01-01", firstName: "X", lastName: "Y" }));
    expect(refused.error).toMatch(/outside the companies and areas/);
  });
});
