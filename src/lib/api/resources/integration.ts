import "server-only";
import { z } from "zod";
import { rawClient } from "@/lib/db";
import { EVENT_TYPES, ALL_EVENT_TYPES, envelope, eventsAfter, newWebhookSecret, type EventType } from "../events";
import { TOKEN_TTL_SECONDS, issueToken, verifyCredentials } from "../clients";
import { DEFAULT_LIMIT, MAX_LIMIT, decodeCursor, encodeCursor } from "../format";
import { ApiError, invalid, notFound } from "../problem";
import { parseScopes } from "../scopes";
import type { Endpoint } from "../router";

/**
 * Authentication, and the parts of the API that keep two systems in step:
 * the event feed, deletions, webhook subscriptions and sync issues.
 */

const Envelope = z
  .object({
    specversion: z.literal("1.0"),
    id: z.string(),
    type: z.string(),
    source: z.string(),
    subject: z.string(),
    time: z.string(),
    datacontenttype: z.literal("application/json"),
    sequence: z.string().meta({ description: "Increases with every event: the order to apply them in." }),
    originclient: z.string().optional().meta({ description: "The client whose change caused this, when a client did." }),
    data: z.record(z.string(), z.unknown()),
  })
  .meta({ id: "Event", description: "A CloudEvents 1.0 event." });

const Subscription = z
  .object({
    id: z.number().int(),
    url: z.string(),
    event_types: z.array(z.string()).nullable(),
    include_own: z.boolean(),
    active: z.boolean(),
    created_at: z.string(),
  })
  .meta({ id: "WebhookSubscription" });

/** Where each table's deletions appear in the API. */
const DELETED_RESOURCES: Record<string, string> = {
  pt_it2001_absence: "absences",
  py_it0015_additional_payment: "one-off-payments",
  py_it0014_recurring_payment: "recurring-payments",
  om_company: "companies",
  om_personnel_area: "personnel-areas",
  om_org_unit: "departments",
  om_job: "jobs",
  om_position: "positions",
  pa_it0001_org_assignment: "employee-history/org_assignment",
  pa_it0002_personal_data: "employee-history/personal_data",
  pa_it0007_planned_working_time: "employee-history/working_time",
  pa_it0008_basic_pay: "employee-history/basic_pay",
  pa_it0009_bank_details: "employee-history/bank_account",
  py_gl_posting: "gl-postings",
};

const subscriptionOf = (w: Record<string, unknown>) => ({
  id: Number(w.id),
  url: String(w.url),
  event_types: w.event_types ? String(w.event_types).split(",") : null,
  include_own: Number(w.include_own) === 1,
  active: Number(w.active) === 1,
  created_at: String(w.created_at),
});

export const integrationEndpoints: Endpoint[] = [
  {
    method: "POST",
    path: "/oauth/token",
    tag: "Authentication",
    summary: "Take an access token",
    description:
      "OAuth 2.0 client credentials. Send your client id and secret — as form fields, a JSON body, or HTTP Basic authentication — and get a bearer token valid for an hour. Ask for fewer scopes with `scope`; by default the token carries every scope the client holds.",
    scopes: [],
    public: true,
    form: true,
    body: z.object({
      grant_type: z.literal("client_credentials"),
      client_id: z.string().optional(),
      client_secret: z.string().optional(),
      scope: z.string().optional().meta({ description: "Space-separated scopes, a subset of the client's." }),
    }),
    response: z.object({
      access_token: z.string(),
      token_type: z.literal("Bearer"),
      expires_in: z.number().int(),
      scope: z.string(),
    }),
    example: {
      body: { grant_type: "client_credentials", client_id: "cl_…", client_secret: "hs_…", scope: "employees:read events:read" },
      response: { access_token: "eyJhbGciOiJIUzI1NiIs…", token_type: "Bearer", expires_in: 3600, scope: "employees:read events:read" },
    },
    handler: async (ctx) => {
      const b = ctx.body as { client_id?: string; client_secret?: string; scope?: string };
      let clientId = b.client_id;
      let secret = b.client_secret;
      const basic = ctx.headers.get("authorization");
      if ((!clientId || !secret) && basic?.startsWith("Basic ")) {
        const [id, ...rest] = Buffer.from(basic.slice(6), "base64").toString().split(":");
        clientId = decodeURIComponent(id);
        secret = decodeURIComponent(rest.join(":"));
      }
      if (!clientId || !secret) throw new ApiError(401, "invalid_client", "Send client_id and client_secret.");
      const client = await verifyCredentials(clientId, secret);
      if (!client) throw new ApiError(401, "invalid_client");
      const { token, scopes } = await issueToken(client, parseScopes(b.scope));
      return {
        body: { access_token: token, token_type: "Bearer", expires_in: TOKEN_TTL_SECONDS, scope: scopes.join(" ") },
        headers: { "Cache-Control": "no-store", Pragma: "no-cache" },
      };
    },
  },
  {
    method: "GET",
    path: "/events",
    tag: "Events",
    summary: "The event feed",
    description:
      "Every event this client may see, in order, after a sequence number — the same events webhooks carry, for a system that would rather ask than be told. Start with `after=0`, then pass the `next_after` you were given. Your own changes are left out unless `include_own=true`.",
    scopes: ["events:read"],
    query: z.object({
      after: z.coerce.number().int().min(0).default(0),
      limit: z.coerce.number().int().min(1).max(MAX_LIMIT).optional(),
      types: z.string().optional().meta({ description: "Comma-separated event types." }),
      include_own: z.enum(["true", "false"]).optional(),
    }),
    response: z.object({ data: z.array(Envelope), next_after: z.number().int() }),
    example: {
      query: "after=0&types=employee.hired",
      response: {
        data: [
          {
            specversion: "1.0",
            id: "evt_812_employee_hired",
            type: "employee.hired",
            source: "urn:hrms",
            subject: "employees/7",
            time: "2026-09-27T09:12:44.103Z",
            datacontenttype: "application/json",
            sequence: "41",
            data: { id: 7, employee_number: "EMP1007", status: "Active" },
          },
        ],
        next_after: 41,
      },
    },
    handler: async (ctx) => {
      const q = ctx.query as { after: number; limit?: number; types?: string; include_own?: string };
      const limit = q.limit ?? DEFAULT_LIMIT;
      const types = q.types ? q.types.split(",").map((t) => t.trim()) : null;
      const out: ReturnType<typeof envelope>[] = [];
      let cursor = q.after;
      let scanned = q.after;
      const clientIds = new Map<number, string>((await rawClient().execute("SELECT id, client_id FROM int_client")).rows.map((c) => [Number(c.id), String(c.client_id)]));
      // Read ahead in chunks, skipping what this client may not see.
      for (let round = 0; round < 20 && out.length < limit; round++) {
        const batch = await eventsAfter(cursor, 500);
        if (batch.length === 0) break;
        for (const e of batch) {
          scanned = e.seq;
          if (!ctx.has(EVENT_TYPES[e.type]?.scope)) continue;
          if (types && !types.includes(e.type)) continue;
          if (q.include_own !== "true" && e.causedByClientPk === ctx.client.pk) continue;
          out.push(envelope(e, ctx.scopes, e.causedByClientPk ? (clientIds.get(e.causedByClientPk) ?? null) : null));
          if (out.length >= limit) break;
        }
        cursor = batch[batch.length - 1].seq;
      }
      const nextAfter = out.length >= limit ? Number(out[out.length - 1].sequence) : scanned;
      return { body: { data: out, next_after: nextAfter } };
    },
  },
  {
    method: "GET",
    path: "/event-types",
    tag: "Events",
    summary: "The event catalogue",
    description: "Every event type, the scope needed to receive it, and what its data is.",
    scopes: [],
    response: z.object({ data: z.array(z.object({ type: z.string(), scope: z.string(), description: z.string() })) }),
    handler: async () => ({
      body: { data: ALL_EVENT_TYPES.map((type) => ({ type, scope: EVENT_TYPES[type].scope, description: EVENT_TYPES[type].description })) },
    }),
  },
  {
    method: "GET",
    path: "/deletions",
    tag: "Events",
    summary: "What was deleted",
    description:
      "Records deleted since a moment, so a copy kept by polling `updated_since` can drop them too. Page with `cursor`.",
    scopes: ["events:read"],
    query: z.object({
      since: z.string().datetime({ offset: true }),
      limit: z.coerce.number().int().min(1).max(MAX_LIMIT).optional(),
      cursor: z.string().optional(),
    }),
    response: z.object({
      data: z.array(z.object({ resource: z.string(), id: z.string(), employee_id: z.number().int().nullable(), deleted_at: z.string() })),
      next_cursor: z.string().nullable(),
    }),
    example: { query: "since=2026-09-01T00:00:00Z" },
    handler: async (ctx) => {
      const q = ctx.query as { since: string; limit?: number; cursor?: string };
      const limit = q.limit ?? DEFAULT_LIMIT;
      const entities = Object.keys(DELETED_RESOURCES);
      const r = await rawClient().execute({
        sql: `SELECT id, entity, entity_id, subject_employee_id, at FROM app_change_log
              WHERE action = 'delete' AND at > ? AND id > ? AND entity IN (${entities.map(() => "?").join(", ")})
              ORDER BY id LIMIT ?`,
        args: [new Date(q.since).toISOString(), decodeCursor(q.cursor), ...entities, limit + 1],
      });
      const rows = r.rows.slice(0, limit);
      return {
        body: {
          data: rows.map((d) => ({
            resource: DELETED_RESOURCES[String(d.entity)],
            id: String(d.entity_id),
            employee_id: d.subject_employee_id === null ? null : Number(d.subject_employee_id),
            deleted_at: String(d.at),
          })),
          next_cursor: r.rows.length > limit ? encodeCursor(Number(rows[rows.length - 1].id)) : null,
        },
      };
    },
  },
  {
    method: "GET",
    path: "/webhook-subscriptions",
    tag: "Events",
    summary: "This client's webhook subscriptions",
    scopes: ["events:read"],
    response: z.object({ data: z.array(Subscription) }),
    handler: async (ctx) => {
      const r = await rawClient().execute({ sql: "SELECT * FROM int_webhook WHERE client_pk = ? ORDER BY id", args: [ctx.client.pk] });
      return { body: { data: r.rows.map((w) => subscriptionOf(w as unknown as Record<string, unknown>)) } };
    },
  },
  {
    method: "POST",
    path: "/webhook-subscriptions",
    tag: "Events",
    summary: "Subscribe to webhooks",
    description:
      "Events are POSTed to `url` as CloudEvents, signed to the Standard Webhooks specification with the `secret` returned here — shown this once. Answer 2xx within ten seconds; anything else is retried with backoff and parked after ten attempts. Leave `event_types` out for every type the client's scopes allow.",
    scopes: ["events:read"],
    body: z.object({
      url: z.string().url().refine((u) => /^https?:\/\//.test(u), "The URL must be http or https."),
      event_types: z.array(z.string()).nullable().default(null),
      include_own: z.boolean().default(false),
    }),
    response: Subscription.extend({ secret: z.string() }),
    status: 201,
    idempotent: true,
    example: {
      body: { url: "https://erp.example.com/hrms/webhooks", event_types: ["employee.hired", "gl.posting.created"] },
      response: { id: 1, url: "https://erp.example.com/hrms/webhooks", event_types: ["employee.hired", "gl.posting.created"], include_own: false, active: true, created_at: "2026-09-27T09:00:00.000Z", secret: "whsec_…" },
    },
    handler: async (ctx) => {
      const b = ctx.body as { url: string; event_types: string[] | null; include_own: boolean };
      const unknown = (b.event_types ?? []).filter((t) => !(t in EVENT_TYPES));
      if (unknown.length) throw invalid(`Unknown event type${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}.`);
      const blocked = (b.event_types ?? []).filter((t) => !ctx.has(EVENT_TYPES[t as EventType].scope));
      if (blocked.length) throw new ApiError(403, "insufficient_scope", `This client may not receive ${blocked.join(", ")}.`);
      const secret = newWebhookSecret();
      const r = await rawClient().execute({
        sql: `INSERT INTO int_webhook (client_pk, url, secret, event_types, include_own, active, created_at)
              VALUES (?, ?, ?, ?, ?, 1, ?) RETURNING *`,
        args: [ctx.client.pk, b.url, secret, b.event_types?.length ? b.event_types.join(",") : null, b.include_own ? 1 : 0, new Date().toISOString()],
      });
      return { status: 201, body: { ...subscriptionOf(r.rows[0] as unknown as Record<string, unknown>), secret } };
    },
  },
  {
    method: "DELETE",
    path: "/webhook-subscriptions/{id}",
    tag: "Events",
    summary: "Unsubscribe",
    scopes: ["events:read"],
    params: { id: "The subscription's id." },
    response: z.null(),
    status: 204,
    handler: async (ctx) => {
      const r = await rawClient().execute({ sql: "DELETE FROM int_webhook WHERE id = ? AND client_pk = ?", args: [Number(ctx.params.id), ctx.client.pk] });
      if (r.rowsAffected === 0) throw notFound();
      return { status: 204 };
    },
  },
  {
    method: "GET",
    path: "/sync-issues",
    tag: "Integration",
    summary: "What could not be applied",
    description: "Items this client sent that could not be applied automatically, and what HR did about them.",
    scopes: [],
    query: z.object({ state: z.enum(["open", "resolved", "discarded"]).optional() }),
    response: z.object({
      data: z.array(
        z.object({ id: z.number().int(), kind: z.string(), reference: z.string().nullable(), reason: z.string(), state: z.string(), created_at: z.string(), resolved_at: z.string().nullable() }),
      ),
    }),
    handler: async (ctx) => {
      const state = (ctx.query as { state?: string }).state;
      const r = await rawClient().execute({
        sql: `SELECT * FROM int_sync_issue WHERE client_pk = ? ${state ? "AND state = ?" : ""} ORDER BY id DESC LIMIT 200`,
        args: [ctx.client.pk, ...(state ? [state] : [])],
      });
      return {
        body: {
          data: r.rows.map((i) => ({
            id: Number(i.id),
            kind: String(i.kind),
            reference: i.reference === null ? null : String(i.reference),
            reason: String(i.reason),
            state: String(i.state),
            created_at: String(i.created_at),
            resolved_at: i.resolved_at === null ? null : String(i.resolved_at),
          })),
        },
      };
    },
  },
];
