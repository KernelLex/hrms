import { sqliteTable, text, integer, primaryKey } from "drizzle-orm/sqlite-core";

/**
 * Three roles, matching the three ways people use this product:
 * HR administrators run the back office, managers approve and rate their team,
 * employees act on their own record.
 */
export const ROLES = ["HR_ADMIN", "MANAGER", "EMPLOYEE"] as const;
export type RoleCode = (typeof ROLES)[number];

export const secRole = sqliteTable("sec_role", {
  code: text("code").primaryKey(),
  name: text("name").notNull(),
});

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
