import "server-only";
import type { InStatement, InValue } from "@libsql/client";
import { rawClient } from "@/lib/db";
import type { Session } from "@/lib/auth";

/**
 * The change log: every write, who made it, and what it changed.
 *
 * Writes that already run in a transaction — the time-slice engine — add
 * their log rows to it with `changeStatement`, so a change and its record
 * commit together. Everywhere else `audited` reads the record before and
 * after a write and logs the difference.
 */

export type Actor = {
  type: "user" | "system" | "client";
  id: number | null;
  name: string;
};

export function actorOf(session: Pick<Session, "userId" | "username">): Actor {
  return { type: "user", id: session.userId, name: session.username };
}

/** Work the system does itself: payroll, jobs, schedules. */
export function systemActor(name: string): Actor {
  return { type: "system", id: null, name };
}

export type Change = {
  entity: string;
  entityId: string | number;
  subjectEmployeeId?: number | null;
  action: "create" | "update" | "delete";
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  reason?: string | null;
};

type Row = Record<string, unknown>;

/** Columns that describe the row rather than its content. */
const HOUSEKEEPING = new Set(["created_at", "created_by", "updated_at"]);

/** The columns every time slice has; never the change itself. */
const SLICE_KEYS = new Set(["id", "employee_id", "seq", "valid_from", "valid_to"]);

/** Drizzle returns camelCase and raw SQL snake_case; the log keeps the column names. */
const toSnake = (k: string) => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

/** Fields a log must never hold in full. */
const MASKED = /account_number/i;

function mask(key: string, value: unknown): unknown {
  if (value === null || value === undefined || !MASKED.test(key)) return value;
  const s = String(value);
  return s.length <= 4 ? "••••" : `••••${s.slice(-4)}`;
}

function clean(row: Row | null | undefined): Row | null {
  if (!row) return null;
  const out: Row = {};
  for (const [key, v] of Object.entries(row)) {
    const k = toSnake(key);
    if (HOUSEKEEPING.has(k)) continue;
    out[k] = mask(k, v instanceof Uint8Array || v instanceof ArrayBuffer ? "[binary]" : v);
  }
  return out;
}

function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  // libsql may return 1 where the schema says true, or a number as a bigint.
  if (typeof a === "boolean" || typeof b === "boolean") return Number(a) === Number(b);
  if (typeof a === "bigint" || typeof b === "bigint") return String(a) === String(b);
  return a === null ? b === undefined : b === null ? a === undefined : false;
}

/**
 * Only the fields that changed, on each side. Undefined when nothing did,
 * so a save that changes nothing leaves no entry.
 */
export function diff(before: Row | null | undefined, after: Row | null | undefined) {
  const b = clean(before) ?? {};
  const a = clean(after) ?? {};
  const keys = new Set([...Object.keys(b), ...Object.keys(a)]);
  const changedBefore: Row = {};
  const changedAfter: Row = {};
  for (const k of keys) {
    if (same(b[k], a[k])) continue;
    changedBefore[k] = b[k] ?? null;
    changedAfter[k] = a[k] ?? null;
  }
  return Object.keys(changedAfter).length === 0
    ? undefined
    : { before: changedBefore, after: changedAfter };
}

/** The insert for one change, to run inside the caller's transaction. */
export function changeStatement(actor: Actor, change: Change): InStatement | null {
  let before: Row | null = null;
  let after: Row | null = null;
  if (change.action === "update") {
    const d = diff(change.before, change.after);
    if (!d) return null;
    before = d.before;
    after = d.after;
  } else if (change.action === "create") {
    after = clean(change.after);
    // A new time slice can name the one it follows, so the log reads
    // "₹65,000 → ₹72,000" rather than only the new figure.
    if (change.before) {
      const d = diff(change.before, change.after);
      const was: Row = {};
      for (const [k, v] of Object.entries(d?.before ?? {})) if (!SLICE_KEYS.has(k)) was[k] = v;
      before = Object.keys(was).length > 0 ? was : null;
    }
  } else {
    before = clean(change.before);
  }
  const args: InValue[] = [
    new Date().toISOString(),
    actor.type,
    actor.id,
    actor.name,
    change.entity,
    String(change.entityId),
    change.subjectEmployeeId ?? null,
    change.action,
    before ? JSON.stringify(before) : null,
    after ? JSON.stringify(after) : null,
    change.reason ?? null,
  ];
  return {
    sql: `INSERT INTO app_change_log
            (at, actor_type, actor_id, actor_name, entity, entity_id, subject_employee_id,
             action, before, after, reason)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args,
  };
}

/** Records changes on their own, after the write they describe. */
export async function recordChanges(actor: Actor, changes: Change[]): Promise<void> {
  const statements = changes
    .map((c) => changeStatement(actor, c))
    .filter((s): s is InStatement => s !== null);
  if (statements.length === 0) return;
  await rawClient().batch(statements, "write");
}

/**
 * Runs a write and logs what it did to one record: reads the record before
 * and after, and records a create, an update of the changed fields, or a
 * delete. Returns whatever the write returned.
 */
export async function audited<T>(
  actor: Actor,
  target: {
    entity: string;
    entityId: string | number | (() => string | number | undefined);
    subjectEmployeeId?: number | null | ((row: Row) => number | null);
    reason?: string | null;
  },
  read: () => Promise<Row | undefined | null>,
  write: () => Promise<T>,
): Promise<T> {
  const before = (await read()) ?? null;
  const result = await write();
  const after = (await read()) ?? null;
  const id = typeof target.entityId === "function" ? target.entityId() : target.entityId;
  if (id === undefined) return result;

  const row = after ?? before;
  const subject =
    typeof target.subjectEmployeeId === "function"
      ? row
        ? target.subjectEmployeeId(row)
        : null
      : (target.subjectEmployeeId ?? null);

  const action = before && after ? "update" : after ? "create" : before ? "delete" : null;
  if (action) {
    await recordChanges(actor, [
      { entity: target.entity, entityId: id, subjectEmployeeId: subject, action, before, after, reason: target.reason },
    ]);
  }
  return result;
}

/** For a create whose id is only known once it is written. */
export async function recordCreate(
  actor: Actor,
  entity: string,
  entityId: string | number,
  after: Row,
  subjectEmployeeId: number | null = null,
): Promise<void> {
  await recordChanges(actor, [{ entity, entityId, subjectEmployeeId, action: "create", after }]);
}

export async function recordDelete(
  actor: Actor,
  entity: string,
  entityId: string | number,
  before: Row,
  subjectEmployeeId: number | null = null,
): Promise<void> {
  await recordChanges(actor, [{ entity, entityId, subjectEmployeeId, action: "delete", before }]);
}

/** The employee a row is about, when it has one. */
export function subjectOf(row: object): number | null {
  const id = (row as { employeeId?: unknown }).employeeId;
  return typeof id === "number" ? id : null;
}

const keyOf = (row: object) => {
  const r = row as { id?: string | number; code?: string };
  return r.id ?? r.code ?? "?";
};

/** Logs the rows an insert returned, each against the employee it is about. */
export async function recordCreated(actor: Actor, entity: string, rows: object[]): Promise<void> {
  await recordChanges(
    actor,
    rows.map((row) => ({
      entity,
      entityId: keyOf(row),
      subjectEmployeeId: subjectOf(row),
      action: "create" as const,
      after: row as Row,
    })),
  );
}

/** Logs the rows a delete returned. */
export async function recordDeleted(actor: Actor, entity: string, rows: object[]): Promise<void> {
  await recordChanges(
    actor,
    rows.map((row) => ({
      entity,
      entityId: keyOf(row),
      subjectEmployeeId: subjectOf(row),
      action: "delete" as const,
      before: row as Row,
    })),
  );
}
