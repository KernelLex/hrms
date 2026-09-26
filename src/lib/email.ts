import "server-only";
import type { InStatement } from "@libsql/client";
import { rawClient } from "@/lib/db";

/**
 * Email: built here, queued in the outbox, delivered by a job.
 *
 * Delivery goes through a transport. Until a provider is chosen and its
 * sending domain verified (HANDOVER.md §9.6, phase 25), the
 * only transport records each message as it would have been sent, so every
 * email in the product can be written, tested and read on the Outbox screen
 * without any account.
 */

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

export type DeliveryResult =
  | { status: "sent"; providerId?: string }
  | { status: "recorded" }
  | { status: "failed"; error: string; retry: boolean };

export interface EmailTransport {
  readonly name: string;
  deliver(message: EmailMessage): Promise<DeliveryResult>;
}

/** Keeps the message; sends nothing. */
export const recordOnlyTransport: EmailTransport = {
  name: "record only",
  async deliver() {
    return { status: "recorded" };
  },
};

let transport: EmailTransport = recordOnlyTransport;

export function emailTransport(): EmailTransport {
  return transport;
}

/** For tests, and for the provider phase 25 adds. */
export function setEmailTransport(next: EmailTransport): void {
  transport = next;
}

/** Where links in an email point: the production address when known. */
export function appUrl(): string {
  const explicit = process.env.APP_URL?.replace(/\/$/, "");
  if (explicit) return explicit;
  const production = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (production) return `https://${production}`;
  return "http://localhost:3000";
}

const escape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * One layout for every email, in the design language: ink on white, one
 * action, no images, readable as plain text.
 */
export function renderEmail(opts: {
  title: string;
  body?: string | null;
  link?: string | null;
  action?: string;
}): { subject: string; text: string; html: string } {
  const url = opts.link ? (opts.link.startsWith("http") ? opts.link : `${appUrl()}${opts.link}`) : null;
  const action = opts.action ?? "Open in HRMS";
  const text = [opts.title, "", opts.body ?? "", url ? `\n${action}: ${url}` : ""].join("\n").trim();
  const html = `<!doctype html><html><body style="margin:0;background:#fafafa;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#171717">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid #ebebeb;border-radius:16px">
<tr><td style="padding:24px 24px 8px"><span style="display:inline-block;width:28px;height:28px;line-height:28px;text-align:center;background:#171717;color:#fff;border-radius:8px;font-weight:600;font-size:13px">H</span>
<span style="margin-left:10px;font-weight:600;font-size:15px">HRMS</span></td></tr>
<tr><td style="padding:8px 24px 0;font-size:17px;font-weight:600">${escape(opts.title)}</td></tr>
${opts.body ? `<tr><td style="padding:8px 24px 0;font-size:14px;line-height:1.5;color:#525252">${escape(opts.body)}</td></tr>` : ""}
${url ? `<tr><td style="padding:20px 24px 24px"><a href="${escape(url)}" style="display:inline-block;background:#171717;color:#fff;text-decoration:none;border-radius:999px;padding:9px 16px;font-size:14px;font-weight:500">${escape(action)}</a></td></tr>` : `<tr><td style="padding:0 0 24px"></td></tr>`}
</table>
<p style="font-size:12px;color:#737373;margin:16px 0 0">You can choose which emails you get in HRMS, under Notifications.</p>
</td></tr></table></body></html>`;
  return { subject: opts.title, text, html };
}

/** The outbox row for one email, to write in the same batch as its cause. */
export function queueEmailStatement(
  dedupeKey: string,
  message: EmailMessage,
  payload: unknown = null,
): InStatement {
  return {
    sql: `INSERT INTO app_outbox (channel, dedupe_key, recipient, subject, body_text, body_html, payload, status, attempts, created_at)
          VALUES ('email', ?, ?, ?, ?, ?, ?, 'queued', 0, ?)
          ON CONFLICT (dedupe_key) DO NOTHING`,
    args: [
      dedupeKey,
      message.to,
      message.subject,
      message.text,
      message.html,
      payload === null ? null : JSON.stringify(payload),
      new Date().toISOString(),
    ],
  };
}

const MAX_ATTEMPTS = 8;

/**
 * Delivers what is due in the outbox, a few at a time. Each message is
 * claimed before it is handed to the transport, so two workers never send
 * the same one. Returns how many were handled.
 */
export async function deliverOutbox(limit = 25): Promise<number> {
  const now = new Date().toISOString();
  // A claim lasts ten minutes; a worker that died mid-send is taken over.
  const claimExpires = new Date(Date.now() + 10 * 60_000).toISOString();
  const claimed = await rawClient().execute({
    sql: `UPDATE app_outbox SET status = 'sending', attempts = attempts + 1, next_attempt_at = ?1
          WHERE id IN (
            SELECT id FROM app_outbox
            WHERE channel = 'email'
              AND ((status = 'queued' AND (next_attempt_at IS NULL OR next_attempt_at <= ?2))
                OR (status = 'sending' AND next_attempt_at <= ?2))
            ORDER BY id LIMIT ?3
          )
          RETURNING id, recipient, subject, body_text, body_html, attempts`,
    args: [claimExpires, now, limit],
  });

  for (const row of claimed.rows) {
    const id = Number(row.id);
    let result: DeliveryResult;
    try {
      result = await transport.deliver({
        to: String(row.recipient),
        subject: String(row.subject ?? ""),
        text: String(row.body_text ?? ""),
        html: String(row.body_html ?? ""),
      });
    } catch (err) {
      result = { status: "failed", error: err instanceof Error ? err.message : String(err), retry: true };
    }

    if (result.status === "failed") {
      const attempts = Number(row.attempts);
      const final = !result.retry || attempts >= MAX_ATTEMPTS;
      await rawClient().execute({
        sql: `UPDATE app_outbox SET status = ?, last_error = ?, next_attempt_at = ? WHERE id = ?`,
        args: [
          final ? "failed" : "queued",
          result.error.slice(0, 1000),
          new Date(Date.now() + Math.min(3_600_000, 60_000 * 2 ** (attempts - 1))).toISOString(),
          id,
        ],
      });
    } else {
      await rawClient().execute({
        sql: `UPDATE app_outbox SET status = ?, sent_at = ?, last_error = NULL WHERE id = ?`,
        args: [result.status, new Date().toISOString(), id],
      });
    }
  }
  return claimed.rows.length;
}

/* ------------------------------------------------------------ outbox screen */

export type OutboxRow = {
  id: number;
  channel: string;
  recipient: string;
  subject: string;
  status: string;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  sentAt: string | null;
};

const outboxRow = (r: Record<string, unknown>): OutboxRow => ({
  id: Number(r.id),
  channel: String(r.channel),
  recipient: String(r.recipient),
  subject: String(r.subject),
  status: String(r.status),
  attempts: Number(r.attempts),
  lastError: r.last_error === null ? null : String(r.last_error),
  createdAt: String(r.created_at),
  sentAt: r.sent_at === null ? null : String(r.sent_at),
});

export async function listOutbox(
  opts: { status?: string; limit?: number; offset?: number } = {},
): Promise<{ rows: OutboxRow[]; total: number; counts: Record<string, number> }> {
  const filter = opts.status ? "WHERE status = ?" : "";
  const args = opts.status ? [opts.status] : [];
  const [page, count, byStatus] = await Promise.all([
    rawClient().execute({
      sql: `SELECT id, channel, recipient, subject, status, attempts, last_error, created_at, sent_at
            FROM app_outbox ${filter} ORDER BY id DESC LIMIT ? OFFSET ?`,
      args: [...args, opts.limit ?? 50, opts.offset ?? 0],
    }),
    rawClient().execute({ sql: `SELECT COUNT(*) AS n FROM app_outbox ${filter}`, args }),
    rawClient().execute("SELECT status, COUNT(*) AS n FROM app_outbox GROUP BY status"),
  ]);
  return {
    rows: page.rows.map((r) => outboxRow(r as unknown as Record<string, unknown>)),
    total: Number(count.rows[0].n),
    counts: Object.fromEntries(byStatus.rows.map((r) => [String(r.status), Number(r.n)])),
  };
}

export async function getOutboxMessage(
  id: number,
): Promise<(OutboxRow & { bodyText: string; bodyHtml: string | null }) | null> {
  const r = await rawClient().execute({ sql: "SELECT * FROM app_outbox WHERE id = ?", args: [id] });
  const row = r.rows[0] as unknown as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    ...outboxRow(row),
    bodyText: String(row.body_text ?? ""),
    bodyHtml: row.body_html === null ? null : String(row.body_html),
  };
}
