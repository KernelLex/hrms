import { sqliteTable, text, integer, primaryKey } from "drizzle-orm/sqlite-core";

/**
 * Roles are sets of permissions (src/lib/permissions.ts) that HR edits on the
 * Roles and permissions screen. Three are built in, matching the three ways
 * people use this product — HR administrators run the back office, managers
 * approve and rate their team, employees act on their own record — and HR can
 * add more, such as a recruiter who sees candidates but no pay.
 */
export const ROLES = ["HR_ADMIN", "MANAGER", "EMPLOYEE"] as const;
export type BuiltInRole = (typeof ROLES)[number];
/** A built-in role, or one HR created. */
export type RoleCode = string;

export const secRole = sqliteTable("sec_role", {
  code: text("code").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  /** The three roles the product ships with: renamed and regranted, never deleted. */
  isBuiltIn: integer("is_built_in", { mode: "boolean" }).notNull().default(false),
});

/** Every permission the code checks, one row each, so roles can reference them. */
export const secPermission = sqliteTable("sec_permission", {
  code: text("code").primaryKey(),
  groupName: text("group_name").notNull(),
  description: text("description").notNull(),
  isSensitive: integer("is_sensitive", { mode: "boolean" }).notNull().default(false),
});

export const secRolePermission = sqliteTable(
  "sec_role_permission",
  {
    roleCode: text("role_code")
      .notNull()
      .references(() => secRole.code, { onDelete: "cascade" }),
    permissionCode: text("permission_code")
      .notNull()
      .references(() => secPermission.code, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.roleCode, t.permissionCode] })],
);

/**
 * Limits a role to some companies or personnel areas: whoever holds it sees
 * and changes only the employees assigned there. A role with no rows here is
 * organisation-wide.
 */
export const secRoleScope = sqliteTable(
  "sec_role_scope",
  {
    roleCode: text("role_code")
      .notNull()
      .references(() => secRole.code, { onDelete: "cascade" }),
    /** "company" or "area". */
    scopeType: text("scope_type").notNull(),
    scopeCode: text("scope_code").notNull(),
  },
  (t) => [primaryKey({ columns: [t.roleCode, t.scopeType, t.scopeCode] })],
);

export const secAppUser = sqliteTable("sec_app_user", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  displayName: text("display_name").notNull(),
  /** Set once Core HR exists; an HR admin need not be an employee. */
  employeeId: integer("employee_id"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull(),
});

export const secUserRole = sqliteTable(
  "sec_user_role",
  {
    userId: integer("user_id")
      .notNull()
      .references(() => secAppUser.id, { onDelete: "cascade" }),
    roleCode: text("role_code")
      .notNull()
      .references(() => secRole.code),
  },
  (t) => [primaryKey({ columns: [t.userId, t.roleCode] })],
);
