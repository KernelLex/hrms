"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { InStatement } from "@libsql/client";
import { rawClient } from "@/lib/db";
import { requirePermission } from "@/lib/access";
import { actorOf, recordChanges } from "@/lib/change-log";
import { ALL_PERMISSIONS, type Permission } from "@/lib/permissions";
import { APPROVER_TYPES, PROCESSES, isProcess, type ApproverType } from "@/lib/workflow/processes";

/**
 * Roles and permissions, who holds them, and approval flows: HR deciding who
 * can do what, and who approves what, without a developer.
 *
 * One rule guards everything here: at least one active person must always
 * be able to manage access, or nobody could ever change it again.
 */

export type ActionState = { error?: string; ok?: boolean };

const OK: ActionState = { ok: true };
const fail = (error: string): ActionState => ({ error });
const str = (v: FormDataEntryValue | null) => (typeof v === "string" ? v.trim() : "");

function revalidateAccess() {
  revalidatePath("/admin", "layout");
  revalidatePath("/", "layout");
}

/** Active people who could manage access if these changes were made. */
async function adminsAfter(change: {
  role?: string;
  roleKeeps?: boolean;
  removedMember?: { role: string; userId: number };
  deletedRole?: string;
}): Promise<number> {
  const r = await rawClient().execute(
    `SELECT ur.user_id, ur.role_code,
            EXISTS (SELECT 1 FROM sec_role_permission rp
                    WHERE rp.role_code = ur.role_code AND rp.permission_code = 'access.manage') AS manages
     FROM sec_user_role ur JOIN sec_app_user u ON u.id = ur.user_id AND u.is_active = 1`,
  );
  const admins = new Set<number>();
  for (const row of r.rows) {
    const role = String(row.role_code);
    const userId = Number(row.user_id);
    if (change.deletedRole === role) continue;
    if (change.removedMember && change.removedMember.role === role && change.removedMember.userId === userId) continue;
    const manages = change.role === role ? Boolean(change.roleKeeps) : Number(row.manages) === 1;
    if (manages) admins.add(userId);
  }
  return admins.size;
}

const LAST_ADMIN = "That would leave nobody able to manage access. Give another active person the right first.";

async function roleState(code: string) {
  const [role, perms, scopes] = await Promise.all([
    rawClient().execute({ sql: "SELECT * FROM sec_role WHERE code = ?", args: [code] }),
    rawClient().execute({ sql: "SELECT permission_code FROM sec_role_permission WHERE role_code = ? ORDER BY 1", args: [code] }),
    rawClient().execute({ sql: "SELECT scope_type, scope_code FROM sec_role_scope WHERE role_code = ? ORDER BY 1, 2", args: [code] }),
  ]);
  const row = role.rows[0];
  if (!row) return null;
  return {
    code,
    name: String(row.name),
    description: row.description === null ? null : String(row.description),
    isBuiltIn: Number(row.is_built_in) === 1,
    permissions: perms.rows.map((p) => String(p.permission_code)).join(", "),
    scope: scopes.rows.map((s) => `${s.scope_type}:${s.scope_code}`).join(", ") || "organisation-wide",
  };
}

/** Creates a role, or changes one: its name, permissions and scope. */
export async function saveRole(_prev: ActionState, form: FormData): Promise<ActionState> {
  const session = await requirePermission("access.manage");
  const original = str(form.get("originalCode"));
  const code = (original || str(form.get("code"))).toUpperCase();
  const name = str(form.get("name"));
  const description = str(form.get("description")) || null;
  const permissions = [...new Set(form.getAll("permission").map(String))].filter((p): p is Permission =>
    (ALL_PERMISSIONS as string[]).includes(p),
  );
  const companies = [...new Set(form.getAll("company").map(String).filter(Boolean))];
  const areas = [...new Set(form.getAll("area").map(String).filter(Boolean))];

  if (!/^[A-Z][A-Z0-9_]{1,29}$/.test(code)) {
    return fail("A role code is 2 to 30 capital letters, digits or underscores, starting with a letter.");
  }
  if (!name) return fail("Give the role a name.");

  const before = await roleState(code);
  if (!original && before) return fail(`A role with the code ${code} already exists.`);
  if (original && !before) return fail("That role no longer exists.");

  if ((await adminsAfter({ role: code, roleKeeps: permissions.includes("access.manage") })) === 0) {
    return fail(LAST_ADMIN);
  }

  const statements: InStatement[] = [
    original
      ? { sql: "UPDATE sec_role SET name = ?, description = ? WHERE code = ?", args: [name, description, code] }
      : { sql: "INSERT INTO sec_role (code, name, description, is_built_in) VALUES (?, ?, ?, 0)", args: [code, name, description] },
    { sql: "DELETE FROM sec_role_permission WHERE role_code = ?", args: [code] },
    ...permissions.map((p) => ({
      sql: "INSERT INTO sec_role_permission (role_code, permission_code) VALUES (?, ?)",
      args: [code, p],
    })),
    { sql: "DELETE FROM sec_role_scope WHERE role_code = ?", args: [code] },
    ...companies.map((c) => ({
      sql: "INSERT INTO sec_role_scope (role_code, scope_type, scope_code) VALUES (?, 'company', ?)",
      args: [code, c],
    })),
    ...areas.map((a) => ({
      sql: "INSERT INTO sec_role_scope (role_code, scope_type, scope_code) VALUES (?, 'area', ?)",
      args: [code, a],
    })),
  ];
  await rawClient().batch(statements, "write");

  const after = await roleState(code);
  await recordChanges(actorOf(session), [
    {
      entity: "sec_role",
      entityId: code,
      action: before ? "update" : "create",
      before: before ?? undefined,
      after: after ?? undefined,
    },
  ]);
  revalidateAccess();
  if (!original) redirect(`/admin/roles/${code}`);
  return OK;
}

/** Removes a role HR created. Built-in roles stay. */
export async function deleteRole(_prev: ActionState, form: FormData): Promise<ActionState> {
  const session = await requirePermission("access.manage");
  const code = str(form.get("code"));
  const before = await roleState(code);
  if (!before) return fail("That role no longer exists.");
  if (before.isBuiltIn) return fail("A built-in role can be renamed and regranted, but not removed.");
  if ((await adminsAfter({ deletedRole: code })) === 0) return fail(LAST_ADMIN);

  await rawClient().batch(
    [
      { sql: "DELETE FROM sec_user_role WHERE role_code = ?", args: [code] },
      { sql: "DELETE FROM sec_role_permission WHERE role_code = ?", args: [code] },
      { sql: "DELETE FROM sec_role_scope WHERE role_code = ?", args: [code] },
      { sql: "DELETE FROM sec_role WHERE code = ?", args: [code] },
    ],
    "write",
  );
  await recordChanges(actorOf(session), [{ entity: "sec_role", entityId: code, action: "delete", before }]);
  revalidateAccess();
  redirect("/admin/roles");
}

/** Gives a person a role. */
export async function addRoleMember(_prev: ActionState, form: FormData): Promise<ActionState> {
  const session = await requirePermission("access.manage");
  const role = str(form.get("roleCode"));
  const userId = Number(form.get("userId"));
  const user = await rawClient().execute({
    sql: "SELECT id, username, employee_id FROM sec_app_user WHERE id = ?",
    args: [userId],
  });
  if (!user.rows[0]) return fail("Choose a person.");
  if (!(await roleState(role))) return fail("That role no longer exists.");
  const added = await rawClient().execute({
    sql: "INSERT OR IGNORE INTO sec_user_role (user_id, role_code) VALUES (?, ?)",
    args: [userId, role],
  });
  if (added.rowsAffected > 0) {
    await recordChanges(actorOf(session), [
      {
        entity: "sec_user_role",
        entityId: `${userId}:${role}`,
        subjectEmployeeId: user.rows[0].employee_id === null ? null : Number(user.rows[0].employee_id),
        action: "create",
        after: { username: String(user.rows[0].username), role_code: role },
      },
    ]);
  }
  revalidateAccess();
  return OK;
}

/** Takes a role away from a person. */
export async function removeRoleMember(_prev: ActionState, form: FormData): Promise<ActionState> {
  const session = await requirePermission("access.manage");
  const role = str(form.get("roleCode"));
  const userId = Number(form.get("userId"));
  if ((await adminsAfter({ removedMember: { role, userId } })) === 0) return fail(LAST_ADMIN);
  const removed = await rawClient().execute({
    sql: "DELETE FROM sec_user_role WHERE user_id = ? AND role_code = ? RETURNING user_id",
    args: [userId, role],
  });
  if (removed.rows[0]) {
    const user = await rawClient().execute({
      sql: "SELECT username, employee_id FROM sec_app_user WHERE id = ?",
      args: [userId],
    });
    await recordChanges(actorOf(session), [
      {
        entity: "sec_user_role",
        entityId: `${userId}:${role}`,
        subjectEmployeeId: user.rows[0]?.employee_id == null ? null : Number(user.rows[0].employee_id),
        action: "delete",
        before: { username: String(user.rows[0]?.username ?? userId), role_code: role },
      },
    ]);
  }
  revalidateAccess();
  return OK;
}

/* ------------------------------------------------------------ approval flows */

type StepInput = {
  approverType: string;
  approverRole?: string | null;
  approverUserId?: number | null;
  conditionMin?: number | null;
  escalateAfterDays?: number | null;
};

/**
 * Saves a process's approval route as a new version. Requests already on
 * their way keep the version they started on; new requests take this one.
 */
export async function saveFlow(_prev: ActionState, form: FormData): Promise<ActionState> {
  const session = await requirePermission("access.manage");
  const process = str(form.get("process"));
  if (!isProcess(process)) return fail("That process is not recognised.");

  let steps: StepInput[];
  try {
    steps = JSON.parse(str(form.get("steps")) || "[]") as StepInput[];
  } catch {
    return fail("The steps could not be read. Reload and try again.");
  }
  if (!Array.isArray(steps) || steps.length === 0) return fail("A flow needs at least one step.");
  if (steps.length > 5) return fail("A flow has at most five steps.");

  const factField = Object.keys(PROCESSES[process].facts)[0] ?? null;
  const clean: {
    approverType: ApproverType;
    approverRole: string | null;
    approverUserId: number | null;
    conditionMin: number | null;
    escalateAfterDays: number | null;
  }[] = [];
  for (const [i, s] of steps.entries()) {
    const n = i + 1;
    if (!(s.approverType in APPROVER_TYPES)) return fail(`Step ${n}: choose who approves.`);
    const type = s.approverType as ApproverType;
    let role: string | null = null;
    let user: number | null = null;
    if (type === "role") {
      role = String(s.approverRole ?? "");
      const exists = await rawClient().execute({ sql: "SELECT 1 FROM sec_role WHERE code = ?", args: [role] });
      if (!exists.rows[0]) return fail(`Step ${n}: choose a role.`);
    }
    if (type === "person") {
      user = Number(s.approverUserId);
      const exists = await rawClient().execute({
        sql: "SELECT 1 FROM sec_app_user WHERE id = ? AND is_active = 1",
        args: [user],
      });
      if (!exists.rows[0]) return fail(`Step ${n}: choose a person who can sign in.`);
    }
    const min = s.conditionMin === null || s.conditionMin === undefined || String(s.conditionMin) === "" ? null : Number(s.conditionMin);
    if (min !== null && (!Number.isFinite(min) || min < 0)) return fail(`Step ${n}: the condition must be a number.`);
    if (n === 1 && min !== null) return fail("The first step always applies; add conditions to later steps.");
    const esc =
      s.escalateAfterDays === null || s.escalateAfterDays === undefined || String(s.escalateAfterDays) === ""
        ? null
        : Number(s.escalateAfterDays);
    if (esc !== null && (!Number.isInteger(esc) || esc < 1 || esc > 60)) {
      return fail(`Step ${n}: escalate after 1 to 60 days, or leave it empty.`);
    }
    clean.push({ approverType: type, approverRole: role, approverUserId: user, conditionMin: min, escalateAfterDays: esc });
  }

  const current = await rawClient().execute({
    sql: "SELECT COALESCE(MAX(version), 0) AS v FROM wf_flow WHERE process = ?",
    args: [process],
  });
  const version = Number(current.rows[0].v) + 1;
  const at = new Date().toISOString();
  const tx = await rawClient().transaction("write");
  try {
    await tx.execute({ sql: "UPDATE wf_flow SET is_active = 0 WHERE process = ?", args: [process] });
    const flow = await tx.execute({
      sql: "INSERT INTO wf_flow (process, version, is_active, created_by, created_at) VALUES (?, ?, 1, ?, ?) RETURNING id",
      args: [process, version, session.username, at],
    });
    const flowId = Number(flow.rows[0].id);
    for (const [i, s] of clean.entries()) {
      await tx.execute({
        sql: `INSERT INTO wf_step (flow_id, step_order, approver_type, approver_role, approver_user_id,
                                   condition_field, condition_min, escalate_after_days)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          flowId,
          i + 1,
          s.approverType,
          s.approverRole,
          s.approverUserId,
          s.conditionMin === null ? null : factField,
          s.conditionMin,
          s.escalateAfterDays,
        ],
      });
    }
    await tx.commit();
  } catch (err) {
    await tx.rollback();
    throw err;
  } finally {
    tx.close();
  }
  await recordChanges(actorOf(session), [
    {
      entity: "wf_flow",
      entityId: `${process}:${version}`,
      action: "create",
      after: { process, version, steps: JSON.stringify(clean) },
    },
  ]);
  revalidateAccess();
  return OK;
}
