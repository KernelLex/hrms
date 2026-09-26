"use server";

import { requireSession, hasRole } from "@/lib/auth";
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
 * HR searches everyone and lands on the employee record. A manager searches
 * only their direct reports and lands on the filtered team list, because the
 * employee record itself is an HR screen. Anyone else finds no one: this is
 * reachable by direct POST, so the scope is decided here, not by the menu.
 */
export async function searchPeople(query: string): Promise<PersonHit[]> {
  const session = await requireSession();
  const q = String(query ?? "").trim();
  if (q.length < 2) return [];

  const isHr = hasRole(session, "HR_ADMIN");
  if (!isHr && !hasRole(session, "MANAGER")) return [];

  const onlyIds = isHr
    ? undefined
    : session.employeeId
      ? (await listDirectReports(session.employeeId)).map((e) => e.id)
      : [];

  const { rows } = await searchEmployees({ q, onlyIds }, { limit: 6, offset: 0 });

  return rows.map((e) => ({
    id: e.id,
    name: fullName(e),
    detail: [e.employee_number, e.position_title].filter(Boolean).join(", "),
    href: isHr ? `/core-hr/${e.id}` : `/core-hr?q=${encodeURIComponent(e.employee_number)}`,
  }));
}
