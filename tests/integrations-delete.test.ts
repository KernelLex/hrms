import { afterEach, describe, expect, it } from "vitest";
import { rawClient } from "@/lib/db";
import { deleteIntegrationClient } from "@/app/actions/integrations";
import { createApiClient } from "@/lib/api/clients";
import { apiClient, call } from "./support/api";
import { form } from "./support/fixtures";
import { actAs, createPerson } from "./support/people";

/**
 * Deleting a connected system: only one that has never really been used —
 * the same rule `deleteCandidate` and `deleteRequisition` follow for their
 * own "kept for the audit trail" cases.
 */

afterEach(() => actAs(null));

async function hr() {
  const p = await createPerson({ roles: ["HR_ADMIN"], email: false });
  actAs(p.session);
  return p;
}

describe("deleting a connected system", () => {
  it("removes one that has never called the API, with its secrets and webhooks", async () => {
    await hr();
    const created = await createApiClient({ name: "Never used", scopes: ["org:read"], createdBy: "test" });

    expect((await deleteIntegrationClient({}, form({ id: 0 }))).error).toMatch(/no longer registered/);

    const result = await deleteIntegrationClient({}, form({ id: created.pk }));
    expect(result.ok).toBe(true);

    const client = await rawClient().execute({ sql: "SELECT 1 FROM int_client WHERE id = ?", args: [created.pk] });
    expect(client.rows).toHaveLength(0);
    const secrets = await rawClient().execute({ sql: "SELECT 1 FROM int_client_secret WHERE client_pk = ?", args: [created.pk] });
    expect(secrets.rows).toHaveLength(0);

    const logged = await rawClient().execute({
      sql: "SELECT action FROM app_change_log WHERE entity = 'int_client' AND entity_id = ? ORDER BY id DESC LIMIT 1",
      args: [created.clientId],
    });
    expect(String(logged.rows[0].action)).toBe("delete");
  });

  it("refuses one that has called the API, pointing at Suspend instead, and leaves it working", async () => {
    await hr();
    const client = await apiClient(["org:read"]);
    await call("GET", "/companies", { token: client.token }); // one real call, logged

    const result = await deleteIntegrationClient({}, form({ id: client.pk }));
    expect(result.error).toMatch(/Suspend it instead/);

    const still = await rawClient().execute({ sql: "SELECT 1 FROM int_client WHERE id = ?", args: [client.pk] });
    expect(still.rows).toHaveLength(1);
    expect((await call("GET", "/companies", { token: client.token })).status).toBe(200);
  });

  it("needs integrations.manage", async () => {
    const person = await createPerson({ roles: [], email: false });
    actAs(person.session);
    await expect(deleteIntegrationClient({}, form({ id: 1 }))).rejects.toThrow();
  });
});
