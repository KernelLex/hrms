import "server-only";
import { rawClient } from "@/lib/db";
import { parseScopes, type Scope } from "@/lib/api/scopes";

/** Reads for the Integrations screens. */

const s = (v: unknown) => (v === null || v === undefined ? null : String(v));

export type ClientSummary = {
  pk: number;
  clientId: string;
  name: string;
  status: string;
  scopes: Scope[];
  companies: string[];
  allowedIps: string[];
  rateLimit: number;
  systemKey: string;
  createdAt: string;
  lastUsedAt: string | null;
  requests24h: number;
  errors24h: number;
  webhooks: number;
  parked: number;
};

export async function listClients(): Promise<ClientSummary[]> {
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const r = await rawClient().execute({
    sql: `SELECT c.*,
            (SELECT COUNT(*) FROM int_request_log l WHERE l.client_pk = c.id AND l.at > ?1) AS requests,
            (SELECT COUNT(*) FROM int_request_log l WHERE l.client_pk = c.id AND l.at > ?1 AND l.status >= 400) AS errors,
            (SELECT COUNT(*) FROM int_webhook w WHERE w.client_pk = c.id AND w.active = 1) AS webhooks,
            (SELECT COUNT(*) FROM app_outbox o WHERE o.channel = 'webhook' AND o.status = 'failed'
               AND json_extract(o.payload, '$.client_pk') = c.id) AS parked
          FROM int_client c ORDER BY c.name`,
    args: [since],
  });
  return r.rows.map((c) => ({
    pk: Number(c.id),
    clientId: String(c.client_id),
    name: String(c.name),
    status: String(c.status),
    scopes: parseScopes(String(c.scopes)),
    companies: c.companies ? String(c.companies).split(",") : [],
    allowedIps: c.allowed_ips ? String(c.allowed_ips).split(",") : [],
    rateLimit: Number(c.rate_limit),
    systemKey: String(c.system_key),
    createdAt: String(c.created_at),
    lastUsedAt: s(c.last_used_at),
    requests24h: Number(c.requests),
    errors24h: Number(c.errors),
    webhooks: Number(c.webhooks),
    parked: Number(c.parked),
  }));
}

export async function clientDetail(pk: number) {
  const client = (await listClients()).find((c) => c.pk === pk);
  if (!client) return null;
  const [secrets, webhooks, deliveries, requests] = await Promise.all([
    rawClient().execute({ sql: "SELECT * FROM int_client_secret WHERE client_pk = ? ORDER BY id DESC", args: [pk] }),
    rawClient().execute({ sql: "SELECT * FROM int_webhook WHERE client_pk = ? ORDER BY id", args: [pk] }),
    rawClient().execute({
      sql: `SELECT id, recipient, subject, status, attempts, last_error, created_at, sent_at, next_attempt_at
            FROM app_outbox WHERE channel = 'webhook' AND json_extract(payload, '$.client_pk') = ?
            ORDER BY id DESC LIMIT 50`,
      args: [pk],
    }),
    rawClient().execute({ sql: "SELECT * FROM int_request_log WHERE client_pk = ? ORDER BY id DESC LIMIT 50", args: [pk] }),
  ]);
  const now = new Date().toISOString();
  return {
    client,
    secrets: secrets.rows.map((x) => ({
      id: Number(x.id),
      hint: String(x.hint),
      createdAt: String(x.created_at),
      expiresAt: s(x.expires_at),
      revokedAt: s(x.revoked_at),
      working: x.revoked_at === null && (x.expires_at === null || String(x.expires_at) > now),
    })),
    webhooks: webhooks.rows.map((w) => ({
      id: Number(w.id),
      url: String(w.url),
      types: w.event_types ? String(w.event_types).split(",") : null,
      includeOwn: Number(w.include_own) === 1,
      active: Number(w.active) === 1,
      createdAt: String(w.created_at),
    })),
    deliveries: deliveries.rows.map((d) => ({
      id: Number(d.id),
      url: String(d.recipient),
      type: String(d.subject),
      status: String(d.status),
      attempts: Number(d.attempts),
      lastError: s(d.last_error),
      createdAt: String(d.created_at),
      sentAt: s(d.sent_at),
      nextAttemptAt: s(d.next_attempt_at),
    })),
    requests: requests.rows.map((q) => ({
      id: Number(q.id),
      method: String(q.method),
      route: String(q.route),
      status: Number(q.status),
      durationMs: Number(q.duration_ms),
      correlationId: String(q.correlation_id),
      at: String(q.at),
    })),
  };
}

export async function listSyncIssues(state: string) {
  const r = await rawClient().execute({
    sql: `SELECT i.*, c.name AS client_name FROM int_sync_issue i LEFT JOIN int_client c ON c.id = i.client_pk
          WHERE i.state = ? ORDER BY i.id DESC LIMIT 200`,
    args: [state],
  });
  return r.rows.map((i) => ({
    id: Number(i.id),
    clientName: s(i.client_name),
    direction: String(i.direction),
    kind: String(i.kind),
    reference: s(i.reference),
    payload: s(i.payload),
    reason: String(i.reason),
    state: String(i.state),
    createdAt: String(i.created_at),
    resolvedAt: s(i.resolved_at),
    resolvedBy: s(i.resolved_by),
  }));
}

export async function issueCounts(): Promise<Record<string, number>> {
  const r = await rawClient().execute("SELECT state, COUNT(*) AS n FROM int_sync_issue GROUP BY state");
  return Object.fromEntries(r.rows.map((x) => [String(x.state), Number(x.n)]));
}

/**
 * Every posted journal: whether an ERP received it, whether it was booked,
 * the ERP's reference, and whether its totals agree with ours.
 */
export async function reconciliation() {
  const r = await rawClient().execute(
    `SELECT p.id, p.run_id, p.posting_date, p.posted_at,
            pp.year, pp.month, run.run_type,
            (SELECT SUM(debit_paise) FROM py_gl_posting_line l WHERE l.posting_id = p.id) AS debit,
            (SELECT SUM(credit_paise) FROM py_gl_posting_line l WHERE l.posting_id = p.id) AS credit,
            a.state, a.reference, a.reason, a.totals, a.updated_at,
            (SELECT COUNT(*) FROM app_outbox o WHERE o.channel = 'webhook' AND o.subject = 'gl.posting.created' AND o.status = 'sent'
               AND o.body_text LIKE '%"subject":"gl-postings/' || p.id || '"%') AS delivered
     FROM py_gl_posting p
     JOIN py_payroll_run run ON run.id = p.run_id
     JOIN py_payroll_period pp ON pp.id = run.period_id
     LEFT JOIN int_ack a ON a.entity = 'gl_posting' AND a.entity_id = CAST(p.id AS TEXT)
     ORDER BY p.posting_date DESC, p.id DESC`,
  );
  return r.rows.map((p) => {
    const totals = p.totals ? (JSON.parse(String(p.totals)) as { debit?: string; credit?: string }) : null;
    const ours = { debit: Number(p.debit ?? 0), credit: Number(p.credit ?? 0) };
    const theirs = totals ? { debit: Math.round(Number(totals.debit) * 100), credit: Math.round(Number(totals.credit) * 100) } : null;
    return {
      id: Number(p.id),
      runId: Number(p.run_id),
      year: Number(p.year),
      month: Number(p.month),
      runType: String(p.run_type),
      postingDate: String(p.posting_date),
      debit: ours.debit,
      credit: ours.credit,
      delivered: Number(p.delivered) > 0,
      state: s(p.state) ?? "pending",
      reference: s(p.reference),
      reason: s(p.reason),
      theirs,
      matches: theirs ? theirs.debit === ours.debit && theirs.credit === ours.credit : null,
      updatedAt: s(p.updated_at),
    };
  });
}
