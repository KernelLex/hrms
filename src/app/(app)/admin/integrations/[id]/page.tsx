import { notFound } from "next/navigation";
import { requirePage } from "@/lib/access";
import { rawClient } from "@/lib/db";
import { clientDetail } from "@/lib/repositories/integrations";
import { formatTimestamp } from "@/lib/dates";
import { Card, CardHeader, EmptyState, KeyValue, KeyValueRow, Status, Table, Th, Tr, Td, TwoLine } from "@/components/ui";
import { ClientSettingsForm, DeleteClientButton, ReplayButton, SecretActions, WebhookToggle } from "../forms";

const DELIVERY: Record<string, { label: string; tone: "done" | "waiting" | "problem" | "neutral" }> = {
  sent: { label: "Delivered", tone: "done" },
  queued: { label: "Waiting to retry", tone: "waiting" },
  sending: { label: "Sending", tone: "waiting" },
  failed: { label: "Failed, parked", tone: "problem" },
};

/** One connected system: settings, secrets, webhooks, deliveries and calls. */
export default async function IntegrationPage(props: { params: Promise<{ id: string }> }) {
  await requirePage(["integrations.manage"], "/admin");
  const detail = await clientDetail(Number((await props.params).id));
  if (!detail) notFound();
  const { client, secrets, webhooks, deliveries, requests } = detail;
  const companies = (await rawClient().execute("SELECT code, name FROM om_company ORDER BY code")).rows.map((c) => ({
    code: String(c.code),
    name: String(c.name),
  }));
  const working = secrets.filter((s) => s.working);
  const parked = deliveries.filter((d) => d.status === "failed").length;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="flex min-w-0 flex-col gap-6">
        <ClientSettingsForm client={client} companies={companies} />

        <Card>
          <CardHeader
            title="Webhook deliveries"
            description="The last 50 events sent to this system. A delivery that keeps failing is parked after ten attempts; send it again once the system answers."
            actions={parked > 0 ? <ReplayButton clientPk={client.pk} label={`Send ${parked} again`} /> : undefined}
          />
          {deliveries.length === 0 ? (
            <EmptyState title="Nothing sent yet">Events are sent here once the system subscribes to them.</EmptyState>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Event</Th>
                  <Th>Status</Th>
                  <Th numeric>Attempts</Th>
                  <Th>
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {deliveries.map((d) => {
                  const st = DELIVERY[d.status] ?? { label: d.status, tone: "neutral" as const };
                  return (
                    <Tr key={d.id}>
                      <Td>
                        <TwoLine value={<span className="font-mono text-[13px]">{d.type}</span>} sub={formatTimestamp(d.createdAt)} />
                      </Td>
                      <Td>
                        <TwoLine value={<Status tone={st.tone}>{st.label}</Status>} sub={d.lastError ?? undefined} />
                      </Td>
                      <Td numeric>{d.attempts}</Td>
                      <Td className="text-right">{d.status === "failed" ? <ReplayButton id={d.id} label="Send again" /> : null}</Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Card>

        <Card>
          <CardHeader title="Recent calls" description="The last 50 requests, with the request id the system can quote when something goes wrong." />
          {requests.length === 0 ? (
            <EmptyState title="No calls yet">Calls appear once the system takes a token.</EmptyState>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Call</Th>
                  <Th numeric>Status</Th>
                  <Th numeric>Time</Th>
                  <Th>When</Th>
                </tr>
              </thead>
              <tbody>
                {requests.map((q) => (
                  <Tr key={q.id}>
                    <Td>
                      <TwoLine value={<span className="font-mono text-[13px]">{`${q.method} ${q.route}`}</span>} sub={q.correlationId} />
                    </Td>
                    <Td numeric>{q.status >= 400 ? <span className="text-danger">{q.status}</span> : q.status}</Td>
                    <Td numeric>{q.durationMs} ms</Td>
                    <Td>
                      <span className="tabular whitespace-nowrap text-secondary">{formatTimestamp(q.at)}</span>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>

      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader title={client.name} actions={<DeleteClientButton pk={client.pk} name={client.name} />} />
          <div className="px-6 pb-4">
            <KeyValue>
              <KeyValueRow label="Client id">
                <span className="font-mono text-[13px]">{client.clientId}</span>
              </KeyValueRow>
              <KeyValueRow label="Its ids appear as">{client.systemKey}</KeyValueRow>
              <KeyValueRow label="Connected">{formatTimestamp(client.createdAt)}</KeyValueRow>
              <KeyValueRow label="Last call">{client.lastUsedAt ? formatTimestamp(client.lastUsedAt) : "Never"}</KeyValueRow>
            </KeyValue>
          </div>
        </Card>

        <Card>
          <CardHeader title="Secrets" description={`${working.length} working. Only the last four characters are kept, for reference.`} />
          <ul className="px-6">
            {secrets.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 border-b border-soft py-2.5 last:border-0">
                <span className="font-mono text-[13px] text-ink">…{s.hint}</span>
                <span className="text-xs text-muted">
                  {s.revokedAt
                    ? "Stopped"
                    : s.expiresAt && !s.working
                      ? "Expired"
                      : s.expiresAt
                        ? `Until ${formatTimestamp(s.expiresAt)}`
                        : "Current"}
                </span>
              </li>
            ))}
          </ul>
          <SecretActions pk={client.pk} olderWorking={working.length > 1} />
        </Card>

        <Card>
          <CardHeader title="Webhook subscriptions" description="The system manages these through the API; pause one here if it misbehaves." />
          {webhooks.length === 0 ? (
            <p className="px-6 pb-5 text-[13px] text-muted">None. The system can also read the event feed.</p>
          ) : (
            <ul className="px-6 pb-2">
              {webhooks.map((w) => (
                <li key={w.id} className="flex items-start justify-between gap-3 border-b border-soft py-3 last:border-0">
                  <div className="min-w-0">
                    <div className="break-all text-[13px] text-ink">{w.url}</div>
                    <div className="mt-0.5 text-xs text-muted">
                      {w.types ? w.types.join(", ") : "Every event it may see"}
                      {w.active ? "" : ", paused"}
                    </div>
                  </div>
                  <WebhookToggle id={w.id} active={w.active} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
