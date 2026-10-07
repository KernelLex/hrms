import "server-only";
import type { InValue } from "@libsql/client";
import { rawClient } from "@/lib/db";
import { today } from "@/db/schema/_shared";

/**
 * What the training and certification screens read: the catalogue with its
 * sessions, nominations with who they are for, certifications, and who is
 * missing one their job requires.
 */

type Row = Record<string, unknown>;

async function rows<T = Row>(sql: string, args: InValue[] = []): Promise<T[]> {
  return (await rawClient().execute({ sql, args })).rows as unknown as T[];
}

const s = (v: unknown) => (v === null || v === undefined ? null : String(v));
const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export type Course = { code: string; title: string; description: string | null; costPaise: number; isActive: boolean; sessionCount: number };

export async function listCourses(): Promise<Course[]> {
  const found = await rows(
    `SELECT c.*, (SELECT COUNT(*) FROM ld_session s WHERE s.course_code = c.code) AS session_count
     FROM ld_course c ORDER BY c.is_active DESC, c.title`,
  );
  return found.map((c) => ({ code: String(c.code), title: String(c.title), description: s(c.description), costPaise: Number(c.cost_paise), isActive: Number(c.is_active) === 1, sessionCount: Number(c.session_count) }));
}

export type SessionRow = {
  id: number;
  courseCode: string;
  courseTitle: string;
  startDate: string;
  endDate: string;
  capacity: number;
  place: string | null;
  costPaise: number;
  nominated: number;
  approved: number;
};

export async function listSessions(): Promise<SessionRow[]> {
  const found = await rows(
    `SELECT s.*, c.title AS course_title,
            (SELECT COUNT(*) FROM ld_nomination n WHERE n.session_id = s.id) AS nominated,
            (SELECT COUNT(*) FROM ld_nomination n WHERE n.session_id = s.id AND n.status = 'Approved') AS approved
     FROM ld_session s JOIN ld_course c ON c.code = s.course_code
     ORDER BY s.start_date DESC`,
  );
  return found.map((r) => ({
    id: Number(r.id),
    courseCode: String(r.course_code),
    courseTitle: String(r.course_title),
    startDate: String(r.start_date),
    endDate: String(r.end_date),
    capacity: Number(r.capacity),
    place: s(r.place),
    costPaise: Number(r.cost_paise),
    nominated: Number(r.nominated),
    approved: Number(r.approved),
  }));
}

export type NominationRow = {
  id: number;
  sessionId: number;
  courseTitle: string;
  startDate: string;
  employeeId: number;
  employeeName: string;
  status: string;
  attended: boolean | null;
  feedback: string | null;
};

const NAME_OF = (employeeColumn: string) => `(
  SELECT TRIM(COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, '')) FROM pa_it0002_personal_data p
  WHERE p.employee_id = ${employeeColumn} AND p.valid_from <= ?1 AND p.valid_to >= ?1 ORDER BY p.valid_from DESC LIMIT 1)`;

export async function listNominations(
  filter: { sessionId?: number; employeeId?: number; managerEmployeeId?: number } = {},
): Promise<NominationRow[]> {
  const where: string[] = [];
  const args: InValue[] = [today()];
  if (filter.sessionId) {
    where.push("n.session_id = ?");
    args.push(filter.sessionId);
  }
  if (filter.employeeId) {
    where.push("n.employee_id = ?");
    args.push(filter.employeeId);
  }
  if (filter.managerEmployeeId) {
    // The people who report to this manager today, by the same reporting
    // line approvals are routed through.
    where.push(`n.employee_id IN (
      SELECT mine.employee_id FROM pa_it0001_org_assignment mine
      JOIN om_position pos ON pos.code = mine.position_code
      JOIN pa_it0001_org_assignment theirs ON theirs.position_code = pos.reports_to_code
      WHERE mine.valid_from <= ?1 AND mine.valid_to >= ?1
        AND theirs.valid_from <= ?1 AND theirs.valid_to >= ?1 AND theirs.employee_id = ?)`);
    args.push(filter.managerEmployeeId);
  }
  const found = await rows(
    `SELECT n.*, s.start_date, c.title AS course_title, ${NAME_OF("n.employee_id")} AS name
     FROM ld_nomination n JOIN ld_session s ON s.id = n.session_id JOIN ld_course c ON c.code = s.course_code
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY s.start_date DESC`,
    args,
  );
  return found.map((r) => ({
    id: Number(r.id),
    sessionId: Number(r.session_id),
    courseTitle: String(r.course_title),
    startDate: String(r.start_date),
    employeeId: Number(r.employee_id),
    employeeName: s(r.name) ?? "—",
    status: String(r.status),
    attended: r.attended === null ? null : Number(r.attended) === 1,
    feedback: s(r.feedback),
  }));
}

export type CertificationRow = {
  id: number;
  employeeId: number;
  employeeName: string;
  name: string;
  issuer: string | null;
  issuedDate: string;
  expiryDate: string | null;
  documentId: number | null;
};

export async function listCertifications(employeeId?: number): Promise<CertificationRow[]> {
  const found = await rows(
    `SELECT c.*, ${NAME_OF("c.employee_id")} AS employee_name
     FROM ld_certification c
     ${employeeId ? "WHERE c.employee_id = ?2" : ""}
     ORDER BY c.expiry_date IS NULL, c.expiry_date`,
    employeeId ? [today(), employeeId] : [today()],
  );
  return found.map((c) => ({
    id: Number(c.id),
    employeeId: Number(c.employee_id),
    employeeName: s(c.employee_name) ?? "—",
    name: String(c.name),
    issuer: s(c.issuer),
    issuedDate: String(c.issued_date),
    expiryDate: s(c.expiry_date),
    documentId: n(c.document_id),
  }));
}

export type ComplianceRow = { employeeId: number; employeeName: string; jobTitle: string; missing: string[] };

/** Everyone whose job requires a certification they do not currently hold, valid and not expired. */
export async function certificationComplianceReport(): Promise<ComplianceRow[]> {
  const requirements = await rows(
    `SELECT r.job_code, r.name, j.title AS job_title FROM ld_certification_requirement r JOIN om_job j ON j.code = r.job_code`,
  );
  if (requirements.length === 0) return [];

  const employees = await rows(
    `SELECT e.id, p.job_code, j.title AS job_title, ${NAME_OF("e.id")} AS name
     FROM pa_employee e
     JOIN pa_it0001_org_assignment o ON o.employee_id = e.id AND o.valid_from <= ?1 AND o.valid_to >= ?1
     JOIN om_position p ON p.code = o.position_code
     JOIN om_job j ON j.code = p.job_code
     WHERE e.employment_status <> 'Terminated'`,
    [today()],
  );

  const held = await rows(
    `SELECT employee_id, name FROM ld_certification WHERE expiry_date IS NULL OR expiry_date >= ?1`,
    [today()],
  );
  const heldBy = new Map<number, Set<string>>();
  for (const h of held) {
    const id = Number(h.employee_id);
    if (!heldBy.has(id)) heldBy.set(id, new Set());
    heldBy.get(id)!.add(String(h.name));
  }

  const byJob = new Map<string, string[]>();
  for (const r of requirements) {
    const code = String(r.job_code);
    byJob.set(code, [...(byJob.get(code) ?? []), String(r.name)]);
  }

  const result: ComplianceRow[] = [];
  for (const e of employees) {
    const required = byJob.get(String(e.job_code));
    if (!required) continue;
    const has = heldBy.get(Number(e.id)) ?? new Set();
    const missing = required.filter((name) => !has.has(name));
    if (missing.length > 0) {
      result.push({ employeeId: Number(e.id), employeeName: s(e.name) ?? "—", jobTitle: String(e.job_title), missing });
    }
  }
  return result;
}

export type DepartmentBudgetRow = { id: number; orgUnitCode: string; departmentName: string; year: number; allocatedPaise: number; spentPaise: number };

export async function listDepartmentBudgets(): Promise<DepartmentBudgetRow[]> {
  const found = await rows(
    `SELECT b.*, ou.name AS department_name,
            COALESCE((SELECT SUM(s.cost_paise) FROM ld_nomination n JOIN ld_session s ON s.id = n.session_id
                      JOIN pa_it0001_org_assignment o ON o.employee_id = n.employee_id AND o.valid_from <= date('now') AND o.valid_to >= date('now')
                      WHERE n.status = 'Approved' AND o.org_unit_code = b.org_unit_code AND CAST(strftime('%Y', s.start_date) AS INTEGER) = b.year), 0) AS spent_paise
     FROM ld_department_budget b JOIN om_org_unit ou ON ou.code = b.org_unit_code
     ORDER BY b.year DESC, ou.name`,
  );
  return found.map((b) => ({ id: Number(b.id), orgUnitCode: String(b.org_unit_code), departmentName: String(b.department_name), year: Number(b.year), allocatedPaise: Number(b.allocated_paise), spentPaise: Number(b.spent_paise) }));
}

export type CertificationRequirementRow = { id: number; jobCode: string; jobTitle: string; name: string };

export async function listCertificationRequirements(): Promise<CertificationRequirementRow[]> {
  const found = await rows(`SELECT r.*, j.title AS job_title FROM ld_certification_requirement r JOIN om_job j ON j.code = r.job_code ORDER BY j.title, r.name`);
  return found.map((r) => ({ id: Number(r.id), jobCode: String(r.job_code), jobTitle: String(r.job_title), name: String(r.name) }));
}
