import "server-only";
import { rawClient } from "@/lib/db";
import { getEmployee, type EmployeeRow } from "@/lib/repositories/employees";

/**
 * An employee's own record, for their profile: what HR holds about them, as
 * it stands today, in one round trip.
 */

export type Profile = {
  employee: EmployeeRow;
  personal: {
    dateOfBirth: string | null;
    gender: string | null;
    maritalStatus: string | null;
    nationality: string | null;
  } | null;
  addresses: { type: string; line: string; city: string | null; state: string | null; postalCode: string | null; country: string | null }[];
  contacts: { type: string; value: string }[];
  bank: { bankName: string; accountEnding: string; ifsc: string | null; holderName: string | null } | null;
  schedule: { name: string; weeklyHours: number; percent: number } | null;
  managerName: string | null;
  viewedBy: { at: string; name: string; resource: string }[];
  /** The employee's own correction requests, newest first. */
  requests: {
    id: number;
    section: string;
    subtype: string | null;
    effectiveDate: string;
    status: string;
    requestedAt: string;
    decisionNote: string | null;
    /** Who asked for it: the employee themselves, HR, or a connected system. */
    requestedByName: string;
    channel: string;
    /** Whoever it is waiting on right now, while it is pending. */
    waitingOn: string | null;
  }[];
};

/** "••••••••4321": enough to recognise an account, not enough to use it. */
export function maskAccount(account: string): string {
  const tail = account.slice(-4);
  return `${"•".repeat(Math.max(4, account.length - 4))}${tail}`.slice(-12);
}

export async function getProfile(employeeId: number, today: string): Promise<Profile | null> {
  const employee = await getEmployee(employeeId, today);
  if (!employee) return null;

  const valid = "employee_id = ?1 AND valid_from <= ?2 AND valid_to >= ?2";
  const [personal, addresses, contacts, bank, schedule, manager, viewed, requests] = await rawClient().batch(
    [
      {
        sql: `SELECT date_of_birth, gender, marital_status, nationality
              FROM pa_it0002_personal_data WHERE ${valid} LIMIT 1`,
        args: [employeeId, today],
      },
      {
        sql: `SELECT address_type, line, city, state, postal_code, country
              FROM pa_it0006_address WHERE ${valid} ORDER BY address_type`,
        args: [employeeId, today],
      },
      {
        sql: `SELECT comm_type, value FROM pa_it0105_communication WHERE ${valid} ORDER BY comm_type`,
        args: [employeeId, today],
      },
      {
        sql: `SELECT bank_name, account_number, ifsc, holder_name FROM pa_it0009_bank_details WHERE ${valid} LIMIT 1`,
        args: [employeeId, today],
      },
      {
        sql: `SELECT w.name, t.weekly_hours, t.employment_percent
              FROM pa_it0007_planned_working_time t
              JOIN pt_work_schedule_rule w ON w.code = t.work_schedule_code
              WHERE t.employee_id = ?1 AND t.valid_from <= ?2 AND t.valid_to >= ?2 LIMIT 1`,
        args: [employeeId, today],
      },
      {
        // Whoever holds the position this person's position reports to.
        sql: `SELECT p.first_name || ' ' || p.last_name AS name
              FROM pa_it0001_org_assignment mine
              JOIN om_position pos ON pos.code = mine.position_code
              JOIN pa_it0001_org_assignment theirs
                ON theirs.position_code = pos.reports_to_code
               AND theirs.valid_from <= ?2 AND theirs.valid_to >= ?2
              JOIN pa_it0002_personal_data p
                ON p.employee_id = theirs.employee_id AND p.valid_from <= ?2 AND p.valid_to >= ?2
              WHERE mine.employee_id = ?1 AND mine.valid_from <= ?2 AND mine.valid_to >= ?2
              LIMIT 1`,
        args: [employeeId, today],
      },
      {
        // Reads by anyone other than the person themselves.
        sql: `SELECT l.at, l.resource, COALESCE(u.display_name, l.username) AS name
              FROM app_access_log l
              LEFT JOIN sec_app_user u ON u.id = l.user_id
              WHERE l.subject_employee_id = ?1 AND (u.employee_id IS NULL OR u.employee_id != ?1)
              ORDER BY l.at DESC LIMIT 20`,
        args: [employeeId],
      },
      {
        // Who asked, and who it is sitting with: a request that says only
        // "waiting" tells its own employee nothing they can act on.
        sql: `SELECT cr.id, cr.section, cr.subtype, cr.effective_date, cr.status, cr.requested_at,
                     cr.decision_note, cr.requested_by_name, cr.channel,
                     (SELECT GROUP_CONCAT(u.display_name, ', ')
                        FROM wf_request r
                        JOIN wf_assignee a ON a.request_id = r.id AND a.step_order = r.current_step
                        JOIN sec_app_user u ON u.id = a.user_id
                       WHERE r.subject_type = 'pa_change_request' AND r.subject_id = CAST(cr.id AS TEXT)
                         AND r.status = 'Pending') AS waiting_on
              FROM pa_change_request cr WHERE cr.employee_id = ?1 ORDER BY cr.id DESC LIMIT 10`,
        args: [employeeId],
      },
    ],
    "read",
  );

  const p = personal.rows[0];
  const b = bank.rows[0];
  const s = schedule.rows[0];
  const str = (v: unknown) => (v === null || v === undefined ? null : String(v));

  return {
    employee,
    personal: p
      ? {
          dateOfBirth: str(p.date_of_birth),
          gender: str(p.gender),
          maritalStatus: str(p.marital_status),
          nationality: str(p.nationality),
        }
      : null,
    addresses: addresses.rows.map((a) => ({
      type: String(a.address_type),
      line: String(a.line),
      city: str(a.city),
      state: str(a.state),
      postalCode: str(a.postal_code),
      country: str(a.country),
    })),
    contacts: contacts.rows.map((c) => ({ type: String(c.comm_type), value: String(c.value) })),
    bank: b
      ? {
          bankName: String(b.bank_name),
          accountEnding: maskAccount(String(b.account_number)),
          ifsc: str(b.ifsc),
          holderName: str(b.holder_name),
        }
      : null,
    schedule: s
      ? { name: String(s.name), weeklyHours: Number(s.weekly_hours), percent: Number(s.employment_percent) }
      : null,
    managerName: str(manager.rows[0]?.name),
    viewedBy: viewed.rows.map((v) => ({ at: String(v.at), name: String(v.name), resource: String(v.resource) })),
    requests: requests.rows.map((q) => ({
      id: Number(q.id),
      section: String(q.section),
      subtype: str(q.subtype),
      effectiveDate: String(q.effective_date),
      status: String(q.status),
      requestedAt: String(q.requested_at),
      decisionNote: str(q.decision_note),
      requestedByName: String(q.requested_by_name),
      channel: String(q.channel),
      waitingOn: str(q.waiting_on),
    })),
  };
}
