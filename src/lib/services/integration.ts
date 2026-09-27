import "server-only";
import { rawClient } from "@/lib/db";
import { now } from "@/db/schema";
import { recordChanges, type Actor } from "@/lib/change-log";
import { OWNERSHIP_DEFAULTS } from "@/lib/api/ownership-defaults";
import type { Result } from "./result";

/**
 * The two-way link's own records: who owns what, the ERP's ids for our
 * records, what the ERP acknowledged, payment confirmations, and the queue
 * of things that could not be applied automatically.
 */

const one = async (sql: string, args: (string | number | null)[]) =>
  (await rawClient().execute({ sql, args })).rows[0] as Record<string, unknown> | undefined;

/* ------------------------------------------------------------- ownership */

/** "hrms" or "erp": the field's own setting if it has one, else the record type's. */
export async function ownerOf(recordType: string, field = ""): Promise<"hrms" | "erp"> {
  const r = await rawClient().execute({
    sql: `SELECT field, owner FROM int_ownership WHERE record_type = ? AND field IN (?, '')
          ORDER BY field = '' ASC LIMIT 1`,
    args: [recordType, field],
  });
  const owner = r.rows[0]?.owner ?? OWNERSHIP_DEFAULTS.find((o) => o.recordType === recordType)?.owner ?? "hrms";
  return owner === "erp" ? "erp" : "hrms";
}

export async function listOwnership(): Promise<{ recordType: string; field: string; owner: "hrms" | "erp"; updatedBy: string | null }[]> {
  const r = await rawClient().execute("SELECT * FROM int_ownership ORDER BY record_type, field");
  return r.rows.map((o) => ({
    recordType: String(o.record_type),
    field: String(o.field),
    owner: o.owner === "erp" ? "erp" : "hrms",
    updatedBy: o.updated_by === null ? null : String(o.updated_by),
  }));
}

export async function setOwner(actor: Actor, recordType: string, field: string, owner: "hrms" | "erp" | "inherit"): Promise<void> {
  const before = await one("SELECT owner FROM int_ownership WHERE record_type = ? AND field = ?", [recordType, field]);
  if (owner === "inherit" && field) {
    await rawClient().execute({ sql: "DELETE FROM int_ownership WHERE record_type = ? AND field = ?", args: [recordType, field] });
  } else if (owner !== "inherit") {
    await rawClient().execute({
      sql: `INSERT INTO int_ownership (record_type, field, owner, updated_by, updated_at) VALUES (?, ?, ?, ?, ?)
            ON CONFLICT (record_type, field) DO UPDATE SET owner = excluded.owner, updated_by = excluded.updated_by,
              updated_at = excluded.updated_at`,
      args: [recordType, field, owner, actor.name, now()],
    });
  }
  await recordChanges(actor, [
    {
      entity: "int_ownership",
      entityId: field ? `${recordType}.${field}` : recordType,
      action: before ? "update" : "create",
      before: before ? { owner: before.owner } : null,
      after: { owner },
    },
  ]);
}

/* ---------------------------------------------------------- external ids */

export async function externalIdsFor(entity: string, ids: (string | number)[]): Promise<Map<string, Record<string, string>>> {
  const out = new Map<string, Record<string, string>>();
  if (ids.length === 0) return out;
  const r = await rawClient().execute({
    sql: `SELECT system, entity_id, external_id FROM int_external_ref
          WHERE entity = ? AND entity_id IN (${ids.map(() => "?").join(", ")})`,
    args: [entity, ...ids.map(String)],
  });
  for (const row of r.rows) {
    const key = String(row.entity_id);
    out.set(key, { ...(out.get(key) ?? {}), [String(row.system)]: String(row.external_id) });
  }
  return out;
}

export async function findByExternalId(system: string, entity: string, externalId: string): Promise<string | null> {
  const row = await one("SELECT entity_id FROM int_external_ref WHERE system = ? AND entity = ? AND external_id = ?", [system, entity, externalId]);
  return row ? String(row.entity_id) : null;
}

/** Records the other system's id for one of our records; each id belongs to one record. */
export async function setExternalId(
  actor: Actor,
  system: string,
  entity: string,
  entityId: string,
  externalId: string | null,
): Promise<Result<null>> {
  if (externalId === null) {
    await rawClient().execute({ sql: "DELETE FROM int_external_ref WHERE system = ? AND entity = ? AND entity_id = ?", args: [system, entity, entityId] });
  } else {
    const taken = await findByExternalId(system, entity, externalId);
    if (taken && taken !== entityId) {
      return { error: `${externalId} already belongs to another ${entity.replace(/_/g, " ")} (${taken}).`, code: "conflict" };
    }
    await rawClient().execute({
      sql: `INSERT INTO int_external_ref (system, entity, entity_id, external_id, created_at) VALUES (?, ?, ?, ?, ?)
            ON CONFLICT (system, entity, entity_id) DO UPDATE SET external_id = excluded.external_id`,
      args: [system, entity, entityId, externalId, now()],
    });
  }
  await recordChanges(actor, [
    { entity: "int_external_ref", entityId: `${system}:${entity}:${entityId}`, action: "update", before: {}, after: { external_id: externalId } },
  ]);
  return { ok: true, value: null };
}

/* ------------------------------------------------------- acknowledgements */

export type AckEntity = "gl_posting" | "payment_batch" | "remittance";

export async function ackState(entity: AckEntity, entityId: string | number) {
  const row = await one("SELECT * FROM int_ack WHERE entity = ? AND entity_id = ?", [entity, String(entityId)]);
  return {
    state: (row?.state as string | undefined) ?? "pending",
    reference: row?.reference == null ? null : String(row.reference),
    reason: row?.reason == null ? null : String(row.reason),
    totals: row?.totals ? (JSON.parse(String(row.totals)) as Record<string, string>) : null,
    updatedAt: row?.updated_at == null ? null : String(row.updated_at),
  };
}

export async function ackStates(entity: AckEntity, ids: (string | number)[]) {
  const out = new Map<string, Awaited<ReturnType<typeof ackState>>>();
  if (ids.length === 0) return out;
  const r = await rawClient().execute({
    sql: `SELECT * FROM int_ack WHERE entity = ? AND entity_id IN (${ids.map(() => "?").join(", ")})`,
    args: [entity, ...ids.map(String)],
  });
  for (const row of r.rows) {
    out.set(String(row.entity_id), {
      state: String(row.state),
      reference: row.reference == null ? null : String(row.reference),
      reason: row.reason == null ? null : String(row.reason),
      totals: row.totals ? (JSON.parse(String(row.totals)) as Record<string, string>) : null,
      updatedAt: String(row.updated_at),
    });
  }
  return out;
}

/** The ERP booked it, with its reference — or refused it, with its reason. */
export async function acknowledge(
  actor: Actor,
  entity: AckEntity,
  entityId: string | number,
  input: { status: "acknowledged" | "rejected"; reference: string | null; reason: string | null; totals?: Record<string, string> | null },
): Promise<Result<Awaited<ReturnType<typeof ackState>>>> {
  if (input.status === "acknowledged" && !input.reference) return { error: "An acknowledgement carries the ERP's own reference." };
  if (input.status === "rejected" && !input.reason) return { error: "A rejection says why, so HR can fix it and resend." };
  const before = await ackState(entity, entityId);
  const at = now();
  await rawClient().execute({
    sql: `INSERT INTO int_ack (entity, entity_id, state, reference, reason, totals, client_pk, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (entity, entity_id) DO UPDATE SET state = excluded.state, reference = excluded.reference,
            reason = excluded.reason, totals = excluded.totals, client_pk = excluded.client_pk, updated_at = excluded.updated_at`,
    args: [
      entity,
      String(entityId),
      input.status,
      input.reference,
      input.status === "rejected" ? input.reason : null,
      input.totals ? JSON.stringify(input.totals) : null,
      actor.type === "client" ? actor.id : null,
      at,
      at,
    ],
  });
  await recordChanges(actor, [
    {
      entity: "int_ack",
      entityId: `${entity}:${entityId}`,
      action: "update",
      before: { state: before.state, reference: before.reference, reason: before.reason },
      after: { state: input.status, reference: input.reference, reason: input.status === "rejected" ? input.reason : null },
    },
  ]);
  return { ok: true, value: await ackState(entity, entityId) };
}

/** Sending again after a rejection: back to waiting for the ERP. */
export async function resetAck(actor: Actor, entity: AckEntity, entityId: string | number): Promise<void> {
  await rawClient().execute({
    sql: "UPDATE int_ack SET state = 'pending', reason = NULL, updated_at = ? WHERE entity = ? AND entity_id = ?",
    args: [now(), entity, String(entityId)],
  });
  await recordChanges(actor, [{ entity: "int_ack", entityId: `${entity}:${entityId}`, action: "update", before: {}, after: { state: "pending" } }]);
}

/* ------------------------------------------------------ payment confirmations */

export type ConfirmationItem = {
  employee_id: number;
  status: "paid" | "failed";
  reference?: string | null;
  reason?: string | null;
  paid_on?: string | null;
};

export type ConfirmationOutcome = { employee_id: number; outcome: "applied" | "unchanged" | "not_in_batch"; issue_id?: number };

/**
 * The ERP paid a salary batch: each person's line is marked paid or failed.
 * A line that does not exist becomes a sync issue, so one bad item does not
 * refuse the rest.
 */
export async function confirmPayments(
  actor: Actor,
  batchId: number,
  items: ConfirmationItem[],
): Promise<Result<{ outcomes: ConfirmationOutcome[]; paid: number; failed: number; pending: number }>> {
  const batch = await one("SELECT * FROM py_bank_transfer_file WHERE id = ?", [batchId]);
  if (!batch) return { error: "That payment batch does not exist.", code: "not_found" };
  const outcomes: ConfirmationOutcome[] = [];
  for (const item of items) {
    if (item.status === "failed" && !item.reason) return { error: `Say why the payment to employee ${item.employee_id} failed.` };
    const line = await one("SELECT * FROM py_bank_transfer_line WHERE file_id = ? AND employee_id = ?", [batchId, item.employee_id]);
    if (!line) {
      const issue = await openSyncIssue({
        clientPk: actor.type === "client" ? actor.id : null,
        direction: "inbound",
        kind: "payment_confirmation",
        reference: `payment-batches/${batchId}`,
        payload: { batch_id: batchId, ...item },
        reason: `Employee ${item.employee_id} is not in payment batch ${batchId}.`,
      });
      outcomes.push({ employee_id: item.employee_id, outcome: "not_in_batch", issue_id: issue });
      continue;
    }
    if (line.payment_status === item.status && (line.bank_reference ?? null) === (item.reference ?? null)) {
      outcomes.push({ employee_id: item.employee_id, outcome: "unchanged" });
      continue;
    }
    const paidAt = item.status === "paid" ? (item.paid_on ? `${item.paid_on}T00:00:00.000Z` : now()) : null;
    await rawClient().execute({
      sql: `UPDATE py_bank_transfer_line SET payment_status = ?, paid_at = ?, bank_reference = ?, failure_reason = ? WHERE id = ?`,
      args: [item.status, paidAt, item.reference ?? null, item.status === "failed" ? (item.reason ?? null) : null, Number(line.id)],
    });
    await recordChanges(actor, [
      {
        entity: "py_bank_transfer_line",
        entityId: Number(line.id),
        subjectEmployeeId: item.employee_id,
        action: "update",
        before: { payment_status: line.payment_status, bank_reference: line.bank_reference },
        after: { payment_status: item.status, bank_reference: item.reference ?? null },
      },
    ]);
    outcomes.push({ employee_id: item.employee_id, outcome: "applied" });
  }
  const totals = await rawClient().execute({
    sql: "SELECT payment_status, COUNT(*) AS n FROM py_bank_transfer_line WHERE file_id = ? GROUP BY payment_status",
    args: [batchId],
  });
  const count = (s: string) => Number(totals.rows.find((t) => t.payment_status === s)?.n ?? 0);
  return { ok: true, value: { outcomes, paid: count("paid"), failed: count("failed"), pending: count("pending") } };
}

/* ------------------------------------------------------------ sync issues */

export async function openSyncIssue(input: {
  clientPk: number | null;
  direction: "inbound" | "outbound";
  kind: string;
  reference: string | null;
  payload: unknown;
  reason: string;
}): Promise<number> {
  const r = await rawClient().execute({
    sql: `INSERT INTO int_sync_issue (client_pk, direction, kind, reference, payload, reason, state, created_at)
          VALUES (?, ?, ?, ?, ?, ?, 'open', ?) RETURNING id`,
    args: [input.clientPk, input.direction, input.kind, input.reference, JSON.stringify(input.payload), input.reason, now()],
  });
  return Number(r.rows[0].id);
}

/** Tries an issue's payload again; resolves it if it now applies. */
export async function retrySyncIssue(actor: Actor, id: number): Promise<Result<"resolved" | "still_failing">> {
  const issue = await one("SELECT * FROM int_sync_issue WHERE id = ? AND state = 'open'", [id]);
  if (!issue) return { error: "That issue is no longer open.", code: "not_found" };
  let resolved = false;
  if (issue.kind === "payment_confirmation") {
    const payload = JSON.parse(String(issue.payload)) as ConfirmationItem & { batch_id: number };
    const line = await one("SELECT id FROM py_bank_transfer_line WHERE file_id = ? AND employee_id = ?", [payload.batch_id, payload.employee_id]);
    if (line) {
      const r = await confirmPayments(actor, payload.batch_id, [payload]);
      resolved = Boolean(r.ok);
    }
  }
  if (resolved) {
    await rawClient().execute({
      sql: "UPDATE int_sync_issue SET state = 'resolved', resolved_at = ?, resolved_by = ? WHERE id = ?",
      args: [now(), actor.name, id],
    });
  }
  return { ok: true, value: resolved ? "resolved" : "still_failing" };
}

export async function discardSyncIssue(actor: Actor, id: number): Promise<void> {
  await rawClient().execute({
    sql: "UPDATE int_sync_issue SET state = 'discarded', resolved_at = ?, resolved_by = ? WHERE id = ? AND state = 'open'",
    args: [now(), actor.name, id],
  });
  await recordChanges(actor, [{ entity: "int_sync_issue", entityId: id, action: "update", before: { state: "open" }, after: { state: "discarded" } }]);
}
