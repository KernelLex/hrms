import { notFound } from "next/navigation";
import { FileText } from "lucide-react";
import { can, requirePage } from "@/lib/access";
import { getOutboxMessage } from "@/lib/email";
import { formatTimestamp } from "@/lib/dates";
import { Card, CardHeader, KeyValue, KeyValueRow, PageHeader } from "@/components/ui";

const STATUS: Record<string, string> = {
  queued: "Waiting to be sent",
  sending: "Sending",
  sent: "Sent",
  recorded: "Recorded, not sent: no email provider is connected",
  failed: "Failed",
};

/**
 * One email as its recipient would see it. The HTML is shown in a sandboxed
 * frame with scripts off, so a message can never run anything in HR's
 * browser; the plain-text version sits beside it.
 */
export default async function OutboxMessagePage(props: { params: Promise<{ id: string }> }) {
  const session = await requirePage(["audit.view"], "/");

  const id = Number((await props.params).id);
  if (!Number.isInteger(id)) notFound();
  const message = await getOutboxMessage(id);
  if (!message) notFound();

  return (
    <>
      <PageHeader back={{ href: "/outbox", label: "Outbox" }} title={message.subject} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card className="overflow-hidden">
          <CardHeader title="As it would arrive" />
          {message.bodyHtml ? (
            <iframe
              title="Email preview"
              sandbox=""
              srcDoc={message.bodyHtml}
              className="h-[420px] w-full border-t border-line bg-canvas"
            />
          ) : (
            <pre className="border-t border-line px-6 py-5 text-sm whitespace-pre-wrap text-ink">
              {message.bodyText}
            </pre>
          )}
        </Card>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader title="Details" />
            <div className="px-6 pb-3">
              <KeyValue>
                <KeyValueRow label="To">{message.recipient}</KeyValueRow>
                <KeyValueRow label="Status">{STATUS[message.status] ?? message.status}</KeyValueRow>
                <KeyValueRow label="Written">{formatTimestamp(message.createdAt)}</KeyValueRow>
                <KeyValueRow label="Attempts">{message.attempts}</KeyValueRow>
                {message.sentAt ? (
                  <KeyValueRow label="Handled">{formatTimestamp(message.sentAt)}</KeyValueRow>
                ) : null}
                {message.lastError ? (
                  <KeyValueRow label="Last error">{message.lastError}</KeyValueRow>
                ) : null}
              </KeyValue>
            </div>
          </Card>
          {message.attachments.length > 0 ? (
            <Card>
              <CardHeader
                title="Attachments"
                description="Made when the message is sent, never stored. A payslip opens with its employee's password."
              />
              <ul className="px-6 pb-4">
                {message.attachments.map((a, i) => (
                  <li key={i} className="border-b border-soft py-2.5 text-[13px] last:border-0">
                    {can(session, "payroll.view") ? (
                      <a href={`/api/outbox/${message.id}/attachments/${i}`} className="inline-flex items-center gap-1.5 font-medium text-ink hover:underline">
                        <FileText className="size-4" />
                        {a.fileName}
                      </a>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-ink">
                        <FileText className="size-4" />
                        {a.fileName}
                      </span>
                    )}
                    <div className="mt-0.5 text-xs text-muted">
                      {a.protected ? "Password-protected PDF" : "PDF"}
                      {can(session, "payroll.view") ? "" : "; opening it needs the right to see payroll"}
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
          <Card>
            <CardHeader title="Plain text" description="For mail apps that do not show HTML." />
            <pre className="px-6 pb-5 font-sans text-[13px] whitespace-pre-wrap text-secondary">
              {message.bodyText}
            </pre>
          </Card>
        </div>
      </div>
    </>
  );
}
