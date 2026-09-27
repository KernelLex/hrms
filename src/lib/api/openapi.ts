import { z } from "zod";
import { SCOPES } from "./scopes";
import { PROBLEM_TYPES } from "./problem";
import type { Endpoint } from "./router";

/**
 * The OpenAPI 3.1 document, generated from the endpoint definitions and
 * their zod schemas — the same ones that validate every request and shape
 * every response, so the specification cannot drift from the code.
 */

export const API_VERSION = "1.0.0";

const Problem = z
  .object({
    type: z.string(),
    title: z.string(),
    status: z.number().int(),
    code: z.enum(Object.keys(PROBLEM_TYPES) as [keyof typeof PROBLEM_TYPES, ...(keyof typeof PROBLEM_TYPES)[]]),
    detail: z.string(),
    request_id: z.string(),
    errors: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  })
  .meta({ id: "Problem", description: "RFC 9457 problem details." });

const toSchema = (schema: z.ZodType, io: "input" | "output") => {
  const json = z.toJSONSchema(schema, { io, unrepresentable: "any", target: "draft-2020-12" }) as Record<string, unknown>;
  delete json.$schema;
  return json;
};

/** Moves `$defs` into components, so every endpoint shares one Money, one Employee. */
function hoist(json: Record<string, unknown>, components: Record<string, unknown>): Record<string, unknown> {
  const rewritten = JSON.parse(JSON.stringify(json).replace(/"#\/\$defs\//g, '"#/components/schemas/')) as Record<string, unknown>;
  const defs = rewritten.$defs as Record<string, unknown> | undefined;
  if (defs) {
    for (const [name, def] of Object.entries(defs)) components[name] = def;
    delete rewritten.$defs;
  }
  return rewritten;
}

const errorResponses = (e: Endpoint) => {
  const codes = new Set<number>([400, 500]);
  if (!e.public) [401, 403, 429].forEach((c) => codes.add(c));
  if (e.path.includes("{")) codes.add(404);
  if (e.body && !e.public) codes.add(422);
  if (e.etag && e.method !== "GET") codes.add(412);
  if (e.method !== "GET" && !e.public) codes.add(409);
  const text: Record<number, string> = {
    400: "The request is malformed.",
    401: "No valid token (or, at the token endpoint, wrong credentials).",
    403: "The token lacks a scope this call needs, or the caller's address is not allowed.",
    404: "Not found, or outside the companies this client may see.",
    409: "Owned by the other system, or conflicts with the record's state.",
    412: "If-Match did not match: the record changed since it was read.",
    422: "The body did not pass validation.",
    429: "Rate limited: wait for Retry-After seconds.",
    500: "An error on our side. Retry with the same Idempotency-Key.",
  };
  return Object.fromEntries(
    [...codes].sort().map((c) => [String(c), { description: text[c], content: { "application/problem+json": { schema: { $ref: "#/components/schemas/Problem" } } } }]),
  );
};

export function buildOpenApi(endpoints: Endpoint[], serverUrl = "https://hrms-amogh24.vercel.app/api/v1") {
  const components: Record<string, unknown> = { Problem: hoist(toSchema(Problem, "output"), {}) };
  const paths: Record<string, Record<string, unknown>> = {};

  for (const e of endpoints) {
    const parameters: unknown[] = [];
    for (const [name, description] of Object.entries(e.params ?? {})) {
      parameters.push({ name, in: "path", required: true, description, schema: { type: "string" } });
    }
    if (e.query) {
      const q = hoist(toSchema(e.query, "input"), components) as { properties?: Record<string, Record<string, unknown>>; required?: string[] };
      for (const [name, schema] of Object.entries(q.properties ?? {})) {
        const { description, ...rest } = schema;
        parameters.push({ name, in: "query", required: (q.required ?? []).includes(name) && !("default" in rest), description, schema: rest });
      }
    }
    if (e.idempotent) {
      parameters.push({ name: "Idempotency-Key", in: "header", required: false, description: "A unique key per operation. A retry with the same key returns the first response instead of acting again.", schema: { type: "string", maxLength: 200 } });
    }
    if (e.etag && e.method !== "GET") {
      parameters.push({ name: "If-Match", in: "header", required: false, description: "The ETag you read. If the record changed since, the write is refused with 412.", schema: { type: "string" } });
    }

    const status = String(e.status ?? 200);
    const operation: Record<string, unknown> = {
      operationId: `${e.method.toLowerCase()}${e.path.replace(/\{(\w+)\}/g, "By_$1").replace(/[^A-Za-z0-9]+(.)?/g, (_, c: string | undefined) => (c ? c.toUpperCase() : ""))}`,
      tags: [e.tag],
      summary: e.summary,
      description: [
        e.description,
        e.scopes.length ? `**Scopes:** ${e.scopes.map((s) => `\`${s}\``).join(", ")}.` : e.public ? "**Open:** no token needed." : "**Scopes:** any token.",
        e.optionalScopes?.length ? `**Adds fields with:** ${e.optionalScopes.map((s) => `\`${s}\``).join(", ")}.` : null,
      ]
        .filter(Boolean)
        .join("\n\n"),
      parameters,
      responses: {
        [status]:
          status === "204"
            ? { description: "Done; no body." }
            : {
                description: "Success.",
                ...(e.etag ? { headers: { ETag: { description: "The record's version, for If-Match.", schema: { type: "string" } } } } : {}),
                content: { "application/json": { schema: hoist(toSchema(e.response, "output"), components), ...(e.example?.response ? { example: e.example.response } : {}) } },
              },
        ...errorResponses(e),
      },
      ...(e.public ? { security: [] } : { security: [{ clientCredentials: e.scopes }] }),
    };
    if (e.body) {
      const schema = hoist(toSchema(e.body, "input"), components);
      operation.requestBody = {
        required: true,
        content: {
          "application/json": { schema, ...(e.example?.body ? { example: e.example.body } : {}) },
          ...(e.form ? { "application/x-www-form-urlencoded": { schema } } : {}),
        },
      };
    }
    paths[e.path] = { ...(paths[e.path] ?? {}), [e.method.toLowerCase()]: operation };
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "HRMS API",
      version: API_VERSION,
      summary: "The HR module's two-way API for the client's ERP.",
      description:
        "Read people, organisation, time and payroll; send what the ERP owns; receive events. Money is a decimal string with its currency, dates are YYYY-MM-DD, timestamps are ISO 8601 in UTC. The full guide is API.md in the repository.",
    },
    servers: [{ url: serverUrl }],
    security: [{ clientCredentials: [] }],
    tags: [...new Set(endpoints.map((e) => e.tag))].map((name) => ({ name })),
    paths,
    components: {
      schemas: components,
      securitySchemes: {
        clientCredentials: {
          type: "oauth2",
          description: "OAuth 2.0 client credentials. Take a token at /oauth/token and send it as `Authorization: Bearer …`.",
          flows: { clientCredentials: { tokenUrl: `${serverUrl}/oauth/token`, scopes: SCOPES } },
        },
      },
    },
  };
}
