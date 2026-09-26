import "server-only";
import { rawClient } from "@/lib/db";

/**
 * Employee reads that resolve time-sliced infotypes to a single date.
 *
 * Written as SQL rather than through the query builder because every one of
 * these is the same shape — join each infotype on the slice valid at a date —
 * and that predicate is clearer stated once, literally.
 */

export type EmployeeRow = {
  id: number;
  employee_number: string;
  hire_date: string;
  employment_status: string;
  first_name: string | null;
  last_name: string | null;
  position_code: string | null;
  position_title: string | null;
  org_unit_code: string | null;
  org_unit_name: string | null;
  company_code: string | null;
  cost_center: string | null;
  amount_paise: number | null;
  pay_scale_group: string | null;
  currency: string | null;
};

const AS_OF_SELECT = `
  SELECT
    e.id, e.employee_number, e.hire_date, e.employment_status,
    p.first_name, p.last_name,
    o.position_code, o.org_unit_code, o.company_code, o.cost_center,
    pos.title  AS position_title,
    ou.name    AS org_unit_name,
    bp.amount_paise, bp.pay_scale_group, bp.currency
  FROM pa_employee e
  LEFT JOIN pa_it0002_personal_data p
    ON p.employee_id = e.id AND p.valid_from <= ?1 AND p.valid_to >= ?1
  LEFT JOIN pa_it0001_org_assignment o
    ON o.employee_id = e.id AND o.valid_from <= ?1 AND o.valid_to >= ?1
  LEFT JOIN pa_it0008_basic_pay bp
    ON bp.employee_id = e.id AND bp.valid_from <= ?1 AND bp.valid_to >= ?1
  LEFT JOIN om_position pos ON pos.code = o.position_code
  LEFT JOIN om_org_unit  ou  ON ou.code  = o.org_unit_code
`;

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function listEmployees(
  asOf: string = today(),
): Promise<EmployeeRow[]> {
  const result = await rawClient().execute({
    sql: `${AS_OF_SELECT} ORDER BY e.employee_number`,
    args: [asOf],
  });
  return result.rows as unknown as EmployeeRow[];
}

export async function getEmployee(
  id: number,
  asOf: string = today(),
): Promise<EmployeeRow | undefined> {
  const result = await rawClient().execute({
    sql: `${AS_OF_SELECT} WHERE e.id = ?2`,
    args: [asOf, id],
  });
  return result.rows[0] as unknown as EmployeeRow | undefined;
}

export function fullName(r: {
  first_name: string | null;
  last_name: string | null;
  employee_number: string;
}): string {
  const name = [r.first_name, r.last_name].filter(Boolean).join(" ");
  return name || r.employee_number;
}

/** Employees reporting into a manager's position, for the manager views. */
export async function listDirectReports(
  managerEmployeeId: number,
  asOf: string = today(),
): Promise<EmployeeRow[]> {
  const mgr = await rawClient().execute({
    sql: `SELECT position_code FROM pa_it0001_org_assignment
          WHERE employee_id = ?2 AND valid_from <= ?1 AND valid_to >= ?1
          LIMIT 1`,
    args: [asOf, managerEmployeeId],
  });
  const position = mgr.rows[0]?.position_code as string | undefined;
  if (!position) return [];

  const result = await rawClient().execute({
    sql: `${AS_OF_SELECT}
          WHERE pos.reports_to_code = ?2
          ORDER BY e.employee_number`,
    args: [asOf, position],
  });
  return result.rows as unknown as EmployeeRow[];
}
