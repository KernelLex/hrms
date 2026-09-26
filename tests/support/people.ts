import { randomUUID } from "node:crypto";
import { rawClient } from "@/lib/db";
import { OPEN_ENDED } from "@/db/schema";
import type { Session } from "@/lib/auth";

/**
 * People who can sign in: an employee in a position of their own, with a
 * login and a work email, optionally reporting to another position. Used by
 * the tests that need to know who is told what.
 */

const uid = () => randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();

export type Person = { employeeId: number; userId: number; position: string; email: string; session: Session };

export async function createPerson(opts: {
  reportsTo?: string;
  roles?: Session["roles"];
  email?: boolean;
} = {}): Promise<Person> {
  const client = rawClient();
  const id = uid();
  const position = `PZ${id}`;
  const email = `person.${id.toLowerCase()}@example.test`;
  const now = new Date().toISOString();

  await client.execute({
    sql: `INSERT INTO om_position (code, title, org_unit_code, job_code, reports_to_code, is_manager, is_vacant, valid_from, valid_to, is_active)
          VALUES (?, ?, 'OU0002', 'JB0001', ?, 0, 0, '2020-01-01', ?, 1)`,
    args: [position, `Test position ${id}`, opts.reportsTo ?? null, OPEN_ENDED],
  });
  const created = await client.execute({
    sql: `INSERT INTO pa_employee (employee_number, hire_date, employment_status, created_at)
          VALUES (?, '2020-01-01', 'Active', ?) RETURNING id`,
    args: [`ZN${id}`, now],
  });
  const employeeId = Number(created.rows[0].id);
  const common = [employeeId, "2020-01-01", OPEN_ENDED, "test", now];
  await client.batch(
    [
      {
        sql: `INSERT INTO pa_it0001_org_assignment (employee_id, valid_from, valid_to, seq, created_by, created_at,
                company_code, area_code, org_unit_code, position_code)
              VALUES (?, ?, ?, 1, ?, ?, 'CO01', 'PA01', 'OU0002', ?)`,
        args: [...common, position],
      },
      {
        sql: `INSERT INTO pa_it0002_personal_data (employee_id, valid_from, valid_to, seq, created_by, created_at,
                first_name, last_name)
              VALUES (?, ?, ?, 1, ?, ?, 'Test', ?)`,
        args: [...common, `Person ${id}`],
      },
      ...(opts.email === false
        ? []
        : [
            {
              sql: `INSERT INTO pa_it0105_communication (employee_id, valid_from, valid_to, seq, created_by, created_at,
                      comm_type, value)
                    VALUES (?, ?, ?, 1, ?, ?, 'Email (official)', ?)`,
              args: [...common, email],
            },
          ]),
    ],
    "write",
  );

  const user = await client.execute({
    sql: `INSERT INTO sec_app_user (username, password_hash, display_name, employee_id, is_active, created_at)
          VALUES (?, 'x', ?, ?, 1, ?) RETURNING id`,
    args: [`user.${id.toLowerCase()}`, `Test Person ${id}`, employeeId, now],
  });
  const userId = Number(user.rows[0].id);
  const roles = opts.roles ?? ["EMPLOYEE"];
  for (const role of roles) {
    await client.execute({
      sql: "INSERT INTO sec_user_role (user_id, role_code) VALUES (?, ?)",
      args: [userId, role],
    });
  }

  return {
    employeeId,
    userId,
    position,
    email,
    session: {
      userId,
      username: `user.${id.toLowerCase()}`,
      displayName: `Test Person ${id}`,
      roles,
      employeeId,
    },
  };
}

/** Runs the Server Functions that follow as this person; `null` goes back to HR. */
export function actAs(session: Session | null): void {
  (globalThis as { __testSession?: Session }).__testSession = session ?? undefined;
}

/** An entitlement for a year, in days. */
export async function giveQuota(employeeId: number, code: string, year: number, days: number): Promise<number> {
  const r = await rawClient().execute({
    sql: `INSERT INTO pt_it2006_absence_quota (employee_id, quota_type_code, year, entitled_half_days, used_half_days, created_at)
          VALUES (?, ?, ?, ?, 0, ?) RETURNING id`,
    args: [employeeId, code, year, days * 2, new Date().toISOString()],
  });
  return Number(r.rows[0].id);
}
