import type { Client } from "@libsql/client";

/**
 * One correction waiting for HR: Arjun has asked for his permanent address to
 * change, so the Corrections tab of the approvals inbox has something real to
 * decide. Written directly — the seed runs outside the app — the way the
 * service would have written it. Idempotent.
 */
export async function seedCorrections(client: Client): Promise<string[]> {
  const exists = await client.execute("SELECT 1 FROM pa_change_request LIMIT 1");
  if (exists.rows.length > 0) return [];
  const arjun = (
    await client.execute(
      `SELECT e.id AS employee_id, u.id AS user_id FROM pa_employee e JOIN sec_app_user u ON u.employee_id = e.id
       WHERE e.employee_number = 'EMP1001'`,
    )
  ).rows[0];
  const flow = (await client.execute("SELECT id FROM wf_flow WHERE process = 'correction' AND is_active = 1 ORDER BY version DESC LIMIT 1")).rows[0];
  if (!arjun || !flow) return ["  no correction seeded: Arjun or the corrections flow is missing"];

  const employeeId = Number(arjun.employee_id);
  const current = (
    await client.execute({
      sql: `SELECT line, city, state, postal_code, country FROM pa_it0006_address
            WHERE employee_id = ? AND address_type = 'Permanent' ORDER BY valid_from DESC LIMIT 1`,
      args: [employeeId],
    })
  ).rows[0];
  const now = new Date();
  const at = now.toISOString();
  const from = new Date(now.getTime() + 14 * 86_400_000).toISOString().slice(0, 10);
  const proposed = { line: "45, 2nd Main, HAL 2nd Stage, Indiranagar", city: "Bengaluru", state: "Karnataka", postal_code: "560008", country: "India" };

  const request = await client.execute({
    sql: `INSERT INTO pa_change_request (employee_id, section, subtype, proposed, current, effective_date, note, status, channel,
            requested_by_user_id, requested_by_name, requested_at)
          VALUES (?, 'address', 'Permanent', ?, ?, ?, 'Moving closer to the office.', 'Pending', 'self', ?, 'Arjun Mehta', ?) RETURNING id`,
    args: [
      employeeId,
      JSON.stringify(proposed),
      current
        ? JSON.stringify({ line: current.line, city: current.city, state: current.state, postal_code: current.postal_code, country: current.country })
        : null,
      from,
      Number(arjun.user_id),
      at,
    ],
  });
  const changeId = Number(request.rows[0].id);
  const d = new Date(`${from}T00:00:00Z`);
  const label = `${d.getUTCDate()} ${["Jan", "Feb", "Mar", "Apr", "May", "June", "July", "Aug", "Sept", "Oct", "Nov", "Dec"][d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  const wf = await client.execute({
    sql: `INSERT INTO wf_request (process, flow_id, subject_type, subject_id, subject_employee_id, requester_user_id, summary, facts,
            status, current_step, step_started_at, created_at)
          VALUES ('correction', ?, 'pa_change_request', ?, ?, ?, ?, '{"bank":0}', 'Pending', 1, ?, ?) RETURNING id`,
    args: [Number(flow.id), String(changeId), employeeId, Number(arjun.user_id), `Arjun Mehta: permanent address from ${label}`, at, at],
  });
  const requestId = Number(wf.rows[0].id);
  await client.batch(
    [
      {
        sql: `INSERT OR IGNORE INTO wf_assignee (request_id, step_order, user_id, reason)
              SELECT ?, 1, u.id, 'step' FROM sec_user_role ur JOIN sec_app_user u ON u.id = ur.user_id AND u.is_active = 1
              WHERE ur.role_code = 'HR_ADMIN'`,
        args: [requestId],
      },
      {
        sql: `INSERT INTO wf_action (request_id, step_order, actor_type, actor_user_id, actor_name, decision, at)
              VALUES (?, 0, 'user', ?, 'arjun.mehta', 'Submitted', ?)`,
        args: [requestId, Number(arjun.user_id), at],
      },
    ],
    "write",
  );
  return ["  1 correction waiting for HR: Arjun's new permanent address"];
}
