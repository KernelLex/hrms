import { FileText } from "lucide-react";
import { rawClient } from "@/lib/db";
import type { WaitingRow } from "@/lib/workflow/engine";
import { SECTIONS, describeChange, isSection, maskedAccount, type Section } from "@/lib/corrections-values";
import { formatDate, formatTimestamp } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { ApprovalDecision } from "./decide";

type Detail = {
  section: Section;
  subtype: string | null;
  proposed: Record<string, string | null>;
  current: Record<string, string | null> | null;
  effectiveDate: string;
  note: string | null;
  evidence: { id: number; fileName: string } | null;
  requestedBy: string;
  requestedAt: string;
  channel: string;
};

async function details(rows: WaitingRow[]): Promise<Map<string, Detail>> {
  const ids = rows.map((r) => Number(r.subjectId));
  if (ids.length === 0) return new Map();
  const r = await rawClient().execute({
    sql: `SELECT c.*, d.file_name FROM pa_change_request c
          LEFT JOIN app_document d ON d.id = c.evidence_document_id
          WHERE c.id IN (${ids.map(() => "?").join(", ")})`,
    args: ids,
  });
  const out = new Map<string, Detail>();
  for (const c of r.rows) {
    const section = String(c.section);
    if (!isSection(section)) continue;
    out.set(String(c.id), {
      section,
      subtype: c.subtype === null ? null : String(c.subtype),
      proposed: JSON.parse(String(c.proposed)),
      current: c.current ? JSON.parse(String(c.current)) : null,
      effectiveDate: String(c.effective_date),
      note: c.note === null ? null : String(c.note),
      evidence: c.evidence_document_id ? { id: Number(c.evidence_document_id), fileName: String(c.file_name ?? "Proof") } : null,
      requestedBy: String(c.requested_by_name),
      requestedAt: String(c.requested_at),
      channel: String(c.channel),
    });
  }
  return out;
}

/**
 * Corrections waiting on a decision, each with what is on record beside what
 * is asked for — the changed fields first and marked — and the proof. Account
 * numbers show in full only to someone who may see bank details.
 */
export async function CorrectionList({
  rows,
  steps,
  seeBank,
  seeDocuments,
}: {
  rows: WaitingRow[];
  steps: Map<number, string>;
  seeBank: boolean;
  seeDocuments: boolean;
}) {
  const all = await details(rows);
  const show = (field: string, v: string | null | undefined) => {
    if (v === null || v === undefined || v === "") return "—";
    if (field === "account_number" && !seeBank) return maskedAccount(v);
    if (field === "date_of_birth") return formatDate(v);
    return v;
  };

  return (
    <ul className="divide-y divide-line">
      {rows.map((r) => {
        const d = all.get(r.subjectId);
        const who = r.summary.split(":")[0];
        if (!d) return null;
        const fields = Object.entries(SECTIONS[d.section].fields) as [string, string][];
        const changed = (f: string) => (d.current?.[f] ?? null) !== (d.proposed[f] ?? null);
        const ordered = [...fields.filter(([f]) => changed(f)), ...fields.filter(([f]) => !changed(f))];
        return (
          <li key={r.id} className="px-6 py-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="text-[15px] font-medium text-ink">
                  {who}: {describeChange(d.section, d.subtype).toLowerCase()}
                </div>
                <div className="mt-0.5 text-[13px] text-muted">
                  From {formatDate(d.effectiveDate)} · asked by {d.requestedBy}
                  {d.channel === "api" ? " through a connected system" : ""}, {formatTimestamp(d.requestedAt)}
                  {steps.get(r.id) ? ` · ${steps.get(r.id)}` : ""}
                  {r.onBehalfOfName ? ` · you, for ${r.onBehalfOfName}` : ""}
                </div>
              </div>
              <ApprovalDecision requestId={r.id} describe={`${who}: ${describeChange(d.section, d.subtype).toLowerCase()} from ${formatDate(d.effectiveDate)}`} />
            </div>

            <div className="mt-4 overflow-x-auto rounded-xl border border-line">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-[13px] text-muted">
                    <th className="px-4 py-2 font-normal">
                      <span className="sr-only">Field</span>
                    </th>
                    <th className="px-4 py-2 font-normal">On record</th>
                    <th className="px-4 py-2 font-normal">Asked for</th>
                  </tr>
                </thead>
                <tbody>
                  {ordered.map(([f, label]) => (
                    <tr key={f} className="border-b border-soft last:border-0">
                      <td className="px-4 py-2 text-[13px] text-muted">{label}</td>
                      <td className={cn("px-4 py-2", changed(f) ? "text-secondary" : "text-muted")}>{show(f, d.current?.[f])}</td>
                      <td className={cn("px-4 py-2", changed(f) ? "font-medium text-ink" : "text-muted")}>
                        {show(f, d.proposed[f])}
                        {changed(f) ? <span className="sr-only"> (changed)</span> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {d.note || d.evidence ? (
              <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-1 text-[13px]">
                {d.note ? <span className="text-ink-hover">&ldquo;{d.note}&rdquo;</span> : null}
                {d.evidence ? (
                  seeDocuments ? (
                    <a href={`/api/documents/${d.evidence.id}`} className="inline-flex items-center gap-1.5 font-medium text-ink hover:underline">
                      <FileText className="size-4" />
                      {d.evidence.fileName}
                    </a>
                  ) : (
                    <span className="text-muted">Proof attached; HR checks it.</span>
                  )
                ) : null}
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
