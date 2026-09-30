import type { Client } from "@libsql/client";

/**
 * Shifts, a rotating three-shift roster pattern, one device, and — for the
 * head office's first employee — a roster running from three days ago
 * through the week ahead, with punches showing a present day, a late day
 * and an absence, so the attendance board and My attendance are not empty
 * on first look. Written directly, the way the service would have written
 * it: the engine itself is guarded for the Next.js server, and this script
 * runs standalone. Idempotent.
 */

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  return Math.round((new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86_400_000);
}

/** date + "HH:MM" in India time, as the UTC instant pt_punch.at stores. */
function istTime(date: string, hhmm: string): string {
  return new Date(`${date}T${hhmm}:00+05:30`).toISOString();
}

function todayInIndia(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

const SHIFTS = [
  { code: "MORNING", name: "Morning shift", startTime: "06:00", endTime: "14:00" },
  { code: "AFTERNOON", name: "Afternoon shift", startTime: "14:00", endTime: "22:00" },
  { code: "NIGHT", name: "Night shift", startTime: "22:00", endTime: "06:00", isNight: true },
];

function shiftForIndex(dayIndex: number): string {
  return dayIndex < 7 ? "MORNING" : dayIndex < 14 ? "AFTERNOON" : "NIGHT";
}

export async function seedAttendance(client: Client): Promise<string[]> {
  const exists = await client.execute("SELECT 1 FROM pt_shift LIMIT 1");
  if (exists.rows.length > 0) return [];

  for (const s of SHIFTS) {
    await client.execute({
      sql: `INSERT INTO pt_shift (code, name, start_time, end_time, break_minutes, is_night, grace_minutes, is_active)
            VALUES (?, ?, ?, ?, 30, ?, 10, 1)`,
      args: [s.code, s.name, s.startTime, s.endTime, s.isNight ? 1 : 0],
    });
  }

  await client.execute(
    "INSERT INTO pt_roster_pattern (code, name, cycle_length_days, is_active) VALUES ('THREE-SHIFT', 'Rotating three-shift', 21, 1)",
  );
  for (let dayIndex = 0; dayIndex < 21; dayIndex += 1) {
    await client.execute({
      sql: "INSERT INTO pt_roster_pattern_day (pattern_code, day_index, shift_code) VALUES ('THREE-SHIFT', ?, ?)",
      args: [dayIndex, shiftForIndex(dayIndex)],
    });
  }

  await client.execute(
    "INSERT INTO pt_device (code, name, location, is_active) VALUES ('GATE-1', 'Head office main gate', 'Bengaluru head office', 1)",
  );

  const arjun = (await client.execute("SELECT id FROM pa_employee WHERE employee_number = 'EMP1001'")).rows[0];
  if (!arjun) return ["  3 shifts, 1 roster pattern (rotating three-shift), 1 device"];
  const employeeId = Number(arjun.id);
  const createdAt = new Date().toISOString();

  // Day 0 of the cycle is three days ago, so the last three days and the
  // week ahead all fall in the morning week — a believable, unsurprising
  // first look, whatever day this seed happens to run.
  const today = todayInIndia();
  const patternStart = addDays(today, -3);
  const rosterEnd = addDays(today, 4);
  for (let d = patternStart; d <= rosterEnd; d = addDays(d, 1)) {
    const dayIndex = daysBetween(patternStart, d) % 21;
    await client.execute({
      sql: `INSERT INTO pt_roster (employee_id, date, shift_code, pattern_code, created_by, created_at)
            VALUES (?, ?, ?, 'THREE-SHIFT', 'seed', ?)`,
      args: [employeeId, d, shiftForIndex(dayIndex), createdAt],
    });
  }

  // Two days ago: on time. Yesterday: late. Three days ago: absent, with a
  // regularisation waiting on the manager for it.
  const onTime = addDays(today, -2);
  const lateDay = addDays(today, -1);
  const absentDay = addDays(today, -3);

  const punches: { at: string; direction: "In" | "Out" }[] = [
    { at: istTime(onTime, "05:58"), direction: "In" },
    { at: istTime(onTime, "13:58"), direction: "Out" },
    { at: istTime(lateDay, "06:27"), direction: "In" },
    { at: istTime(lateDay, "14:10"), direction: "Out" },
  ];
  for (const p of punches) {
    await client.execute({
      sql: `INSERT INTO pt_punch (employee_id, device_code, at, direction, source, created_at)
            VALUES (?, 'GATE-1', ?, ?, 'Device', ?)
            ON CONFLICT (device_code, at, employee_id) DO NOTHING`,
      args: [employeeId, p.at, p.direction, createdAt],
    });
  }

  // Finalised the same way the daily job would: on time is exactly the
  // shift's 450 scheduled minutes (480 less a 30-minute break), so no
  // overtime; late is past the shift's 10-minute grace, and short of the
  // full 450, so none either.
  const days = [
    { date: onTime, firstIn: istTime(onTime, "05:58"), lastOut: istTime(onTime, "13:58"), worked: 450, late: 0, status: "Present" },
    { date: lateDay, firstIn: istTime(lateDay, "06:27"), lastOut: istTime(lateDay, "14:10"), worked: 433, late: 17, status: "Late" },
    { date: absentDay, firstIn: null, lastOut: null, worked: 0, late: 0, status: "Absent" },
  ];
  for (const d of days) {
    await client.execute({
      sql: `INSERT INTO pt_attendance_day (employee_id, date, shift_code, first_in, last_out, worked_minutes, late_minutes, overtime_minutes, status, finalised_at)
            VALUES (?, ?, 'MORNING', ?, ?, ?, ?, 0, ?, ?)
            ON CONFLICT (employee_id, date) DO NOTHING`,
      args: [employeeId, d.date, d.firstIn, d.lastOut, d.worked, d.late, d.status, createdAt],
    });
  }

  // The regularisation for the missed day, waiting on Arjun's manager —
  // written the way the service would, like the seeded headcount request.
  const requester = (
    await client.execute({
      sql: "SELECT e.id AS employee_id, u.id AS user_id, u.username FROM pa_employee e JOIN sec_app_user u ON u.employee_id = e.id WHERE e.id = ?",
      args: [employeeId],
    })
  ).rows[0];
  const flow = (await client.execute("SELECT id FROM wf_flow WHERE process = 'regularisation' AND is_active = 1 ORDER BY version DESC LIMIT 1")).rows[0];
  // The same lookup the engine's own resolveApprovers makes for a
  // reporting_manager step, falling back to HR when there is nobody above.
  const managerRows = await client.execute({
    sql: `SELECT DISTINCT u.id AS user_id
          FROM pa_it0001_org_assignment mine
          JOIN om_position pos ON pos.code = mine.position_code
          JOIN pa_it0001_org_assignment theirs
            ON theirs.position_code = pos.reports_to_code
           AND theirs.valid_from <= ?1 AND theirs.valid_to >= ?1
          JOIN sec_app_user u ON u.employee_id = theirs.employee_id AND u.is_active = 1
          WHERE mine.valid_from <= ?1 AND mine.valid_to >= ?1 AND mine.employee_id = ?2`,
    args: [today, employeeId],
  });
  const assignees =
    managerRows.rows.length > 0
      ? managerRows.rows.map((m) => Number(m.user_id))
      : (
          await client.execute(
            "SELECT u.id FROM sec_user_role ur JOIN sec_app_user u ON u.id = ur.user_id AND u.is_active = 1 WHERE ur.role_code = 'HR_ADMIN'",
          )
        ).rows.map((u) => Number(u.id));

  let regularisationNote = "";
  if (requester && flow) {
    const existing = await client.execute({ sql: "SELECT 1 FROM pt_regularisation WHERE employee_id = ? AND date = ?", args: [employeeId, absentDay] });
    if (existing.rows.length === 0) {
      const claimedIn = istTime(absentDay, "06:02");
      const claimedOut = istTime(absentDay, "14:01");
      const req = await client.execute({
        sql: `INSERT INTO pt_regularisation (employee_id, date, claimed_in, claimed_out, reason, status, submitted_at)
              VALUES (?, ?, ?, ?, 'Gate scanner was down that morning; a colleague can confirm I was on site.', 'Pending', ?) RETURNING id`,
        args: [employeeId, absentDay, claimedIn, claimedOut, createdAt],
      });
      const requestId = Number(req.rows[0].id);
      const wf = await client.execute({
        sql: `INSERT INTO wf_request (process, flow_id, subject_type, subject_id, subject_employee_id, requester_user_id, summary, facts,
                status, current_step, step_started_at, created_at)
              VALUES ('regularisation', ?, 'pt_regularisation', ?, ?, ?, ?, '{}', 'Pending', 1, ?, ?) RETURNING id`,
        args: [Number(flow.id), String(requestId), employeeId, Number(requester.user_id), `${requester.username}: attendance for ${absentDay}`, createdAt, createdAt],
      });
      const wfRequestId = Number(wf.rows[0].id);
      await client.batch(
        [
          ...assignees.map((userId) => ({
            sql: "INSERT OR IGNORE INTO wf_assignee (request_id, step_order, user_id, reason) VALUES (?, 1, ?, 'step')",
            args: [wfRequestId, userId],
          })),
          {
            sql: `INSERT INTO wf_action (request_id, step_order, actor_type, actor_user_id, actor_name, decision, at)
                  VALUES (?, 0, 'user', ?, ?, 'Submitted', ?)`,
            args: [wfRequestId, Number(requester.user_id), requester.username, createdAt],
          },
        ],
        "write",
      );
      regularisationNote = ", with one attendance correction waiting on a manager";
    }
  }

  return [`  3 shifts, 1 roster pattern (rotating three-shift), 1 device, a week's roster and punches for the head office${regularisationNote}`];
}
