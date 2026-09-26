import "server-only";
import { rawClient } from "@/lib/db";

/** Reads for the Roles and permissions and Approval flows screens. */

export type RoleSummary = {
  code: string;
  name: string;
  description: string | null;
  isBuiltIn: boolean;
  permissions: string[];
  companies: string[];
  areas: string[];
  members: { userId: number; username: string; displayName: string }[];
};

export async function listRoles(): Promise<RoleSummary[]> {
  const [roles, perms, scopes, members] = await Promise.all([
    rawClient().execute(
      `SELECT code, name, description, is_built_in FROM sec_role
       ORDER BY is_built_in DESC, CASE code WHEN 'HR_ADMIN' THEN 0 WHEN 'MANAGER' THEN 1 ELSE 2 END, name`,
    ),
    rawClient().execute("SELECT role_code, permission_code FROM sec_role_permission"),
    rawClient().execute("SELECT role_code, scope_type, scope_code FROM sec_role_scope ORDER BY scope_code"),
    rawClient().execute(
      `SELECT ur.role_code, u.id, u.username, u.display_name FROM sec_user_role ur
       JOIN sec_app_user u ON u.id = ur.user_id ORDER BY u.display_name`,
    ),
  ]);
  return roles.rows.map((r) => {
    const code = String(r.code);
    return {
      code,
      name: String(r.name),
      description: r.description === null ? null : String(r.description),
      isBuiltIn: Number(r.is_built_in) === 1,
      permissions: perms.rows.filter((p) => p.role_code === code).map((p) => String(p.permission_code)),
      companies: scopes.rows.filter((s) => s.role_code === code && s.scope_type === "company").map((s) => String(s.scope_code)),
      areas: scopes.rows.filter((s) => s.role_code === code && s.scope_type === "area").map((s) => String(s.scope_code)),
      members: members.rows
        .filter((m) => m.role_code === code)
        .map((m) => ({ userId: Number(m.id), username: String(m.username), displayName: String(m.display_name) })),
    };
  });
}

export async function getRole(code: string): Promise<RoleSummary | null> {
  return (await listRoles()).find((r) => r.code === code) ?? null;
}

export type UserOption = { id: number; label: string };

/** Everyone who can sign in, for choosing a member, an approver or a delegate. */
export async function listUsers(): Promise<UserOption[]> {
  const r = await rawClient().execute(
    "SELECT id, username, display_name FROM sec_app_user WHERE is_active = 1 ORDER BY display_name",
  );
  return r.rows.map((u) => ({ id: Number(u.id), label: `${u.display_name} (${u.username})` }));
}

export async function scopeOptions(): Promise<{
  companies: { code: string; name: string }[];
  areas: { code: string; name: string }[];
}> {
  const [companies, areas] = await Promise.all([
    rawClient().execute("SELECT code, name FROM om_company ORDER BY code"),
    rawClient().execute("SELECT code, name FROM om_personnel_area ORDER BY code"),
  ]);
  return {
    companies: companies.rows.map((c) => ({ code: String(c.code), name: String(c.name) })),
    areas: areas.rows.map((a) => ({ code: String(a.code), name: String(a.name) })),
  };
}
