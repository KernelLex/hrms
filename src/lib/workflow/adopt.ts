/**
 * Puts leave requests that were pending before the approval engine existed
 * onto it: a request on the first leave flow, assigned to the employee's
 * reporting manager, or to HR where they have none — exactly who decided
 * them before.
 *
 * Plain SQL, so migration 0008 and the seed run the same statements. Safe to
 * run twice: a request already on the engine is left alone.
 */
export const ADOPT_PENDING_LEAVE: string[] = [
  `INSERT OR IGNORE INTO wf_request
     (process, flow_id, subject_type, subject_id, subject_employee_id, requester_user_id,
      summary, facts, status, current_step, step_started_at, created_at)
   SELECT 'leave',
          (SELECT id FROM wf_flow WHERE process = 'leave' ORDER BY version LIMIT 1),
          'pt_leave_request', CAST(lr.id AS TEXT), lr.employee_id,
          (SELECT u.id FROM sec_app_user u WHERE u.employee_id = lr.employee_id AND u.is_active = 1 LIMIT 1),
          COALESCE((SELECT p.first_name || ' ' || p.last_name FROM pa_it0002_personal_data p
                    WHERE p.employee_id = lr.employee_id ORDER BY p.valid_from DESC LIMIT 1), 'An employee')
            || ': ' || lr.payroll_days || ' days of '
            || lower(COALESCE((SELECT t.name FROM pt_absence_type t WHERE t.code = lr.absence_type_code), 'leave')),
          json_object('days', lr.payroll_days),
          'Pending', 1, lr.submitted_at, lr.submitted_at
   FROM pt_leave_request lr
   WHERE lr.status = 'Pending'`,
  `INSERT OR IGNORE INTO wf_assignee (request_id, step_order, user_id, reason)
   SELECT r.id, 1, u.id, 'step'
   FROM wf_request r
   JOIN pa_it0001_org_assignment mine
     ON mine.employee_id = r.subject_employee_id
    AND mine.valid_from <= date('now') AND mine.valid_to >= date('now')
   JOIN om_position pos ON pos.code = mine.position_code
   JOIN pa_it0001_org_assignment theirs
     ON theirs.position_code = pos.reports_to_code
    AND theirs.valid_from <= date('now') AND theirs.valid_to >= date('now')
   JOIN sec_app_user u ON u.employee_id = theirs.employee_id AND u.is_active = 1
   WHERE r.process = 'leave' AND r.status = 'Pending'
     AND NOT EXISTS (SELECT 1 FROM wf_action a WHERE a.request_id = r.id)`,
  `INSERT OR IGNORE INTO wf_assignee (request_id, step_order, user_id, reason)
   SELECT r.id, 1, ur.user_id, 'step'
   FROM wf_request r
   JOIN sec_user_role ur ON ur.role_code = 'HR_ADMIN'
   JOIN sec_app_user u ON u.id = ur.user_id AND u.is_active = 1
   WHERE r.process = 'leave' AND r.status = 'Pending'
     AND NOT EXISTS (SELECT 1 FROM wf_assignee a WHERE a.request_id = r.id)
     AND NOT EXISTS (SELECT 1 FROM wf_action a WHERE a.request_id = r.id)`,
  `INSERT INTO wf_action (request_id, step_order, actor_type, actor_user_id, actor_name, decision, at)
   SELECT r.id, 0, 'user', r.requester_user_id, COALESCE(u.username, 'unknown'), 'Submitted', r.created_at
   FROM wf_request r
   LEFT JOIN sec_app_user u ON u.id = r.requester_user_id
   WHERE r.process = 'leave'
     AND NOT EXISTS (SELECT 1 FROM wf_action a WHERE a.request_id = r.id)`,
];
