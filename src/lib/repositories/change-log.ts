import "server-only";
import type { InValue } from "@libsql/client";
import { rawClient } from "@/lib/db";

/**
 * Reading the change log: one employee's history for their record, and the
 * whole organisation's, filtered, for HR.
 */

export type ChangeRow = {
  id: number;
  at: string;
  actorType: string;
  actorName: string;
  entity: string;
  entityId: string;
  subjectEmployeeId: number | null;
  subjectName: string | null;
  action: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  reason: string | null;
};

export type ChangeFilter = {
  subjectEmployeeId?: number;
  entity?: string;
  actor?: string;
  /** Dates in India, inclusive: `YYYY-MM-DD`. */
  from?: string;
  to?: string;
};

/** The first instant of a day in India, as the UTC timestamp the log stores. */
function startOfIndianDay(date: string): string {
  return new Date(`${date}T00:00:00+05:30`).toISOString();
}

function nextIndianDay(date: string): string {
  const d = new Date(`${date}T00:00:00+05:30`);
  return new Date(d.getTime() + 86_400_000).toISOString();
}

function where(filter: ChangeFilter): { sql: string; args: InValue[] } {
  const clauses: string[] = [];
  const args: InValue[] = [];
  if (filter.subjectEmployeeId !== undefined) {
    clauses.push("c.subject_employee_id = ?");
    args.push(filter.subjectEmployeeId);
  }
  if (filter.entity) {
    clauses.push("c.entity = ?");
    args.push(filter.entity);
  }
  if (filter.actor) {
    clauses.push("c.actor_name = ?");
    args.push(filter.actor);
  }
  if (filter.from && /^\d{4}-\d{2}-\d{2}$/.test(filter.from)) {
    clauses.push("c.at >= ?");
    args.push(startOfIndianDay(filter.from));
  }
  if (filter.to && /^\d{4}-\d{2}-\d{2}$/.test(filter.to)) {
    clauses.push("c.at < ?");
    args.push(nextIndianDay(filter.to));
  }
  return { sql: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", args };
}

const parse = (v: unknown): Record<string, unknown> | null => {
  if (typeof v !== "string" || !v) return null;
  try {
    return JSON.parse(v) as Record<string, unknown>;
  } catch {
    return null;
  }
};

export async function listChanges(
  filter: ChangeFilter,
  limit = 50,
  offset = 0,
): Promise<{ rows: ChangeRow[]; total: number }> {
  const w = where(filter);
  const [page, count] = await Promise.all([
    rawClient().execute({
      sql: `SELECT c.*, (
              SELECT p.first_name || ' ' || p.last_name FROM pa_it0002_personal_data p
              WHERE p.employee_id = c.subject_employee_id
              ORDER BY p.valid_from DESC LIMIT 1
            ) AS subject_name
            FROM app_change_log c ${w.sql}
            ORDER BY c.at DESC, c.id DESC
            LIMIT ? OFFSET ?`,
      args: [...w.args, limit, offset],
    }),
    rawClient().execute({
      sql: `SELECT COUNT(*) AS n FROM app_change_log c ${w.sql}`,
      args: w.args,
    }),
  ]);
  return {
    total: Number(count.rows[0].n),
    rows: page.rows.map((r) => ({
      id: Number(r.id),
      at: String(r.at),
      actorType: String(r.actor_type),
      actorName: String(r.actor_name),
      entity: String(r.entity),
      entityId: String(r.entity_id),
      subjectEmployeeId: r.subject_employee_id === null ? null : Number(r.subject_employee_id),
      subjectName: r.subject_name === null ? null : String(r.subject_name),
      action: String(r.action),
      before: parse(r.before),
      after: parse(r.after),
      reason: r.reason === null ? null : String(r.reason),
    })),
  };
}

/** What the filters offer: the entities and people that appear in the log. */
export async function changeFacets(): Promise<{ entities: string[]; actors: string[] }> {
  const [entities, actors] = await Promise.all([
    rawClient().execute("SELECT DISTINCT entity FROM app_change_log ORDER BY entity"),
    rawClient().execute("SELECT DISTINCT actor_name FROM app_change_log ORDER BY actor_name"),
  ]);
  return {
    entities: entities.rows.map((r) => String(r.entity)),
    actors: actors.rows.map((r) => String(r.actor_name)),
  };
}
