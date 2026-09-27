import "server-only";
import type { InStatement } from "@libsql/client";
import { rawClient } from "@/lib/db";
import { changeStatement, type Actor } from "@/lib/change-log";
import { notificationStatements, usersForEmployees } from "@/lib/notifications";

/**
 * Recruitment's shared rules, used by HR's screens and by the public careers
 * page: how an application comes into being, what each stage change writes,
 * who hears about it, and when two interviews collide.
 */

type Row = Record<string, unknown>;

async function one(sql: string, args: (string | number | null)[]): Promise<Row | null> {
  const r = await rawClient().execute({ sql, args });
  return (r.rows[0] as unknown as Row) ?? null;
}


/** The history row for a move, and the change-log row for the application. */
export function stageStatements(
  actor: Actor,
  application: { id: number; stage: string; candidateId: number },
  to: string,
  set: Record<string, string | number | null>,
  note: string | null,
): InStatement[] {
  const at = new Date().toISOString();
  const columns = Object.keys(set);
  const statements: InStatement[] = [];
  if (columns.length > 0) {
    statements.push({
      sql: `UPDATE rc_application SET ${columns.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`,
      args: [...columns.map((c) => set[c]), application.id],
    });
  }
  statements.push({
    sql: `INSERT INTO rc_application_stage_history (application_id, from_stage, to_stage, changed_by, changed_at, note)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [application.id, application.stage, to, actor.name, at, note],
  });
  const logged = changeStatement(actor, {
    entity: "rc_application",
    entityId: application.id,
    action: "update",
    before: { stage: application.stage },
    after: { ...set, stage: set.stage ?? application.stage, ...(to === "Rejected" ? { rejected: true } : {}) },
    reason: note ?? undefined,
  });
  if (logged) statements.push(logged);
  return statements;
}

/**
 * A new application, its first history row and its change-log row. Returns
 * null when the candidate has already applied to the requisition.
 */
export async function applicationStatements(
  actor: Actor,
  v: { candidateId: number; requisitionId: number; channel: "Careers page" | "Added by HR"; coverNote?: string | null; sourceHash?: string | null; today: string },
): Promise<{ id: number } | null> {
  const existing = await one("SELECT id FROM rc_application WHERE candidate_id = ? AND requisition_id = ?", [v.candidateId, v.requisitionId]);
  if (existing) return null;
  const inserted = await rawClient().execute({
    sql: `INSERT INTO rc_application (candidate_id, requisition_id, stage, applied_date, channel, cover_note, source_hash)
          VALUES (?, ?, 'Applied', ?, ?, ?, ?) RETURNING id`,
    args: [v.candidateId, v.requisitionId, v.today, v.channel, v.coverNote ?? null, v.sourceHash ?? null],
  });
  const id = Number(inserted.rows[0].id);
  const statements: InStatement[] = [
    {
      sql: `INSERT INTO rc_application_stage_history (application_id, from_stage, to_stage, changed_by, changed_at, note)
            VALUES (?, NULL, 'Applied', ?, ?, ?)`,
      args: [id, actor.name, new Date().toISOString(), v.channel === "Careers page" ? "Applied on the careers page" : null],
    },
  ];
  const logged = changeStatement(actor, {
    entity: "rc_application",
    entityId: id,
    action: "create",
    after: { candidateId: v.candidateId, requisitionId: v.requisitionId, stage: "Applied", channel: v.channel },
  });
  if (logged) statements.push(logged);
  await rawClient().batch(statements, "write");
  return { id };
}

/** Everyone who runs recruitment, through any role that grants it. */
export async function recruiterUserIds(): Promise<number[]> {
  const r = await rawClient().execute(
    `SELECT DISTINCT u.id FROM sec_app_user u
     JOIN sec_user_role ur ON ur.user_id = u.id
     JOIN sec_role_permission rp ON rp.role_code = ur.role_code
     WHERE rp.permission_code = 'recruitment.manage' AND u.is_active = 1`,
  );
  return r.rows.map((u) => Number(u.id));
}

/** Tells recruiters that someone applied on the careers page. */
export async function announceApplication(applicationId: number, candidateName: string, roleTitle: string): Promise<InStatement[]> {
  const users = await recruiterUserIds();
  return notificationStatements(
    users.map((userId) => ({
      userId,
      kind: "application.received" as const,
      title: `${candidateName} applied for ${roleTitle}`,
      body: "Their application is waiting to be screened: take it to interview, or reject the profile.",
      link: `/recruitment/applications/${applicationId}`,
      dedupeKey: `application.received:${applicationId}:${userId}`,
    })),
  );
}

/** Tells an interviewer they have a round to take. */
export async function announceInterview(
  interview: { id: number; round: string; scheduledDate: string; scheduledTime: string | null; interviewerEmployeeId: number | null },
  candidateName: string,
): Promise<InStatement[]> {
  if (!interview.interviewerEmployeeId) return [];
  const users = await usersForEmployees([interview.interviewerEmployeeId]);
  const userId = users.get(interview.interviewerEmployeeId);
  if (!userId) return [];
  const when = `${interview.scheduledDate}${interview.scheduledTime ? ` at ${interview.scheduledTime}` : ""}`;
  return notificationStatements([
    {
      userId,
      kind: "interview.assigned",
      title: `Interview with ${candidateName}: ${interview.round}`,
      body: `On ${when}. Open it to see the candidate and the role, and to record your notes afterwards.`,
      link: `/recruitment/interviews/${interview.id}`,
      // A rescheduled round is a new notice.
      dedupeKey: `interview.assigned:${interview.id}:${userId}:${interview.scheduledDate}:${interview.scheduledTime ?? ""}`,
    },
  ]);
}

const minutes = (time: string | null) => {
  if (!time) return null;
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
};

/**
 * Another scheduled round the interviewer has that overlaps this one, if any.
 * Rounds without a time never collide: nobody can say when they are.
 */
export async function interviewClash(v: {
  interviewerEmployeeId: number;
  scheduledDate: string;
  scheduledTime: string | null;
  durationMinutes: number;
  exceptId: number | null;
}): Promise<{ time: string; candidate: string } | null> {
  const start = minutes(v.scheduledTime);
  if (start === null) return null;
  const r = await rawClient().execute({
    sql: `SELECT i.scheduled_time, i.duration_minutes, c.full_name
          FROM rc_interview i JOIN rc_application a ON a.id = i.application_id JOIN rc_candidate c ON c.id = a.candidate_id
          WHERE i.interviewer_employee_id = ? AND i.scheduled_date = ? AND i.status = 'Scheduled' AND i.id <> ?`,
    args: [v.interviewerEmployeeId, v.scheduledDate, v.exceptId ?? 0],
  });
  for (const row of r.rows) {
    const otherStart = minutes(row.scheduled_time === null ? null : String(row.scheduled_time));
    if (otherStart === null) continue;
    const otherEnd = otherStart + Number(row.duration_minutes);
    if (start < otherEnd && otherStart < start + v.durationMinutes) {
      return { time: String(row.scheduled_time), candidate: String(row.full_name) };
    }
  }
  return null;
}

/** An employee's name as it stands today, or their number if they have none. */
export async function employeeName(employeeId: number): Promise<string | null> {
  const row = await one(
    `SELECT e.employee_number, p.first_name, p.last_name FROM pa_employee e
     LEFT JOIN pa_it0002_personal_data p ON p.employee_id = e.id AND p.valid_from <= date('now') AND p.valid_to >= date('now')
     WHERE e.id = ? ORDER BY p.valid_from DESC LIMIT 1`,
    [employeeId],
  );
  if (!row) return null;
  return [row.first_name, row.last_name].filter(Boolean).join(" ") || String(row.employee_number);
}

/** Whether this employee has been asked to interview this candidate, in any round. */
export async function interviewsCandidate(employeeId: number, candidateId: number): Promise<boolean> {
  const row = await one(
    `SELECT 1 FROM rc_interview i JOIN rc_application a ON a.id = i.application_id
     WHERE i.interviewer_employee_id = ? AND a.candidate_id = ? LIMIT 1`,
    [employeeId, candidateId],
  );
  return row !== null;
}
