"use server";

import { canAny, can, requireAccess } from "@/lib/access";
import {
  searchEmployees,
  listDirectReports,
  fullName,
} from "@/lib/repositories/employees";

export type PersonHit = {
  id: number;
  name: string;
  detail: string;
  href: string;
};

/**
 * People search for the command menu.
 *
 * Whoever may see every employee searches everyone their roles cover and
 * lands on the employee record. Whoever may see their team searches only
 * their direct reports and lands on the filtered team list, because the
 * employee record itself is an HR screen. Anyone else finds no one: this is
 * reachable by direct POST, so the scope is decided here, not by the menu.
 */
export async function searchPeople(query: string): Promise<PersonHit[]> {
  const session = await requireAccess();
  const q = String(query ?? "").trim();
  if (q.length < 2) return [];

  const isHr = can(session, "employee.view_all");
  if (!canAny(session, "employee.view_all", "employee.view_team")) return [];

  const onlyIds = isHr
    ? undefined
    : session.employeeId
      ? (await listDirectReports(session.employeeId)).map((e) => e.id)
      : [];

  const { rows } = await searchEmployees(
    { q, onlyIds, scope: isHr ? session.scope : null },
    { limit: 6, offset: 0 },
  );

  return rows.map((e) => ({
    id: e.id,
    name: fullName(e),
    detail: [e.employee_number, e.position_title].filter(Boolean).join(", "),
    href: isHr ? `/core-hr/${e.id}` : `/core-hr?q=${encodeURIComponent(e.employee_number)}`,
  }));
}
