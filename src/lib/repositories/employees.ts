import "server-only";
import { rawClient } from "@/lib/db";
import { today } from "@/db/schema/_shared";

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

export { today };

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

/* ------------------------------------------------------------ searching */

export type EmployeeFilter = {
  /** Matches name, employee number, position or department. */
  q?: string;
  status?: string;
  unit?: string;
  /** Restrict to these employees — a manager's direct reports. */
  onlyIds?: number[];
  /** Restrict to these companies or personnel areas — a scoped role. Null for everyone. */
  scope?: { companies: string[]; areas: string[] } | null;
};

/**
 * WHERE clause for a filter. Placeholders are numbered from 2, because ?1 is
 * the as-of date that AS_OF_SELECT already uses.
 */
function filterSql(filter: EmployeeFilter): { where: string; args: (string | number)[] } {
  const clauses: string[] = [];
  const args: (string | number)[] = [];
  const bind = (value: string | number) => {
    args.push(value);
    return `?${args.length + 1}`;
  };

  const q = filter.q?.trim().toLowerCase();
  if (q) {
    // Every word must match somewhere, so "ravi it" finds Ravi in IT.
    for (const word of q.split(/\s+/)) {
      clauses.push(`lower(
        coalesce(e.employee_number, '') || ' ' || coalesce(p.first_name, '') || ' ' ||
        coalesce(p.last_name, '') || ' ' || coalesce(pos.title, '') || ' ' || coalesce(ou.name, '')
      ) LIKE ${bind(`%${word.replace(/[%_]/g, "")}%`)}`);
    }
  }
  if (filter.status) clauses.push(`e.employment_status = ${bind(filter.status)}`);
  if (filter.unit) clauses.push(`ou.name = ${bind(filter.unit)}`);
  if (filter.onlyIds) {
    clauses.push(
      filter.onlyIds.length === 0
        ? "0"
        : `e.id IN (${filter.onlyIds.map((id) => bind(id)).join(", ")})`,
    );
  }
  if (filter.scope) {
    const { companies, areas } = filter.scope;
    const parts = [
      ...(companies.length ? [`o.company_code IN (${companies.map((c) => bind(c)).join(", ")})`] : []),
      ...(areas.length ? [`o.area_code IN (${areas.map((a) => bind(a)).join(", ")})`] : []),
    ];
    clauses.push(parts.length ? `(${parts.join(" OR ")})` : "0");
  }
  return { where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", args };
}

/**
 * One page of employees matching a filter, and how many match in total.
 *
 * Filtering and paging happen in SQL rather than by loading every employee and
 * slicing in JavaScript, which is fine at three people and wrong at three
 * thousand.
 */
export async function searchEmployees(
  filter: EmployeeFilter,
  page: { limit: number; offset: number },
  asOf: string = today(),
): Promise<{ rows: EmployeeRow[]; total: number }> {
  const { where, args } = filterSql(filter);
  const limit = Math.max(1, Math.floor(page.limit));
  const offset = Math.max(0, Math.floor(page.offset));

  const client = rawClient();
  const [rows, count] = await Promise.all([
    client.execute({
      sql: `${AS_OF_SELECT} ${where} ORDER BY e.employee_number LIMIT ${limit} OFFSET ${offset}`,
      args: [asOf, ...args],
    }),
    client.execute({
      sql: `SELECT COUNT(*) AS n FROM (${AS_OF_SELECT} ${where})`,
      args: [asOf, ...args],
    }),
  ]);
  return {
    rows: rows.rows as unknown as EmployeeRow[],
    total: Number(count.rows[0].n),
  };
}

/** Department names in use, for the list's filter. */
export async function listDepartmentNames(): Promise<string[]> {
  const result = await rawClient().execute(
    "SELECT DISTINCT name FROM om_org_unit WHERE is_active = 1 ORDER BY name",
  );
  return result.rows.map((r) => String(r.name));
}
