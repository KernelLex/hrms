import Link from "next/link";
import { Plug, Plus } from "lucide-react";
import { requirePage } from "@/lib/access";
import { listClients } from "@/lib/repositories/integrations";
import { formatTimestamp } from "@/lib/dates";
import { ButtonLink, Card, CardHeader, EmptyState, Status, Table, Th, Tr, Td, TwoLine } from "@/components/ui";

/**
 * The systems connected through the API — the client's ERP first — with how
 * much they call, and anything waiting to be delivered to them.
 */
export default async function IntegrationsPage() {
  await requirePage(["integrations.manage"], "/admin");
  const clients = await listClients();
  return (
    <Card>
      <CardHeader
        title="Connected systems"
        description="Each system has its own id and secret, scopes, and optionally companies and addresses. API.md and /developers explain the API to its developers."
        actions={
          <ButtonLink href="/admin/integrations/new" variant="primary" size="sm">
            <Plus />
            Connect a system
          </ButtonLink>
        }
      />
      {clients.length === 0 ? (
        <EmptyState icon={<Plug />} title="Nothing connected yet">
          Connect the ERP to give it a client id and secret. It can then read people, organisation, time and payroll, and receive events.
        </EmptyState>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>System</Th>
              <Th>Status</Th>
              <Th numeric>Calls today</Th>
              <Th>Webhooks</Th>
              <Th>Last call</Th>
            </tr>
          </thead>
          <tbody>
            {clients.map((c) => (
              <Tr key={c.pk}>
                <Td>
                  <Link href={`/admin/integrations/${c.pk}`} className="hover:underline">
                    <TwoLine value={c.name} sub={c.clientId} />
                  </Link>
                </Td>
                <Td>
                  <Status tone={c.status === "active" ? "done" : "neutral"}>{c.status === "active" ? "Active" : "Suspended"}</Status>
                </Td>
                <Td numeric>
                  <TwoLine value={c.requests24h.toLocaleString("en-IN")} sub={c.errors24h ? `${c.errors24h} refused` : undefined} />
                </Td>
                <Td>
                  {c.parked > 0 ? (
                    <Status tone="problem">{c.parked} failed</Status>
                  ) : (
                    <span className="text-secondary">{c.webhooks === 0 ? "None" : `${c.webhooks} active`}</span>
                  )}
                </Td>
                <Td>
                  <span className="tabular text-secondary">{c.lastUsedAt ? formatTimestamp(c.lastUsedAt) : "Never"}</span>
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}
