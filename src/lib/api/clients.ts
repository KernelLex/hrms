import "server-only";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { rawClient } from "@/lib/db";
import { readEnv } from "@/lib/env";
import { sha256 } from "./format";
import { parseScopes, type Scope } from "./scopes";

/**
 * API clients: registration, secrets and tokens.
 *
 * OAuth 2.0 client credentials. A client exchanges its id and secret for a
 * bearer token valid for an hour. Secrets are random and long, so a SHA-256
 * of them is safe to store; the secret itself is shown once. Rotating a
 * secret keeps the old one working for a day, so the client can switch over
 * without an outage.
 */

export type ApiClient = {
  pk: number;
  clientId: string;
  name: string;
  systemKey: string;
  status: string;
  scopes: Scope[];
  /** Company codes it may see, or null for every company. */
  companies: string[] | null;
  allowedIps: string[] | null;
  rateLimit: number;
};

export const TOKEN_TTL_SECONDS = 3600;
const ROTATION_OVERLAP_MS = 24 * 3600 * 1000;

function tokenKey(): Uint8Array {
  const secret = readEnv("AUTH_SECRET") ?? "development-only";
  return new TextEncoder().encode(sha256(`hrms-api-token:${secret}`));
}

const list = (v: unknown) =>
  typeof v === "string" && v.trim() ? v.split(",").map((s) => s.trim()).filter(Boolean) : null;

function toClient(row: Record<string, unknown>): ApiClient {
  return {
    pk: Number(row.id),
    clientId: String(row.client_id),
    name: String(row.name),
    systemKey: String(row.system_key),
    status: String(row.status),
    scopes: parseScopes(String(row.scopes ?? "")),
    companies: list(row.companies),
    allowedIps: list(row.allowed_ips),
    rateLimit: Number(row.rate_limit),
  };
}

export async function getClient(pk: number): Promise<ApiClient | null> {
  const r = await rawClient().execute({ sql: "SELECT * FROM int_client WHERE id = ?", args: [pk] });
  return r.rows[0] ? toClient(r.rows[0] as unknown as Record<string, unknown>) : null;
}

export async function getClientById(clientId: string): Promise<ApiClient | null> {
  const r = await rawClient().execute({ sql: "SELECT * FROM int_client WHERE client_id = ?", args: [clientId] });
  return r.rows[0] ? toClient(r.rows[0] as unknown as Record<string, unknown>) : null;
}

const newSecret = () => `hs_${randomBytes(32).toString("base64url")}`;

async function addSecret(clientPk: number, secret: string): Promise<void> {
  await rawClient().execute({
    sql: `INSERT INTO int_client_secret (client_pk, secret_hash, hint, created_at) VALUES (?, ?, ?, ?)`,
    args: [clientPk, sha256(secret), secret.slice(-4), new Date().toISOString()],
  });
}

/** Registers a client. Returns its id and secret; the secret is never shown again. */
export async function createApiClient(input: {
  name: string;
  scopes: Scope[];
  companies?: string[] | null;
  allowedIps?: string[] | null;
  systemKey?: string;
  createdBy: string;
  /** Only for the local sandbox and CI: a fixed id and secret. */
  fixed?: { clientId: string; secret: string };
}): Promise<{ pk: number; clientId: string; secret: string }> {
  const clientId = input.fixed?.clientId ?? `cl_${randomBytes(9).toString("base64url")}`;
  const secret = input.fixed?.secret ?? newSecret();
  const r = await rawClient().execute({
    sql: `INSERT INTO int_client (client_id, name, system_key, status, scopes, companies, allowed_ips, created_by, created_at)
          VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?) RETURNING id`,
    args: [
      clientId,
      input.name,
      input.systemKey ?? "erp",
      input.scopes.join(" "),
      input.companies?.length ? input.companies.join(",") : null,
      input.allowedIps?.length ? input.allowedIps.join(",") : null,
      input.createdBy,
      new Date().toISOString(),
    ],
  });
  const pk = Number(r.rows[0].id);
  await addSecret(pk, secret);
  return { pk, clientId, secret };
}

/** A new secret; the current ones keep working for a day. */
export async function rotateSecret(clientPk: number): Promise<string> {
  const secret = newSecret();
  const expires = new Date(Date.now() + ROTATION_OVERLAP_MS).toISOString();
  await rawClient().execute({
    sql: `UPDATE int_client_secret SET expires_at = ? WHERE client_pk = ? AND revoked_at IS NULL
            AND (expires_at IS NULL OR expires_at > ?)`,
    args: [expires, clientPk, expires],
  });
  await addSecret(clientPk, secret);
  return secret;
}

/** Stops every secret but the newest working now. */
export async function revokeOlderSecrets(clientPk: number): Promise<void> {
  await rawClient().execute({
    sql: `UPDATE int_client_secret SET revoked_at = ?1
          WHERE client_pk = ?2 AND revoked_at IS NULL
            AND id <> (SELECT MAX(id) FROM int_client_secret WHERE client_pk = ?2)`,
    args: [new Date().toISOString(), clientPk],
  });
}

/** The client these credentials belong to, if they are right and the client is active. */
export async function verifyCredentials(clientId: string, secret: string): Promise<ApiClient | null> {
  const client = await getClientById(clientId);
  if (!client || client.status !== "active") return null;
  const now = new Date().toISOString();
  const r = await rawClient().execute({
    sql: `SELECT secret_hash FROM int_client_secret
          WHERE client_pk = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)`,
    args: [client.pk, now],
  });
  const given = Buffer.from(sha256(secret));
  const ok = r.rows.some((row) => {
    const stored = Buffer.from(String(row.secret_hash));
    return stored.length === given.length && timingSafeEqual(stored, given);
  });
  return ok ? client : null;
}

/** A bearer token for these scopes: those asked for and granted, or all granted. */
export async function issueToken(client: ApiClient, requested: Scope[]): Promise<{ token: string; scopes: Scope[] }> {
  const scopes = requested.length ? requested.filter((s) => client.scopes.includes(s)) : client.scopes;
  const token = await new SignJWT({ scope: scopes.join(" ") })
    .setProtectedHeader({ alg: "HS256", typ: "at+jwt" })
    .setSubject(client.clientId)
    .setAudience("hrms-api")
    .setIssuedAt()
    .setExpirationTime(`${TOKEN_TTL_SECONDS}s`)
    .sign(tokenKey());
  return { token, scopes };
}

/**
 * The client a token was issued to and the scopes it carries — narrowed to
 * what the client holds now, so a scope HR removes stops working at once.
 */
export async function verifyToken(token: string): Promise<{ client: ApiClient; scopes: Set<Scope> } | null> {
  try {
    const { payload } = await jwtVerify(token, tokenKey(), { audience: "hrms-api" });
    const client = await getClientById(String(payload.sub));
    if (!client || client.status !== "active") return null;
    const granted = parseScopes(String(payload.scope ?? "")).filter((s) => client.scopes.includes(s));
    return { client, scopes: new Set(granted) };
  } catch {
    return null;
  }
}
