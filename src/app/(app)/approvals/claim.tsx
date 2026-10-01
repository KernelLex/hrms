import { FileText } from "lucide-react";
import { rawClient } from "@/lib/db";
import type { WaitingRow } from "@/lib/workflow/engine";
import { formatINR } from "@/lib/money";
import { formatDate, formatTimestamp } from "@/lib/dates";
import { ApprovalDecision } from "./decide";

type Line = { date: string; description: string; amountPaise: number; documentId: number | null; fileName: string | null };
type Detail = {
  categoryName: string;
  claimDate: string;
  totalAmountPaise: number;
  requestedAt: string;
  lines: Line[];
};

async function details(rows: WaitingRow[]): Promise<Map<string, Detail>> {
  const ids = rows.map((r) => Number(r.subjectId));
  if (ids.length === 0) return new Map();
  const [claims, lines] = await rawClient().batch(
    [
      {
        sql: `SELECT c.*, cat.name AS category_name FROM py_claim c JOIN py_claim_category cat ON cat.code = c.category_code
              WHERE c.id IN (${ids.map(() => "?").join(", ")})`,
        args: ids,
      },
      {
        sql: `SELECT cl.claim_id, cl.line_date, cl.description, cl.amount_paise, d.id AS document_id, d.file_name
              FROM py_claim_line cl LEFT JOIN app_document d ON d.owner_type = 'claim_line' AND d.owner_id = cl.id
              WHERE cl.claim_id IN (${ids.map(() => "?").join(", ")})`,
        args: ids,
      },
    ],
    "read",
  );
  const out = new Map<string, Detail>();
  for (const c of claims.rows) {
    out.set(String(c.id), {
      categoryName: String(c.category_name),
      claimDate: String(c.claim_date),
      totalAmountPaise: Number(c.total_amount_paise),
      requestedAt: String(c.requested_at),
      lines: [],
    });
  }
  for (const l of lines.rows) {
    const d = out.get(String(l.claim_id));
    if (!d) continue;
    d.lines.push({
      date: String(l.line_date),
      description: String(l.description),
      amountPaise: Number(l.amount_paise),
      documentId: l.document_id === null ? null : Number(l.document_id),
      fileName: l.file_name === null ? null : String(l.file_name),
    });
  }
  return out;
}

/** Claims waiting on a decision, each line with its own bill beside it. */
export async function ClaimList({ rows, steps }: { rows: WaitingRow[]; steps: Map<number, string> }) {
  const all = await details(rows);
  return (
    <ul className="divide-y divide-line">
      {rows.map((r) => {
        const d = all.get(r.subjectId);
        if (!d) return null;
        return (
          <li key={r.id} className="px-6 py-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="text-[15px] font-medium text-ink">
                  {d.categoryName} claim: {formatINR(d.totalAmountPaise)}
                </div>
                <div className="mt-0.5 text-[13px] text-muted">
                  {formatDate(d.claimDate)} · {d.lines.length} line{d.lines.length === 1 ? "" : "s"} · {formatTimestamp(d.requestedAt)}
                  {steps.get(r.id) ? ` · ${steps.get(r.id)}` : ""}
                  {r.onBehalfOfName ? ` · you, for ${r.onBehalfOfName}` : ""}
                </div>
              </div>
              <ApprovalDecision requestId={r.id} describe={`${d.categoryName} claim of ${formatINR(d.totalAmountPaise)}`} />
            </div>

            <div className="mt-4 overflow-x-auto rounded-xl border border-line">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-[13px] text-muted">
                    <th className="px-4 py-2 font-normal">Date</th>
                    <th className="px-4 py-2 font-normal">What for</th>
                    <th className="px-4 py-2 text-right font-normal">Amount</th>
                    <th className="px-4 py-2 font-normal">Bill</th>
                  </tr>
                </thead>
                <tbody>
                  {d.lines.map((l, i) => (
                    <tr key={i} className="border-b border-soft last:border-0">
                      <td className="px-4 py-2 text-secondary tabular">{formatDate(l.date)}</td>
                      <td className="px-4 py-2 text-ink">{l.description}</td>
                      <td className="px-4 py-2 text-right tabular text-ink">{formatINR(l.amountPaise)}</td>
                      <td className="px-4 py-2">
                        {l.documentId ? (
                          <a href={`/api/documents/${l.documentId}`} className="inline-flex items-center gap-1.5 font-medium text-ink hover:underline">
                            <FileText className="size-4" />
                            {l.fileName}
                          </a>
                        ) : (
                          <span className="text-muted">No bill attached</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
