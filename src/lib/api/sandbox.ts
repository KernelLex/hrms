import { createHash } from "node:crypto";
import type { Client } from "@libsql/client";
import { ERP_SCOPES, type Scope } from "./scopes";

/**
 * The sandbox's own clients, with credentials known in advance, for the mock
 * ERP, CI and local integration work. Created only when SANDBOX_CLIENT_SECRET
 * is set — never in production, where HR registers clients on the
 * Integrations screen and each secret is shown once.
 *
 * Plain module: the seed runs outside Next.js.
 */

export const SANDBOX_CLIENTS = [
  { clientId: "cl_mock_erp", name: "Mock ERP (sandbox)", suffix: "", scopes: ERP_SCOPES },
  { clientId: "cl_sandbox_hr", name: "Sandbox HR tool", suffix: "-hr", scopes: ["employees:hire", "employees:read", "pay:read"] as Scope[] },
] as const;

export async function seedSandboxClients(client: Client, secret: string): Promise<string[]> {
  const notes: string[] = [];
  const now = new Date().toISOString();
  for (const c of SANDBOX_CLIENTS) {
    await client.execute({
      sql: `INSERT OR IGNORE INTO int_client (client_id, name, system_key, status, scopes, created_by, created_at)
            VALUES (?, ?, 'erp', 'active', ?, 'sandbox', ?)`,
      args: [c.clientId, c.name, c.scopes.join(" "), now],
    });
    const pk = Number((await client.execute({ sql: "SELECT id FROM int_client WHERE client_id = ?", args: [c.clientId] })).rows[0].id);
    const value = `${secret}${c.suffix}`;
    await client.execute({
      sql: `INSERT OR IGNORE INTO int_client_secret (client_pk, secret_hash, hint, created_at) VALUES (?, ?, ?, ?)`,
      args: [pk, createHash("sha256").update(value).digest("hex"), value.slice(-4), now],
    });
    notes.push(`  API client ${c.clientId} (${c.name}), secret from SANDBOX_CLIENT_SECRET${c.suffix ? ` + "${c.suffix}"` : ""}`);
  }
  return notes;
}
