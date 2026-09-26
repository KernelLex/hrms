import Link from "next/link";
import { redirect } from "next/navigation";
import { Mail } from "lucide-react";
import { getSession, hasRole } from "@/lib/auth";
import { listOutbox } from "@/lib/email";
import { formatTimestamp } from "@/lib/dates";
import {
  Card,
  EmptyState,
  Notice,
  PageHeader,
  Status,
  Tab,
  Tabs,
  Table,
  Th,
  Tr,
  Td,
  TwoLine,
  type Tone,
} from "@/components/ui";
import { Pagination, pageFrom } from "@/components/pagination";

/**
 * Every message the system has written, as it would be sent. Until an email
 * provider is connected, messages are recorded here rather than delivered,
 * so what people would receive can be read and checked.
 */

const STATUS: Record<string, { label: string; tone: Tone }> = {
  queued: { label: "Waiting", tone: "waiting" },
  sending: { label: "Sending", tone: "waiting" },
  sent: { label: "Sent", tone: "done" },
  recorded: { label: "Recorded, not sent", tone: "neutral" },
  failed: { label: "Failed", tone: "problem" },
};

const FILTERS = [
  { value: "", label: "All" },
  { value: "queued", label: "Waiting" },
  { value: "recorded", label: "Recorded" },
  { value: "sent", label: "Sent" },
  { value: "failed", label: "Failed" },
];

export default async function OutboxPage(props: {
  searchParams: Promise<{ status?: string; page?: string }>;
}) {
  const session = await getSession();
  if (!hasRole(session, "HR_ADMIN")) redirect("/");

  const params = await props.searchParams;
  const status = FILTERS.some((f) => f.value === params.status) ? params.status : "";
  const { page, limit, offset } = pageFrom(params.page);
  const { rows, total, counts } = await listOutbox({ status: status || undefined, limit, offset });
  const all = Object.values(counts).reduce((a, b) => a + b, 0);

  return (
    <>
      <PageHeader
        title="Outbox"
        subtitle="Every email the system has written, exactly as it would be sent."
      />
      <div className="mb-6">
        <Notice>
          No email provider is connected, so messages are recorded here instead of being
          delivered. Nothing has left the system.
        </Notice>
      </div>

      <Tabs>
        {FILTERS.map((f) => (
          <Tab
            key={f.value}
            href={f.value ? `/outbox?status=${f.value}` : "/outbox"}
            active={status === f.value}
            count={f.value ? (counts[f.value] ?? 0) : all}
          >
            {f.label}
          </Tab>
        ))}
      </Tabs>

      <Card>
        {rows.length === 0 ? (
          <EmptyState icon={<Mail />} title="No messages">
            Emails appear here when someone is told about a leave decision, a payslip or a
            review that is due.
          </EmptyState>
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Message</Th>
                  <Th>To</Th>
                  <Th>Status</Th>
                  <Th>Written</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((m) => {
                  const s = STATUS[m.status] ?? { label: m.status, tone: "neutral" as Tone };
                  return (
                    <Tr key={m.id}>
                      <Td>
                        <Link
                          href={`/outbox/${m.id}`}
                          className="font-medium text-ink underline decoration-decor underline-offset-4 hover:decoration-ink"
                        >
                          {m.subject}
                        </Link>
                      </Td>
                      <Td>
                        <span className="text-secondary">{m.recipient}</span>
                      </Td>
                      <Td>
                        <TwoLine
                          value={<Status tone={s.tone}>{s.label}</Status>}
                          sub={m.lastError ?? undefined}
                        />
                      </Td>
                      <Td>
                        <span className="tabular whitespace-nowrap text-secondary">
                          {formatTimestamp(m.createdAt)}
                        </span>
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
            <Pagination
              page={page}
              total={total}
              path="/outbox"
              params={{ status: status || undefined }}
              noun="messages"
            />
          </>
        )}
      </Card>
    </>
  );
}
