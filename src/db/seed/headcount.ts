import type { Client } from "@libsql/client";

/**
 * One headcount request waiting for HR: Ravi Kumar (IT manager) has asked
 * for a QA engineer, so the Headcount requests tab of the approvals inbox
 * has something real to decide. Ravi has no manager above him, so step 1
 * falls straight to HR — the engine's own rule for a step nobody can fill,
 * exactly as it would for any top-of-department manager. Written directly,
 * the way the service would have written it. Idempotent.
 */
export async function seedHeadcount(client: Client): Promise<string[]> {
  const exists = await client.execute("SELECT 1 FROM om_headcount_request LIMIT 1");
  if (exists.rows.length > 0) return [];

  const ravi = (
    await client.execute(
      `SELECT e.id AS employee_id, u.id AS user_id FROM pa_employee e JOIN sec_app_user u ON u.employee_id = e.id
       WHERE e.employee_number = 'EMP1000'`,
    )
  ).rows[0];
  const flow = (await client.execute("SELECT id FROM wf_flow WHERE process = 'headcount' AND is_active = 1 ORDER BY version DESC LIMIT 1")).rows[0];
  const hrUsers = await client.execute(
    "SELECT u.id FROM sec_user_role ur JOIN sec_app_user u ON u.id = ur.user_id AND u.is_active = 1 WHERE ur.role_code = 'HR_ADMIN'",
  );
  if (!ravi || !flow || hrUsers.rows.length === 0) return ["  no headcount request seeded: Ravi, the headcount flow, or HR is missing"];

  const at = new Date().toISOString();
  const request = await client.execute({
    sql: `INSERT INTO om_headcount_request
            (org_unit_code, job_code, title, grade, budget_paise, reason, requested_by_employee_id,
             requested_by_name, status, requested_at)
          VALUES ('OU0002', 'JB0001', 'QA engineer', 'L2', 6000000, 'The application team ships weekly now and testing cannot keep up.',
             ?, 'Ravi Kumar', 'Pending', ?) RETURNING id`,
    args: [Number(ravi.employee_id), at],
  });
  const requestId = Number(request.rows[0].id);

  const wf = await client.execute({
    sql: `INSERT INTO wf_request (process, flow_id, subject_type, subject_id, subject_employee_id, requester_user_id, summary, facts,
            status, current_step, step_started_at, created_at)
          VALUES ('headcount', ?, 'om_headcount_request', ?, ?, ?, 'Ravi Kumar: QA engineer in Application development', '{}', 'Pending', 1, ?, ?) RETURNING id`,
    args: [Number(flow.id), String(requestId), Number(ravi.employee_id), Number(ravi.user_id), at, at],
  });
  const wfRequestId = Number(wf.rows[0].id);

  await client.batch(
    [
      ...hrUsers.rows.map((u) => ({
        sql: `INSERT OR IGNORE INTO wf_assignee (request_id, step_order, user_id, reason) VALUES (?, 1, ?, 'step')`,
        args: [wfRequestId, Number(u.id)],
      })),
      {
        sql: `INSERT INTO wf_action (request_id, step_order, actor_type, actor_user_id, actor_name, decision, at)
              VALUES (?, 0, 'user', ?, 'ravi.kumar', 'Submitted', ?)`,
        args: [wfRequestId, Number(ravi.user_id), at],
      },
    ],
    "write",
  );
  return ["  1 headcount request waiting for HR: Ravi's QA engineer"];
}
