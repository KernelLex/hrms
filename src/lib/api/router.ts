import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { rawClient } from "@/lib/db";
import type { Actor } from "@/lib/change-log";
import { kickJobs } from "@/lib/jobs/runner";
import { verifyToken, type ApiClient } from "./clients";
import { sha256, stableJson } from "./format";
import { ApiError, problemBody } from "./problem";
import type { Scope } from "./scopes";

/**
 * One router for the whole API, behind a single catch-all route handler.
 *
 * Every endpoint is a definition — method, path, scopes, query and body
 * schemas, response schema, handler — so the same definitions validate
 * requests, generate the OpenAPI document, drive the contract tests and
 * write the endpoint reference in API.md. Nothing about an endpoint is
 * described twice.
 */

export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type ApiContext = {
  client: ApiClient;
  scopes: Set<Scope>;
  has: (scope: Scope) => boolean;
  actor: Actor;
  correlationId: string;
  params: Record<string, string>;
  query: Record<string, unknown>;
  body: unknown;
  headers: Headers;
  origin: string;
};

export type ApiResult = {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
  /** A file instead of JSON, such as a payslip PDF. */
  file?: { bytes: Uint8Array; contentType: string; fileName: string };
};

export type Endpoint = {
  method: Method;
  /** "/employees/{id}" */
  path: string;
  tag: string;
  summary: string;
  description?: string;
  /** Every one of these is needed. */
  scopes: Scope[];
  /** Scopes that add fields to the response when held. */
  optionalScopes?: Scope[];
  /** Open to anyone: the token endpoint and the specification. */
  public?: boolean;
  params?: Record<string, string>;
  query?: z.ZodObject;
  body?: z.ZodType;
  /** Accepts form-encoded bodies too (the token endpoint). */
  form?: boolean;
  response: z.ZodType;
  status?: number;
  /** POST: an Idempotency-Key makes a retry return the first response. */
  idempotent?: boolean;
  /** Returns an ETag; PUT and PATCH honour If-Match. */
  etag?: boolean;
  /** Answers with a file of this type rather than JSON. */
  produces?: "application/pdf";
  /** For the documentation: a request and its response. */
  example?: {
    path?: string;
    query?: string;
    body?: unknown;
    response?: unknown;
  };
  handler: (ctx: ApiContext) => Promise<ApiResult>;
};

type Compiled = Endpoint & { regex: RegExp; keys: string[] };

const compile = (e: Endpoint): Compiled => {
  const keys: string[] = [];
  const pattern = e.path.replace(/\{(\w+)\}/g, (_, k: string) => {
    keys.push(k);
    return "([^/]+)";
  });
  return { ...e, regex: new RegExp(`^${pattern}$`), keys };
};

const json = (status: number, body: unknown, headers: Record<string, string> = {}, problem = false) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": problem ? "application/problem+json" : "application/json",
      "Cache-Control": "no-store",
      ...headers,
    },
  });

function clientIp(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return headers.get("x-real-ip");
}

const issuesOf = (err: z.ZodError) =>
  err.issues.map((i) => ({ path: i.path.join(".") || "(body)", message: i.message }));

async function rateLimit(client: ApiClient): Promise<{ remaining: number; reset: number }> {
  const since = new Date(Date.now() - 60_000).toISOString();
  const r = await rawClient().execute({
    sql: "SELECT COUNT(*) AS n FROM int_request_log WHERE client_pk = ? AND at > ?",
    args: [client.pk, since],
  });
  const used = Number(r.rows[0].n);
  return { remaining: client.rateLimit - used - 1, reset: 60 };
}

async function logRequest(entry: {
  clientPk: number | null;
  method: string;
  route: string;
  status: number;
  started: number;
  correlationId: string;
}) {
  try {
    await rawClient().batch(
      [
        {
          sql: `INSERT INTO int_request_log (client_pk, method, route, status, duration_ms, correlation_id, at)
                VALUES (?, ?, ?, ?, ?, ?, ?)`,
          args: [
            entry.clientPk,
            entry.method,
            entry.route,
            entry.status,
            Date.now() - entry.started,
            entry.correlationId,
            new Date().toISOString(),
          ],
        },
        ...(entry.clientPk
          ? [{ sql: "UPDATE int_client SET last_used_at = ? WHERE id = ?", args: [new Date().toISOString(), entry.clientPk] }]
          : []),
      ],
      "write",
    );
  } catch (err) {
    console.error("Could not log an API request", err);
  }
}

async function readBody(req: Request, endpoint: Endpoint): Promise<unknown> {
  if (!endpoint.body) return undefined;
  const type = req.headers.get("content-type") ?? "";
  const text = await req.text();
  if (endpoint.form && type.includes("application/x-www-form-urlencoded")) {
    return Object.fromEntries(new URLSearchParams(text));
  }
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError(400, "invalid_request", "The body is not valid JSON.");
  }
}

/** Replays a finished request, or claims the key for this one. */
async function idempotency(
  client: ApiClient,
  endpoint: Endpoint,
  key: string,
  requestHash: string,
): Promise<Response | null> {
  const claimed = await rawClient().execute({
    sql: `INSERT OR IGNORE INTO int_idempotency (client_pk, key, method, route, request_hash, status, created_at)
          VALUES (?, ?, ?, ?, ?, 0, ?)`,
    args: [client.pk, key, endpoint.method, endpoint.path, requestHash, new Date().toISOString()],
  });
  if (claimed.rowsAffected === 1) return null;
  const r = await rawClient().execute({
    sql: "SELECT * FROM int_idempotency WHERE client_pk = ? AND key = ?",
    args: [client.pk, key],
  });
  const row = r.rows[0];
  if (String(row.request_hash) !== requestHash || String(row.route) !== endpoint.path) {
    throw new ApiError(422, "idempotency_key_reused");
  }
  if (Number(row.status) === 0) throw new ApiError(409, "idempotency_in_progress", undefined, undefined, { "Retry-After": "1" });
  return json(Number(row.status), row.body === null ? undefined : JSON.parse(String(row.body)), {
    "Idempotent-Replayed": "true",
  });
}

export function createRouter(endpoints: Endpoint[]) {
  const compiled = endpoints.map(compile);

  return async function dispatch(req: Request, path: string): Promise<Response> {
    const started = Date.now();
    const correlationId = req.headers.get("x-request-id")?.slice(0, 64) || randomUUID();
    const url = new URL(req.url);
    const method = req.method.toUpperCase() as Method;
    let client: ApiClient | null = null;
    let route = path;
    const baseHeaders: Record<string, string> = { "X-Request-Id": correlationId };
    let idempotencyKey: string | null = null;

    const finish = async (res: Response) => {
      for (const [k, v] of Object.entries(baseHeaders)) res.headers.set(k, v);
      if (client) {
        await logRequest({ clientPk: client.pk, method, route, status: res.status, started, correlationId });
        if (idempotencyKey && res.status < 500) {
          const body = res.status === 204 ? null : await res.clone().text();
          await rawClient().execute({
            sql: "UPDATE int_idempotency SET status = ?, body = ? WHERE client_pk = ? AND key = ?",
            args: [res.status, body, client.pk, idempotencyKey],
          });
        } else if (idempotencyKey) {
          // A failure on our side frees the key, so the retry can run.
          await rawClient().execute({
            sql: "DELETE FROM int_idempotency WHERE client_pk = ? AND key = ? AND status = 0",
            args: [client.pk, idempotencyKey],
          });
        }
      }
      return res;
    };

    try {
      const candidates = compiled.filter((e) => e.regex.test(path));
      if (candidates.length === 0) throw new ApiError(404, "not_found");
      const endpoint = candidates.find((e) => e.method === method);
      if (!endpoint) {
        throw new ApiError(405, "method_not_allowed", undefined, undefined, {
          Allow: candidates.map((e) => e.method).join(", "),
        });
      }
      route = endpoint.path;
      const match = endpoint.regex.exec(path)!;
      const params = Object.fromEntries(endpoint.keys.map((k, i) => [k, decodeURIComponent(match[i + 1])]));

      let scopes = new Set<Scope>();
      if (!endpoint.public) {
        const header = req.headers.get("authorization") ?? "";
        const token = header.startsWith("Bearer ") ? header.slice(7).trim() : null;
        const verified = token ? await verifyToken(token) : null;
        if (!verified) {
          throw new ApiError(401, "invalid_token", undefined, undefined, {
            "WWW-Authenticate": 'Bearer realm="hrms-api", error="invalid_token"',
          });
        }
        client = verified.client;
        scopes = verified.scopes;

        const ip = clientIp(req.headers);
        if (client.allowedIps && (!ip || !client.allowedIps.includes(ip))) {
          throw new ApiError(403, "forbidden_ip", `Calls from ${ip ?? "an unknown address"} are not allowed for this client.`);
        }
        const limit = await rateLimit(client);
        baseHeaders["RateLimit-Limit"] = String(client.rateLimit);
        baseHeaders["RateLimit-Remaining"] = String(Math.max(0, limit.remaining));
        baseHeaders["RateLimit-Reset"] = String(limit.reset);
        if (limit.remaining < 0) {
          throw new ApiError(429, "rate_limited", undefined, undefined, { "Retry-After": String(limit.reset) });
        }
        const missing = endpoint.scopes.filter((s) => !scopes.has(s));
        if (missing.length) {
          throw new ApiError(403, "insufficient_scope", `This call needs the ${missing.join(" and ")} scope${missing.length > 1 ? "s" : ""}.`, undefined, {
            "WWW-Authenticate": `Bearer error="insufficient_scope", scope="${missing.join(" ")}"`,
          });
        }
      }

      let query: Record<string, unknown> = {};
      if (endpoint.query) {
        const parsed = endpoint.query.safeParse(Object.fromEntries(url.searchParams));
        if (!parsed.success) throw new ApiError(400, "invalid_request", "A query parameter is not valid.", issuesOf(parsed.error));
        query = parsed.data as Record<string, unknown>;
      }

      const raw = await readBody(req, endpoint);
      let body: unknown = undefined;
      if (endpoint.body) {
        const parsed = endpoint.body.safeParse(raw);
        if (!parsed.success) {
          throw new ApiError(endpoint.public ? 400 : 422, endpoint.public ? "invalid_request" : "validation_failed", "The body is not valid.", issuesOf(parsed.error));
        }
        body = parsed.data;
      }

      if (client && endpoint.idempotent) {
        idempotencyKey = req.headers.get("idempotency-key");
        if (idempotencyKey) {
          const replay = await idempotency(client, endpoint, idempotencyKey, sha256(stableJson({ path, body: raw ?? null })));
          if (replay) {
            idempotencyKey = null; // already stored
            return finish(replay);
          }
        }
      }

      const ctx: ApiContext = {
        client: client ?? ({ pk: 0, clientId: "", name: "public", systemKey: "", status: "active", scopes: [], companies: null, allowedIps: null, rateLimit: 0 } as ApiClient),
        scopes,
        has: (s) => scopes.has(s),
        actor: { type: "client", id: client?.pk ?? null, name: client?.name ?? "public" },
        correlationId,
        params,
        query,
        body,
        headers: req.headers,
        origin: url.origin,
      };
      const result = await endpoint.handler(ctx);
      const status = result.status ?? endpoint.status ?? 200;
      if (client && method !== "GET") await kickJobs(url.origin);
      if (result.file) {
        return finish(
          new Response(Buffer.from(result.file.bytes), {
            status,
            headers: {
              "Content-Type": result.file.contentType,
              "Content-Disposition": `inline; filename="${result.file.fileName}"`,
              "Cache-Control": "no-store",
              ...result.headers,
            },
          }),
        );
      }
      return finish(json(status, status === 204 ? undefined : result.body, result.headers));
    } catch (err) {
      const apiError =
        err instanceof ApiError
          ? err
          : (console.error("API request failed", correlationId, err), new ApiError(500, "internal_error"));
      return finish(json(apiError.status, problemBody(apiError, correlationId, url.origin), apiError.headers, true));
    }
  };
}

/** For conditional writes: the stale-update check. */
export function checkIfMatch(ctx: ApiContext, currentEtag: string | null): void {
  const given = ctx.headers.get("if-match");
  if (!given || given === "*") return;
  const wanted = given.split(",").map((s) => s.trim());
  if (!currentEtag || !wanted.includes(currentEtag)) {
    throw new ApiError(412, "precondition_failed");
  }
}

/** Records that a client read someone's personal data. */
export async function logApiAccess(
  ctx: ApiContext,
  entry: { subjectEmployeeId: number | null; resource: string; resourceId?: string | number },
): Promise<void> {
  try {
    await rawClient().execute({
      sql: `INSERT INTO app_access_log (at, user_id, username, subject_employee_id, resource, resource_id, client_pk)
            VALUES (?, 0, ?, ?, ?, ?, ?)`,
      args: [
        new Date().toISOString(),
        `${ctx.client.name} (API)`,
        entry.subjectEmployeeId,
        entry.resource,
        entry.resourceId === undefined ? null : String(entry.resourceId),
        ctx.client.pk,
      ],
    });
  } catch (err) {
    console.error("Could not write the access log", err);
  }
}
