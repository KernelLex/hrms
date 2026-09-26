import "server-only";
import type { InStatement, InValue } from "@libsql/client";
import { rawClient } from "@/lib/db";
import { OPEN_ENDED, dayBefore } from "@/db/schema";
import { changeStatement, systemActor, type Actor, type Change } from "@/lib/change-log";

/**
 * The time-slice engine.
 *
 * Employee master data is never overwritten. Writing a new record for a date
 * delimits whatever was true before it, so the history stays intact and any
 * past date can still be answered truthfully. This is SAP's infotype model and
 * it is what makes "what was this person earning in March?" a real question.
 *
 * SQLite has no stored procedures, so this lives in TypeScript rather than in
 * the database — but it still runs inside one transaction, because a delimit
 * without its matching insert would leave a gap in the employee's history.
 *
 * Writing [F, T] over existing rows produces four cases:
 *
 *   existing:  |--------|            new: [F....T]
 *   1. tail overlap    R.from < F, R.to <= T   -> R.to = F-1        (truncate)
 *   2. fully covered   R.from >= F, R.to <= T  -> delete R
 *   3. head overlap    R.from >= F, R.to > T   -> R.from = T+1      (truncate)
 *   4. straddles       R.from < F, R.to > T    -> truncate + re-add the tail
 *
 * Case 4 is the one people forget. Inserting a short correction into the
 * middle of an open-ended record has to leave the later period intact.
 *
 * Every one of those steps is written to the change log inside the same
 * transaction, so the history of the history cannot be lost either.
 */

/** Infotypes where an employee has exactly one valid record at a time. */
export const SLICED_TABLES = {
  orgAssignment: "pa_it0001_org_assignment",
  personalData: "pa_it0002_personal_data",
  plannedWorkingTime: "pa_it0007_planned_working_time",
  basicPay: "pa_it0008_basic_pay",
  bankDetails: "pa_it0009_bank_details",
  action: "pa_it0000_action",
} as const;

export type SlicedTable = (typeof SLICED_TABLES)[keyof typeof SLICED_TABLES];

/** The day after `date`, as YYYY-MM-DD. */
function dayAfter(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

type Row = Record<string, InValue>;

/**
 * Writes a slice, delimiting whatever it supersedes, in one transaction.
 *
 * `data` holds only the infotype's own columns — the validity window,
 * employee, sequence and audit columns are added here.
 */
export async function saveTimeSlice(opts: {
  table: SlicedTable;
  employeeId: number;
  validFrom: string;
  validTo?: string;
  seq?: number;
  data: Record<string, InValue>;
  createdBy: string;
  /** Who is making the change; defaults to `createdBy` as a system actor. */
  actor?: Actor;
  reason?: string | null;
}): Promise<void> {
  const {
    table,
    employeeId,
    validFrom,
    validTo = OPEN_ENDED,
    seq = 1,
    data,
    createdBy,
  } = opts;
  const actor = opts.actor ?? systemActor(createdBy);
  const log = async (tx: { execute: (s: InStatement) => Promise<unknown> }, change: Change) => {
    const stmt = changeStatement(actor, { ...change, subjectEmployeeId: employeeId, reason: opts.reason });
    if (stmt) await tx.execute(stmt);
  };

  if (validTo < validFrom) {
    throw new Error("Valid to cannot fall before valid from.");
  }

  const client = rawClient();
  const tx = await client.transaction("write");

  try {
    // Everything that overlaps the incoming window, for this employee and seq.
    const overlapping = await tx.execute({
      sql: `SELECT * FROM ${table}
            WHERE employee_id = ? AND seq = ?
              AND valid_to >= ? AND valid_from <= ?`,
      args: [employeeId, seq, validFrom, validTo],
    });

    // The slice in force the day before, if any: what this change replaces.
    const predecessor = overlapping.rows.find(
      (r) => String((r as unknown as Row).valid_from) < validFrom,
    ) as unknown as Row | undefined;

    for (const raw of overlapping.rows) {
      const row = raw as unknown as Row;
      const id = row.id as number;
      const from = row.valid_from as string;
      const to = row.valid_to as string;

      const startsBefore = from < validFrom;
      const endsAfter = to > validTo;

      if (startsBefore && endsAfter) {
        // Case 4 — the new slice sits inside an existing one. Keep both ends.
        await tx.execute({
          sql: `UPDATE ${table} SET valid_to = ? WHERE id = ?`,
          args: [dayBefore(validFrom), id],
        });
        await log(tx, { entity: table, entityId: id, action: "update", before: row, after: { ...row, valid_to: dayBefore(validFrom) } });

        const columns = Object.keys(row).filter((c) => c !== "id");
        const values = columns.map((c) =>
          c === "valid_from" ? dayAfter(validTo) : row[c],
        );
        const tail = await tx.execute({
          sql: `INSERT INTO ${table} (${columns.join(", ")})
                VALUES (${columns.map(() => "?").join(", ")}) RETURNING id`,
          args: values,
        });
        await log(tx, {
          entity: table,
          entityId: Number(tail.rows[0].id),
          action: "create",
          after: Object.fromEntries(columns.map((c, i) => [c, values[i]])),
        });
      } else if (startsBefore) {
        // Case 1 — truncate the tail.
        await tx.execute({
          sql: `UPDATE ${table} SET valid_to = ? WHERE id = ?`,
          args: [dayBefore(validFrom), id],
        });
        await log(tx, { entity: table, entityId: id, action: "update", before: row, after: { ...row, valid_to: dayBefore(validFrom) } });
      } else if (endsAfter) {
        // Case 3 — truncate the head.
        await tx.execute({
          sql: `UPDATE ${table} SET valid_from = ? WHERE id = ?`,
          args: [dayAfter(validTo), id],
        });
        await log(tx, { entity: table, entityId: id, action: "update", before: row, after: { ...row, valid_from: dayAfter(validTo) } });
      } else {
        // Case 2 — entirely superseded.
        await tx.execute({
          sql: `DELETE FROM ${table} WHERE id = ?`,
          args: [id],
        });
        await log(tx, { entity: table, entityId: id, action: "delete", before: row });
      }
    }

    const cols = [
      "employee_id",
      "valid_from",
      "valid_to",
      "seq",
      "created_by",
      "created_at",
      ...Object.keys(data),
    ];
    const vals: InValue[] = [
      employeeId,
      validFrom,
      validTo,
      seq,
      createdBy,
      new Date().toISOString(),
      ...Object.values(data),
    ];

    const inserted = await tx.execute({
      sql: `INSERT INTO ${table} (${cols.join(", ")})
            VALUES (${cols.map(() => "?").join(", ")}) RETURNING id`,
      args: vals,
    });
    await log(tx, {
      entity: table,
      entityId: Number(inserted.rows[0].id),
      action: "create",
      before: predecessor ?? null,
      after: Object.fromEntries(cols.map((c, i) => [c, vals[i]])),
    });

    await tx.commit();
  } catch (err) {
    await tx.rollback();
    throw err;
  }
}

/**
 * The record that was valid on a given date, or undefined if none was.
 *
 * This is the read that makes the whole model worth having: CH-03 renders an
 * employee exactly as they stood on any past date.
 */
export async function readAsOf<T = Record<string, unknown>>(
  table: SlicedTable,
  employeeId: number,
  asOf: string,
): Promise<T | undefined> {
  const client = rawClient();
  const result = await client.execute({
    sql: `SELECT * FROM ${table}
          WHERE employee_id = ? AND valid_from <= ? AND valid_to >= ?
          ORDER BY valid_from DESC
          LIMIT 1`,
    args: [employeeId, asOf, asOf],
  });
  return result.rows[0] as T | undefined;
}

/** Every slice for an employee, newest first — the record history panels. */
export async function readHistory<T = Record<string, unknown>>(
  table: SlicedTable,
  employeeId: number,
): Promise<T[]> {
  const client = rawClient();
  const result = await client.execute({
    sql: `SELECT * FROM ${table}
          WHERE employee_id = ?
          ORDER BY valid_from DESC, seq ASC`,
    args: [employeeId],
  });
  return result.rows as T[];
}

/**
 * Deletes one slice and extends its predecessor to cover the gap, so the
 * history has no hole. Returns false when the slice no longer exists.
 */
export async function deleteTimeSlice(
  table: SlicedTable,
  id: number,
  actor: Actor = systemActor("timeslice"),
): Promise<boolean> {
  const client = rawClient();
  const tx = await client.transaction("write");
  try {
    const found = await tx.execute({ sql: `SELECT * FROM ${table} WHERE id = ?`, args: [id] });
    const row = found.rows[0] as unknown as Row | undefined;
    if (!row) {
      await tx.rollback();
      return false;
    }
    const employeeId = Number(row.employee_id);
    const log = async (change: Change) => {
      const stmt = changeStatement(actor, { ...change, subjectEmployeeId: employeeId });
      if (stmt) await tx.execute(stmt);
    };

    // Whoever ended the day before this slice began now runs to its end.
    const predecessor = await tx.execute({
      sql: `SELECT * FROM ${table} WHERE employee_id = ? AND seq = ? AND valid_to = ?`,
      args: [employeeId, row.seq as number, dayBefore(row.valid_from as string)],
    });

    await tx.execute({ sql: `DELETE FROM ${table} WHERE id = ?`, args: [id] });
    await log({ entity: table, entityId: id, action: "delete", before: row });

    for (const raw of predecessor.rows) {
      const p = raw as unknown as Row;
      await tx.execute({
        sql: `UPDATE ${table} SET valid_to = ? WHERE id = ?`,
        args: [row.valid_to as string, p.id as number],
      });
      await log({
        entity: table,
        entityId: Number(p.id),
        action: "update",
        before: p,
        after: { ...p, valid_to: row.valid_to },
      });
    }

    await tx.commit();
    return true;
  } catch (err) {
    await tx.rollback();
    throw err;
  }
}
