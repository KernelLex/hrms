import { dispatch } from "@/lib/api";
import { createApiClient } from "@/lib/api/clients";
import type { Scope } from "@/lib/api/scopes";

/**
 * Calls the API in-process, the way an HTTP request would reach it: through
 * the one router, with a real client, secret and token.
 */

export type Call = { status: number; body: unknown; headers: Headers; bytes?: Uint8Array };

export async function call(
  method: string,
  pathAndQuery: string,
  opts: { token?: string; body?: unknown; headers?: Record<string, string>; form?: boolean } = {},
): Promise<Call> {
  const url = `http://localhost/api/v1${pathAndQuery}`;
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  let body: string | undefined;
  if (opts.body !== undefined) {
    if (opts.form) {
      headers["content-type"] = "application/x-www-form-urlencoded";
      body = new URLSearchParams(opts.body as Record<string, string>).toString();
    } else {
      headers["content-type"] = "application/json";
      body = JSON.stringify(opts.body);
    }
  }
  const res = await dispatch(new Request(url, { method, headers, body }), new URL(url).pathname.replace(/^\/api\/v1/, ""));
  if (!/json/.test(res.headers.get("content-type") ?? "json")) {
    return { status: res.status, body: null, headers: res.headers, bytes: new Uint8Array(await res.arrayBuffer()) };
  }
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
}

export type TestClient = { pk: number; clientId: string; secret: string; token: string };

let counter = 0;

/** A registered client with these scopes, and a token for it. */
export async function apiClient(scopes: Scope[], extra: { companies?: string[]; name?: string } = {}): Promise<TestClient> {
  counter += 1;
  const created = await createApiClient({
    name: extra.name ?? `Test client ${counter} ${Date.now() % 100000}`,
    scopes,
    companies: extra.companies ?? null,
    createdBy: "test",
  });
  const token = await call("POST", "/oauth/token", {
    body: { grant_type: "client_credentials", client_id: created.clientId, client_secret: created.secret },
  });
  if (token.status !== 200) throw new Error(`No token: ${JSON.stringify(token.body)}`);
  return { ...created, token: (token.body as { access_token: string }).access_token };
}
