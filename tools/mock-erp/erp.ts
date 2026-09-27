import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * A stand-in for the client's ERP, written the way their developers would
 * write the real thing from API.md alone: it takes a token, keeps a copy of
 * the employees in step, receives signed webhooks, and sends back what it
 * booked and paid. The scenario (scenario.ts) drives it; run.ts points it at
 * a running HRMS, and the test suite runs it in-process.
 *
 * Plain module, no Next.js or database imports, so it runs anywhere.
 */

export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

export type ApiResponse<T = unknown> = { status: number; body: T; headers: Headers };

export type Problem = { type: string; title: string; status: number; detail?: string; code: string; errors?: unknown[] };

/** One system's connection: its credentials, and a token taken when needed. */
export class ApiSession {
  readonly baseUrl: string;
  readonly clientId: string;
  private readonly secret: string;
  private readonly fetcher: Fetcher;
  private token: string | null = null;
  private expiresAt = 0;
  scope = "";

  constructor(opts: { baseUrl: string; clientId: string; secret: string; fetch?: Fetcher }) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, "");
    this.clientId = opts.clientId;
    this.secret = opts.secret;
    this.fetcher = opts.fetch ?? ((url, init) => fetch(url, init));
  }

  /** Client credentials, form-encoded as OAuth 2 asks. */
  async takeToken(): Promise<ApiResponse<{ access_token?: string; expires_in?: number; scope?: string } & Partial<Problem>>> {
    const res = await this.fetcher(`${this.baseUrl}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "client_credentials", client_id: this.clientId, client_secret: this.secret }).toString(),
    });
    const body = await res.json();
    if (res.status === 200) {
      this.token = body.access_token;
      this.expiresAt = Date.now() + (body.expires_in - 60) * 1000;
      this.scope = body.scope;
    }
    return { status: res.status, body, headers: res.headers };
  }

  /** A call with a fresh token; one retry if the token was refused. */
  async request<T = unknown>(
    method: string,
    path: string,
    opts: { body?: unknown; headers?: Record<string, string> } = {},
  ): Promise<ApiResponse<T>> {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (!this.token || Date.now() >= this.expiresAt) {
        const t = await this.takeToken();
        if (t.status !== 200) throw new Error(`${this.clientId} could not take a token: ${JSON.stringify(t.body)}`);
      }
      const headers: Record<string, string> = { authorization: `Bearer ${this.token}`, ...(opts.headers ?? {}) };
      if (opts.body !== undefined) headers["content-type"] = "application/json";
      const res = await this.fetcher(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      });
      const text = await res.text();
      const body = (text ? JSON.parse(text) : null) as T;
      if (res.status === 401 && attempt === 0) {
        this.token = null;
        continue;
      }
      return { status: res.status, body, headers: res.headers };
    }
    throw new Error("unreachable");
  }

  get<T = unknown>(path: string) {
    return this.request<T>("GET", path);
  }
}

/* -------------------------------------------------------- webhooks */

/**
 * Standard Webhooks verification: HMAC-SHA256 of "id.timestamp.body" with
 * the secret's bytes, any of the listed signatures matching, and the
 * timestamp within five minutes so a captured request cannot be replayed.
 */
export function verifyWebhook(
  secret: string,
  headers: Record<string, string | undefined>,
  body: string,
  now = Date.now(),
): { ok: true } | { ok: false; reason: string } {
  const id = headers["webhook-id"];
  const timestamp = headers["webhook-timestamp"];
  const signatures = headers["webhook-signature"];
  if (!id || !timestamp || !signatures) return { ok: false, reason: "missing webhook headers" };
  if (Math.abs(now / 1000 - Number(timestamp)) > 300) return { ok: false, reason: "timestamp outside tolerance" };
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = Buffer.from(createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64"));
  const matched = signatures.split(" ").some((s) => {
    const [version, sig] = s.split(",");
    const given = Buffer.from(sig ?? "");
    return version === "v1" && given.length === expected.length && timingSafeEqual(given, expected);
  });
  return matched ? { ok: true } : { ok: false, reason: "signature does not match" };
}

export type CloudEvent = {
  specversion: string;
  id: string;
  type: string;
  source: string;
  subject: string;
  time: string;
  sequence: string;
  originclient?: string | null;
  data: Record<string, unknown>;
};

export type Employee = {
  id: number;
  employee_number: string;
  status: string;
  personal: { first_name: string; last_name: string } | null;
  external_ids: Record<string, string>;
  updated_at: string;
  basic_pay?: unknown;
  bank_account?: unknown;
};

type Page<T> = { data: T[]; next_cursor: string | null };

/** The ERP: its connection, its copy of the employees, what it was told. */
export class MockErp {
  readonly session: ApiSession;
  webhookSecret: string | null = null;
  readonly employees = new Map<number, Employee>();
  readonly received: CloudEvent[] = [];
  readonly refused: string[] = [];
  /** Answers the next N webhooks with 500, as an ERP having a bad minute would. */
  failNext = 0;
  private seen = new Set<string>();
  lastSync: string | null = null;
  feedAfter = 0;

  constructor(session: ApiSession) {
    this.session = session;
  }

  /** The webhook endpoint: verify, drop duplicates, keep the event. */
  receive(req: { headers: Record<string, string | undefined>; body: string }): number {
    if (!this.webhookSecret) return 404;
    const verified = verifyWebhook(this.webhookSecret, req.headers, req.body);
    if (!verified.ok) {
      this.refused.push(verified.reason);
      return 401;
    }
    if (this.failNext > 0) {
      this.failNext -= 1;
      return 500;
    }
    const id = req.headers["webhook-id"] as string;
    if (this.seen.has(id)) return 200; // delivered twice: acknowledge, do nothing
    this.seen.add(id);
    this.received.push(JSON.parse(req.body) as CloudEvent);
    return 200;
  }

  /** Every page of a list. */
  async all<T>(path: string): Promise<T[]> {
    const out: T[] = [];
    let cursor: string | null = null;
    do {
      const sep = path.includes("?") ? "&" : "?";
      const res: ApiResponse<Page<T>> = await this.session.get<Page<T>>(`${path}${cursor ? `${sep}cursor=${cursor}` : ""}`);
      if (res.status !== 200) throw new Error(`${path} answered ${res.status}: ${JSON.stringify(res.body)}`);
      out.push(...res.body.data);
      cursor = res.body.next_cursor;
    } while (cursor);
    return out;
  }

  /**
   * Keeps the copy in step: everything the first time, then only what
   * changed since the last sync, dropping what was deleted.
   */
  async sync(pageSize = 25): Promise<{ changed: number; deleted: number }> {
    const started = new Date(Date.now() - 5_000).toISOString();
    const changed = await this.all<Employee>(
      `/employees?limit=${pageSize}${this.lastSync ? `&updated_since=${encodeURIComponent(this.lastSync)}` : ""}`,
    );
    for (const e of changed) this.employees.set(e.id, e);
    let deleted = 0;
    if (this.lastSync) {
      const gone = await this.all<{ resource: string; employee_id: number | null }>(`/deletions?since=${encodeURIComponent(this.lastSync)}`);
      deleted = gone.length;
    }
    this.lastSync = started;
    return { changed: changed.length, deleted };
  }

  /** The feed after a sequence number, to its end. */
  async feed(after: number, opts: { includeOwn?: boolean } = {}): Promise<{ events: CloudEvent[]; nextAfter: number }> {
    const events: CloudEvent[] = [];
    let cursor = after;
    for (;;) {
      const res = await this.session.get<{ data: CloudEvent[]; next_after: number }>(
        `/events?after=${cursor}&limit=200${opts.includeOwn ? "&include_own=true" : ""}`,
      );
      if (res.status !== 200) throw new Error(`/events answered ${res.status}`);
      events.push(...res.body.data);
      if (res.body.next_after === cursor) break;
      cursor = res.body.next_after;
    }
    return { events, nextAfter: cursor };
  }

  /** Reads the pull feed from where it left off. */
  async pull(): Promise<CloudEvent[]> {
    const { events, nextAfter } = await this.feed(this.feedAfter);
    this.feedAfter = nextAfter;
    return events;
  }
}
