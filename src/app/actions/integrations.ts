"use server";

import { revalidatePath } from "next/cache";
import { rawClient } from "@/lib/db";
import { requireAnyPermission, requirePermission } from "@/lib/access";
import { actorOf, recordChanges } from "@/lib/change-log";
import { createApiClient, revokeOlderSecrets, rotateSecret } from "@/lib/api/clients";
import { replayDeliveries } from "@/lib/api/events";
import { parseScopes } from "@/lib/api/scopes";
import { OWNED_RECORD_TYPES, OWNERSHIP_DEFAULTS } from "@/lib/api/ownership-defaults";
import { ackState, discardSyncIssue, resetAck, retrySyncIssue, setOwner } from "@/lib/services/integration";
import { kickJobs } from "@/lib/jobs/runner";

/**
 * Connecting other systems: API clients and their secrets, webhook
 * deliveries, record ownership, sync issues, and resending a journal the
 * ERP refused. Everything here needs `integrations.manage`.
 */

export type ActionState = { error?: string; ok?: boolean; secret?: string; clientId?: string };

const OK: ActionState = { ok: true };
const fail = (error: string): ActionState => ({ error });
const str = (v: FormDataEntryValue | null) => (typeof v === "string" ? v.trim() : "");
const list = (form: FormData, name: string) => [...new Set(form.getAll(name).map(String).map((s) => s.trim()).filter(Boolean))];
const ips = (v: string) => [...new Set(v.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean))];

function revalidateIntegrations() {
  revalidatePath("/admin/integrations", "layout");
  revalidatePath("/payroll/posting");
}

const validIp = (ip: string) => /^(\d{1,3}\.){3}\d{1,3}$/.test(ip) || /^[0-9a-f:]+$/i.test(ip);

/** Registers a system. The secret is returned once, to show once. */
export async function createIntegrationClient(_prev: ActionState, form: FormData): Promise<ActionState> {
  const session = await requirePermission("integrations.manage");
  const name = str(form.get("name"));
  const scopes = parseScopes(list(form, "scope").join(" "));
  const allowed = ips(str(form.get("allowedIps")));
  if (!name) return fail("Name the system, such as \"Acme ERP\".");
  if (scopes.length === 0) return fail("Tick at least one scope.");
  if (allowed.some((ip) => !validIp(ip))) return fail("Allowed addresses are IP addresses, separated by commas.");
  const created = await createApiClient({
    name,
    scopes,
    companies: list(form, "company"),
    allowedIps: allowed,
    systemKey: str(form.get("systemKey")) || "erp",
    createdBy: session.username,
  });
  await recordChanges(actorOf(session), [
    { entity: "int_client", entityId: created.clientId, action: "create", after: { name, scopes: scopes.join(" "), companies: list(form, "company").join(","), allowed_ips: allowed.join(",") } },
  ]);
  revalidateIntegrations();
  return { ok: true, clientId: created.clientId, secret: created.secret };
}

export async function updateIntegrationClient(_prev: ActionState, form: FormData): Promise<ActionState> {
  const session = await requirePermission("integrations.manage");
  const pk = Number(form.get("id"));
  const name = str(form.get("name"));
  const scopes = parseScopes(list(form, "scope").join(" "));
  const companies = list(form, "company");
  const allowed = ips(str(form.get("allowedIps")));
  const status = str(form.get("status")) === "suspended" ? "suspended" : "active";
  const rateLimit = Number(form.get("rateLimit"));
  if (!name) return fail("The system needs a name.");
  if (allowed.some((ip) => !validIp(ip))) return fail("Allowed addresses are IP addresses, separated by commas.");
  if (!Number.isInteger(rateLimit) || rateLimit < 10 || rateLimit > 100_000) return fail("The rate limit is between 10 and 100,000 requests a minute.");
  const before = (await rawClient().execute({ sql: "SELECT * FROM int_client WHERE id = ?", args: [pk] })).rows[0];
  if (!before) return fail("That system is no longer registered.");
  const after = {
    name,
    scopes: scopes.join(" "),
    companies: companies.length ? companies.join(",") : null,
    allowed_ips: allowed.length ? allowed.join(",") : null,
    status,
    rate_limit: rateLimit,
  };
  await rawClient().execute({
    sql: "UPDATE int_client SET name = ?, scopes = ?, companies = ?, allowed_ips = ?, status = ?, rate_limit = ? WHERE id = ?",
    args: [after.name, after.scopes, after.companies, after.allowed_ips, after.status, after.rate_limit, pk],
  });
  await recordChanges(actorOf(session), [
    {
      entity: "int_client",
      entityId: String(before.client_id),
      action: "update",
      before: { name: before.name, scopes: before.scopes, companies: before.companies, allowed_ips: before.allowed_ips, status: before.status, rate_limit: before.rate_limit },
      after,
    },
  ]);
  revalidateIntegrations();
  return OK;
}

/**
 * Removes a system that was connected by mistake, or is no longer wanted,
 * and was never really used — the same "kept for the audit trail" rule
 * `deleteCandidate` and `deleteRequisition` follow. One that has taken
 * calls, or has deliveries, acknowledgements or sync issues HR might still
 * need to read, cannot be deleted; suspend it instead, from its settings,
 * which stops it at once and keeps its history.
 */
export async function deleteIntegrationClient(_prev: ActionState, form: FormData): Promise<ActionState> {
  const session = await requirePermission("integrations.manage");
  const pk = Number(form.get("id"));
  const client = (await rawClient().execute({ sql: "SELECT * FROM int_client WHERE id = ?", args: [pk] })).rows[0];
  if (!client) return fail("That system is no longer registered.");

  const used = await rawClient().execute({
    sql: `SELECT
            (SELECT COUNT(*) FROM int_request_log WHERE client_pk = ?1) +
            (SELECT COUNT(*) FROM int_event WHERE caused_by_client_pk = ?1) +
            (SELECT COUNT(*) FROM int_ack WHERE client_pk = ?1) +
            (SELECT COUNT(*) FROM int_sync_issue WHERE client_pk = ?1) AS n`,
    args: [pk],
  });
  if (Number(used.rows[0].n) > 0) {
    return fail(`${String(client.name)} has called the API, or has deliveries, acknowledgements or sync issues on record. Suspend it instead, so that history stays readable.`);
  }

  // Cascades its secrets and webhook subscriptions.
  await rawClient().execute({ sql: "DELETE FROM int_client WHERE id = ?", args: [pk] });
  await recordChanges(actorOf(session), [
    { entity: "int_client", entityId: String(client.client_id), action: "delete", before: { name: client.name, scopes: client.scopes, status: client.status } },
  ]);
  revalidateIntegrations();
  return OK;
}

/** A new secret, shown once; the old ones keep working for a day. */
export async function rotateIntegrationSecret(_prev: ActionState, form: FormData): Promise<ActionState> {
  const session = await requirePermission("integrations.manage");
  const pk = Number(form.get("id"));
  const client = (await rawClient().execute({ sql: "SELECT client_id FROM int_client WHERE id = ?", args: [pk] })).rows[0];
  if (!client) return fail("That system is no longer registered.");
  const secret = await rotateSecret(pk);
  await recordChanges(actorOf(session), [{ entity: "int_client_secret", entityId: String(client.client_id), action: "create", after: { rotated: true } }]);
  revalidateIntegrations();
  return { ok: true, secret, clientId: String(client.client_id) };
}

/** Stops every secret but the newest, at once — for a leaked secret. */
export async function revokeIntegrationSecrets(_prev: ActionState, form: FormData): Promise<ActionState> {
  const session = await requirePermission("integrations.manage");
  const pk = Number(form.get("id"));
  await revokeOlderSecrets(pk);
  await recordChanges(actorOf(session), [{ entity: "int_client_secret", entityId: String(pk), action: "update", before: {}, after: { older_revoked: true } }]);
  revalidateIntegrations();
  return OK;
}

export async function setWebhookActive(_prev: ActionState, form: FormData): Promise<ActionState> {
  const session = await requirePermission("integrations.manage");
  const id = Number(form.get("id"));
  const active = str(form.get("active")) === "1";
  await rawClient().execute({ sql: "UPDATE int_webhook SET active = ? WHERE id = ?", args: [active ? 1 : 0, id] });
  await recordChanges(actorOf(session), [{ entity: "int_webhook", entityId: id, action: "update", before: { active: !active }, after: { active } }]);
  revalidateIntegrations();
  return OK;
}

/** Puts parked deliveries back in the queue: one, or all of a client's. */
export async function replayWebhookDeliveries(_prev: ActionState, form: FormData): Promise<ActionState> {
  await requirePermission("integrations.manage");
  const id = Number(form.get("id"));
  const clientPk = Number(form.get("clientId"));
  let ids: number[] = [];
  if (id) ids = [id];
  else if (clientPk) {
    const r = await rawClient().execute({
      sql: `SELECT id FROM app_outbox WHERE channel = 'webhook' AND status = 'failed' AND json_extract(payload, '$.client_pk') = ?`,
      args: [clientPk],
    });
    ids = r.rows.map((o) => Number(o.id));
  }
  if (ids.length === 0) return fail("Nothing is waiting to be sent again.");
  await replayDeliveries(ids);
  await kickJobs();
  revalidateIntegrations();
  return OK;
}

export async function setRecordOwner(_prev: ActionState, form: FormData): Promise<ActionState> {
  const session = await requirePermission("integrations.manage");
  const recordType = str(form.get("recordType"));
  const field = str(form.get("field"));
  const owner = str(form.get("owner"));
  if (!OWNED_RECORD_TYPES.includes(recordType)) return fail("That kind of record is not recognised.");
  if (field && !OWNERSHIP_DEFAULTS.find((o) => o.recordType === recordType)?.fields?.includes(field)) {
    return fail("That field cannot be owned separately.");
  }
  if (owner !== "hrms" && owner !== "erp" && !(owner === "inherit" && field)) return fail("Choose the HRMS or the ERP.");
  await setOwner(actorOf(session), recordType, field, owner as "hrms" | "erp" | "inherit");
  revalidateIntegrations();
  return OK;
}

export async function retryIssue(_prev: ActionState, form: FormData): Promise<ActionState> {
  const session = await requirePermission("integrations.manage");
  const result = await retrySyncIssue(actorOf(session), Number(form.get("id")));
  if (!result.ok) return fail(result.error);
  revalidateIntegrations();
  return result.value === "resolved" ? OK : fail("It still cannot be applied. Fix the cause, or discard it.");
}

export async function discardIssue(_prev: ActionState, form: FormData): Promise<ActionState> {
  const session = await requirePermission("integrations.manage");
  await discardSyncIssue(actorOf(session), Number(form.get("id")));
  revalidateIntegrations();
  return OK;
}

/** After fixing what the ERP refused: the journal goes to the ERP again. */
export async function resendJournal(_prev: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireAnyPermission("payroll.post", "integrations.manage");
  const id = Number(form.get("id"));
  const posting = (await rawClient().execute({ sql: "SELECT id FROM py_gl_posting WHERE id = ?", args: [id] })).rows[0];
  if (!posting) return fail("That journal no longer exists.");
  const before = await ackState("gl_posting", id);
  await resetAck(actorOf(session), "gl_posting", id);
  // Logged as a resend, which becomes a fresh gl.posting.created event.
  await recordChanges(actorOf(session), [
    { entity: "py_gl_posting", entityId: id, action: "update", before: { ack_state: before.state }, after: { ack_state: "pending", resent: true } },
  ]);
  revalidateIntegrations();
  return OK;
}
