import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { rawClient } from "@/lib/db";
import { ENDPOINTS } from "@/lib/api";
import { rotateSecret, revokeOlderSecrets } from "@/lib/api/clients";
import { ALL_SCOPES } from "@/lib/api/scopes";
import { PROBLEM_TYPES } from "@/lib/api/problem";
import { runPayroll } from "@/lib/engines/payroll";
import { generateBankFile, postToLedger } from "@/app/actions/payroll";
import type { Endpoint } from "@/lib/api/router";
import { apiClient, call, type TestClient } from "./support/api";
import { form } from "./support/fixtures";
import { createArea, createPeriod, hireForPayroll, postPeriod } from "./support/payroll-fixtures";

/**
 * The API's contract: every endpoint answers with what its schema — and so
 * the OpenAPI document and API.md — says, refuses callers without a token or
 * the scopes it needs, and fails the way the problem catalogue says. A new
 * endpoint is covered here without a line added, except a sample path when
 * it takes parameters.
 */

let all: TestClient;
let none: TestClient;
const ids: Record<string, string> = {};

/** A real path for each GET that takes parameters. */
const SAMPLE_PATHS: Record<string, () => string> = {
  "/employees/{id}": () => `/employees/${ids.employee}`,
  "/employees/{id}/history": () => `/employees/${ids.employee}/history?record=org_assignment`,
  "/payroll/runs/{id}/results": () => `/payroll/runs/${ids.run}/results`,
  "/payroll/results/{id}/payslip": () => `/payroll/results/${ids.result}/payslip`,
};

const concrete = (e: Endpoint) => e.path.replace(/\{\w+\}/g, "1");

/** The query a GET needs at the least, from its example when it requires one. */
function sampleGet(e: Endpoint): string {
  if (SAMPLE_PATHS[e.path]) return SAMPLE_PATHS[e.path]();
  const needsQuery = e.query && !e.query.safeParse({}).success;
  return `${e.path}${needsQuery ? `?${e.example?.query ?? ""}` : ""}`;
}

beforeAll(async () => {
  // Lists with something in them, so their items are checked too.
  const area = await createArea();
  await hireForPayroll({ area, hireDate: "2020-01-01", pay: [{ from: "2020-01-01", amountRupees: 70_000 }] });
  const periodId = await createPeriod(area, 2026, 7);
  const { runId } = await runPayroll({ periodId, runBy: "test" });
  await postPeriod(periodId);
  await postToLedger({}, form({ runId, postingDate: "2026-07-31" }));
  await generateBankFile({}, form({ runId, paymentDate: "2026-07-31" }));
  ids.run = String(runId);
  const result = await rawClient().execute({ sql: "SELECT id FROM py_payroll_result WHERE run_id = ? LIMIT 1", args: [runId] });
  ids.result = String(result.rows[0].id);

  all = await apiClient(ALL_SCOPES);
  none = await apiClient([]);
  const list = await call("GET", "/employees?limit=1", { token: all.token });
  ids.employee = String((list.body as { data: { id: number }[] }).data[0].id);
  await call("POST", "/webhook-subscriptions", { token: all.token, body: { url: "https://erp.test/contract" } });
});

describe("every endpoint", () => {
  const gets = ENDPOINTS.filter((e) => e.method === "GET");

  it("that takes parameters has a sample path here", () => {
    const missing = gets.filter((e) => e.path.includes("{") && !SAMPLE_PATHS[e.path]).map((e) => e.path);
    expect(missing).toEqual([]);
  });

  for (const e of gets) {
    it(`GET ${e.path} answers what its schema says`, async () => {
      const res = await call("GET", sampleGet(e), { token: all.token });
      expect(res.status, JSON.stringify(res.body)).toBe(e.status ?? 200);
      if (e.produces) {
        expect(res.headers.get("content-type")).toBe(e.produces);
        expect(Buffer.from(res.bytes!.slice(0, 5)).toString()).toBe("%PDF-");
        return;
      }
      const parsed = e.response.safeParse(res.body);
      expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues.slice(0, 5))).toBe(true);
    });
  }

  it("documents examples that pass its own validation", () => {
    const wrong: string[] = [];
    for (const e of ENDPOINTS) {
      const pattern = new RegExp(`^${e.path.replace(/\{\w+\}/g, "[^/]+")}$`);
      if (e.example?.path && !pattern.test(e.example.path)) wrong.push(`${e.method} ${e.path}: example path ${e.example.path}`);
      if (e.example?.body !== undefined && e.body && !e.body.safeParse(e.example.body).success) wrong.push(`${e.method} ${e.path}: example body`);
      if (e.example?.query && e.query && !e.query.safeParse(Object.fromEntries(new URLSearchParams(e.example.query))).success) {
        wrong.push(`${e.method} ${e.path}: example query`);
      }
      if (e.example?.response !== undefined && !e.response.safeParse(e.example.response).success) wrong.push(`${e.method} ${e.path}: example response`);
    }
    expect(wrong).toEqual([]);
  });

  it("but the public ones refuses a call without a token", async () => {
    const wrong: string[] = [];
    for (const e of ENDPOINTS.filter((x) => !x.public)) {
      const res = await call(e.method, concrete(e), { body: e.body ? {} : undefined });
      const body = res.body as { code?: string };
      if (res.status !== 401 || body.code !== "invalid_token" || !res.headers.get("www-authenticate")) wrong.push(`${e.method} ${e.path}: ${res.status}`);
    }
    expect(wrong).toEqual([]);
  });

  it("refuses a token without the scopes it needs", async () => {
    const wrong: string[] = [];
    for (const e of ENDPOINTS.filter((x) => !x.public && x.scopes.length > 0)) {
      const res = await call(e.method, concrete(e), { token: none.token, body: e.body ? {} : undefined });
      if (res.status !== 403 || (res.body as { code?: string }).code !== "insufficient_scope") wrong.push(`${e.method} ${e.path}: ${res.status}`);
    }
    expect(wrong).toEqual([]);
  });
});

describe("the OpenAPI document", () => {
  it("lists every endpoint, and every reference in it resolves", async () => {
    const spec = (await call("GET", "/openapi.json")).body as {
      openapi: string;
      paths: Record<string, Record<string, { operationId: string }>>;
      components: { schemas: Record<string, unknown>; securitySchemes: Record<string, unknown> };
    };
    expect(spec.openapi).toMatch(/^3\.1/);
    for (const e of ENDPOINTS) expect(spec.paths[e.path]?.[e.method.toLowerCase()], `${e.method} ${e.path}`).toBeDefined();
    const operationIds = Object.values(spec.paths).flatMap((p) => Object.values(p).map((o) => o.operationId));
    expect(new Set(operationIds).size).toBe(operationIds.length);
    const text = JSON.stringify(spec);
    expect(text).not.toContain("$defs");
    const refs = [...new Set([...text.matchAll(/"\$ref":"([^"]+)"/g)].map((m) => m[1]))];
    const dangling = refs.filter((r) => !r.startsWith("#/components/") || !(r.split("/").pop()! in { ...spec.components.schemas, ...spec.components.securitySchemes }));
    expect(dangling).toEqual([]);
    expect(spec.components.securitySchemes).toHaveProperty("clientCredentials");
  });
});

describe("tokens", () => {
  it("are issued for form, JSON and Basic credentials alike", async () => {
    const c = await apiClient(["employees:read"]);
    const form = await call("POST", "/oauth/token", { form: true, body: { grant_type: "client_credentials", client_id: c.clientId, client_secret: c.secret } });
    const basic = await call("POST", "/oauth/token", {
      form: true,
      body: { grant_type: "client_credentials" },
      headers: { authorization: `Basic ${Buffer.from(`${c.clientId}:${c.secret}`).toString("base64")}` },
    });
    expect(form.status).toBe(200);
    expect(basic.status).toBe(200);
    expect(form.headers.get("cache-control")).toBe("no-store");
  });

  it("are refused for a wrong secret, and a garbled token is refused", async () => {
    const c = await apiClient(["employees:read"]);
    const wrong = await call("POST", "/oauth/token", { body: { grant_type: "client_credentials", client_id: c.clientId, client_secret: "hs_wrong" } });
    expect(wrong.status).toBe(401);
    expect((wrong.body as { code: string }).code).toBe("invalid_client");
    expect((await call("GET", "/employees", { token: "not-a-token" })).status).toBe(401);
  });

  it("carry fewer scopes when asked, never more", async () => {
    const c = await apiClient(["employees:read", "org:read"]);
    const narrowed = await call("POST", "/oauth/token", {
      body: { grant_type: "client_credentials", client_id: c.clientId, client_secret: c.secret, scope: "org:read pay:read" },
    });
    expect((narrowed.body as { scope: string }).scope).toBe("org:read");
    const token = (narrowed.body as { access_token: string }).access_token;
    expect((await call("GET", "/employees", { token })).status).toBe(403);
  });

  it("stop working when the client is suspended or loses a scope", async () => {
    const c = await apiClient(["employees:read", "org:read"]);
    await rawClient().execute({ sql: "UPDATE int_client SET scopes = 'org:read' WHERE id = ?", args: [c.pk] });
    expect((await call("GET", "/employees", { token: c.token })).status).toBe(403);
    expect((await call("GET", "/companies", { token: c.token })).status).toBe(200);
    await rawClient().execute({ sql: "UPDATE int_client SET status = 'suspended' WHERE id = ?", args: [c.pk] });
    expect((await call("GET", "/companies", { token: c.token })).status).toBe(401);
  });

  it("survive a secret rotation until the old secret is revoked", async () => {
    const c = await apiClient(["org:read"]);
    const take = (secret: string) => call("POST", "/oauth/token", { body: { grant_type: "client_credentials", client_id: c.clientId, client_secret: secret } });
    const fresh = await rotateSecret(c.pk);
    expect((await take(c.secret)).status).toBe(200);
    expect((await take(fresh)).status).toBe(200);
    await revokeOlderSecrets(c.pk);
    expect((await take(c.secret)).status).toBe(401);
    expect((await take(fresh)).status).toBe(200);
  });
});

describe("guards", () => {
  it("refuse addresses outside a client's allowlist", async () => {
    const c = await apiClient(["org:read"]);
    await rawClient().execute({ sql: "UPDATE int_client SET allowed_ips = '10.0.0.1' WHERE id = ?", args: [c.pk] });
    const from = (ip: string) => call("GET", "/companies", { token: c.token, headers: { "x-forwarded-for": ip } });
    expect((await from("10.0.0.1")).status).toBe(200);
    const refused = await from("10.0.0.2");
    expect(refused.status).toBe(403);
    expect((refused.body as { code: string }).code).toBe("forbidden_ip");
  });

  it("rate-limit each client, and say when to come back", async () => {
    const c = await apiClient(["org:read"]);
    await rawClient().execute({ sql: "UPDATE int_client SET rate_limit = 2 WHERE id = ?", args: [c.pk] });
    const first = await call("GET", "/companies", { token: c.token });
    expect(first.headers.get("ratelimit-limit")).toBe("2");
    expect(first.headers.get("ratelimit-remaining")).toBe("1");
    await call("GET", "/companies", { token: c.token });
    const third = await call("GET", "/companies", { token: c.token });
    expect(third.status).toBe(429);
    expect(third.headers.get("retry-after")).toBe("60");
  });

  it("keep each client to its companies", async () => {
    const c = await apiClient(["employees:read"], { companies: ["CO99"] });
    const list = await call("GET", "/employees", { token: c.token });
    expect((list.body as { data: unknown[] }).data).toEqual([]);
    expect((await call("GET", `/employees/${ids.employee}`, { token: all.token })).status).toBe(200);
    expect((await call("GET", `/employees/${ids.employee}`, { token: c.token })).status).toBe(404);
  });
});

describe("errors", () => {
  it("are problem documents with a documented code and the request id", async () => {
    const res = await call("GET", "/nothing-here", { token: all.token });
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toBe("application/problem+json");
    const body = res.body as { type: string; code: string; status: number; request_id: string; title: string };
    expect(body).toMatchObject({ status: 404, code: "not_found" });
    expect(body.type).toBe("http://localhost/developers/errors#not_found");
    expect(body.request_id).toBe(res.headers.get("x-request-id"));
    expect(Object.keys(PROBLEM_TYPES)).toContain(body.code);
  });

  it("name the methods a path does allow", async () => {
    const res = await call("DELETE", "/employees", { token: all.token });
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toContain("GET");
  });

  it("say which field failed validation", async () => {
    const res = await call("POST", "/webhook-subscriptions", { token: all.token, body: { url: "not a url" } });
    expect(res.status).toBe(422);
    const body = res.body as { code: string; errors: { path: string }[] };
    expect(body.code).toBe("validation_failed");
    expect(body.errors.map((e) => e.path)).toContain("url");
    const query = await call("GET", "/employees?limit=100000", { token: all.token });
    expect(query.status).toBe(400);
  });
});

describe("idempotency", () => {
  it("returns the first answer to a retry, and refuses the key for another request", async () => {
    const key = randomUUID();
    const send = (url: string) => call("POST", "/webhook-subscriptions", { token: all.token, body: { url }, headers: { "Idempotency-Key": key } });
    const first = await send("https://erp.test/idem");
    const again = await send("https://erp.test/idem");
    expect(first.status).toBe(201);
    expect(again.status).toBe(201);
    expect((again.body as { id: number }).id).toBe((first.body as { id: number }).id);
    expect(again.headers.get("idempotent-replayed")).toBe("true");
    const other = await send("https://erp.test/other");
    expect(other.status).toBe(422);
    expect((other.body as { code: string }).code).toBe("idempotency_key_reused");
    const made = await rawClient().execute({ sql: "SELECT COUNT(*) AS n FROM int_webhook WHERE url = 'https://erp.test/idem'", args: [] });
    expect(Number(made.rows[0].n)).toBe(1);
  });
});
