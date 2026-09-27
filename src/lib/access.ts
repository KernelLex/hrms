import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { rawClient } from "@/lib/db";
import { getSession, type Session } from "@/lib/auth";
import { PERMISSIONS, type Permission } from "@/lib/permissions";
import { kickJobs } from "@/lib/jobs/runner";

/**
 * Who someone is and what they may do, read fresh on every request.
 *
 * The session cookie says who is signed in; the roles they hold, and the
 * permissions and scopes those roles carry, come from the database each
 * request (once per request, through React's cache), so a change on the
 * Roles and permissions screen applies at once, without signing out.
 *
 * Every Server Function, route and page asks for a permission here — never
 * for a role. A Server Function can be called by a direct POST, so the check
 * belongs in the function, not in the screen that shows its button.
 */

export const PERMISSION_DENIED = "You do not have permission to do that.";

export class PermissionError extends Error {
  constructor() {
    super(PERMISSION_DENIED);
    this.name = "PermissionError";
  }
}

/** The employees a person may see: everyone, or those in some companies or areas. */
export type EmployeeScope = { companies: string[]; areas: string[] } | null;

export type Access = Session & {
  roleCodes: string[];
  roleNames: string[];
  permissions: ReadonlySet<Permission>;
  /** Null when organisation-wide. */
  scope: EmployeeScope;
};

const loadAccess = cache(async (userId: number) => {
  const [roles, scopes] = await Promise.all([
    rawClient().execute({
      sql: `SELECT r.code, r.name, rp.permission_code
            FROM sec_user_role ur
            JOIN sec_app_user u ON u.id = ur.user_id AND u.is_active = 1
            JOIN sec_role r ON r.code = ur.role_code
            LEFT JOIN sec_role_permission rp ON rp.role_code = r.code
            WHERE ur.user_id = ?
            ORDER BY CASE r.code WHEN 'HR_ADMIN' THEN 0 WHEN 'MANAGER' THEN 1 WHEN 'EMPLOYEE' THEN 3 ELSE 2 END,
                     r.name`,
      args: [userId],
    }),
    rawClient().execute({
      sql: `SELECT s.role_code, s.scope_type, s.scope_code
            FROM sec_user_role ur JOIN sec_role_scope s ON s.role_code = ur.role_code
            WHERE ur.user_id = ?`,
      args: [userId],
    }),
  ]);

  const roleCodes: string[] = [];
  const roleNames: string[] = [];
  const permissions = new Set<Permission>();
  for (const row of roles.rows) {
    const code = String(row.code);
    if (!roleCodes.includes(code)) {
      roleCodes.push(code);
      roleNames.push(String(row.name));
    }
    const p = row.permission_code;
    if (typeof p === "string" && p in PERMISSIONS) permissions.add(p as Permission);
  }

  // A person sees every employee if any role that lets them see employees is
  // unscoped; otherwise the union of their roles' scopes.
  const scoped = new Map<string, { companies: string[]; areas: string[] }>();
  for (const s of scopes.rows) {
    const entry = scoped.get(String(s.role_code)) ?? { companies: [], areas: [] };
    (s.scope_type === "company" ? entry.companies : entry.areas).push(String(s.scope_code));
    scoped.set(String(s.role_code), entry);
  }
  let scope: EmployeeScope = null;
  if (roleCodes.length > 0 && roleCodes.every((c) => scoped.has(c))) {
    scope = { companies: [], areas: [] };
    for (const entry of scoped.values()) {
      scope.companies.push(...entry.companies);
      scope.areas.push(...entry.areas);
    }
  }

  return { roleCodes, roleNames, permissions, scope };
});

export function accessFor(session: Session): Promise<Access> {
  return loadAccess(session.userId).then((a) => ({ ...session, roles: a.roleCodes, ...a }));
}

/** The signed-in person and what they may do, or null when signed out. */
export async function getAccess(): Promise<Access | null> {
  const session = await getSession();
  return session ? accessFor(session) : null;
}

/** Whether they hold every one of these permissions. */
export function can(access: Access | null, ...permissions: Permission[]): boolean {
  return !!access && permissions.every((p) => access.permissions.has(p));
}

/** Whether they hold at least one of these permissions. */
export function canAny(access: Access | null, ...permissions: Permission[]): boolean {
  return !!access && permissions.some((p) => access.permissions.has(p));
}

/** For Server Functions and routes: signed in, and holding every permission named. */
export async function requirePermission(...permissions: Permission[]): Promise<Access> {
  const access = await getAccess();
  if (!access) throw new Error("Not signed in.");
  if (!can(access, ...permissions)) throw new PermissionError();
  await afterChange();
  return access;
}

/**
 * Every Server Function that changes something passes through here, so this
 * is where background work is woken: once the response has gone, what the
 * function changed becomes events for the ERP, and queued work runs.
 */
async function afterChange(): Promise<void> {
  try {
    await kickJobs();
  } catch {
    // Outside a request (a script); the daily tick catches up.
  }
}

/** For Server Functions and routes: signed in, and holding one of the permissions named. */
export async function requireAnyPermission(...permissions: Permission[]): Promise<Access> {
  const access = await getAccess();
  if (!access) throw new Error("Not signed in.");
  if (!canAny(access, ...permissions)) throw new PermissionError();
  await afterChange();
  return access;
}

/** For Server Functions open to anyone signed in, such as their own inbox. */
export async function requireAccess(): Promise<Access> {
  const access = await getAccess();
  if (!access) throw new Error("Not signed in.");
  return access;
}

/**
 * For pages: signed in, and holding one of the permissions named, or sent
 * somewhere they can use. A page is only a view of what the Server Functions
 * allow; this keeps people from landing on a screen of refusals.
 */
export async function requirePage(
  permissions: Permission[] = [],
  otherwise: string = "/",
): Promise<Access> {
  const access = await getAccess();
  if (!access) redirect("/sign-in");
  if (permissions.length > 0 && !canAny(access, ...permissions)) redirect(otherwise);
  return access;
}

/** The label under a person's name: their first role's name. */
export function roleLabel(access: Pick<Access, "roleNames">): string {
  return access.roleNames[0] ?? "No role";
}

/**
 * Whether an employee falls inside the companies or areas this person's
 * roles cover, going by their latest org assignment. Always true for someone
 * whose roles are organisation-wide.
 */
export async function inScope(access: Access, employeeId: number): Promise<boolean> {
  if (!access.scope) return true;
  const r = await rawClient().execute({
    sql: `SELECT company_code, area_code FROM pa_it0001_org_assignment
          WHERE employee_id = ? ORDER BY valid_from DESC LIMIT 1`,
    args: [employeeId],
  });
  const row = r.rows[0];
  if (!row) return false;
  return (
    access.scope.companies.includes(String(row.company_code)) ||
    access.scope.areas.includes(String(row.area_code))
  );
}

/** The SQL condition limiting `alias` (an org assignment) to a person's scope. */
export function scopeCondition(
  access: Access,
  alias: string,
): { sql: string; args: string[] } {
  if (!access.scope) return { sql: "1 = 1", args: [] };
  const { companies, areas } = access.scope;
  const parts: string[] = [];
  if (companies.length) parts.push(`${alias}.company_code IN (${companies.map(() => "?").join(", ")})`);
  if (areas.length) parts.push(`${alias}.area_code IN (${areas.map(() => "?").join(", ")})`);
  return { sql: parts.length ? `(${parts.join(" OR ")})` : "1 = 0", args: [...companies, ...areas] };
}
