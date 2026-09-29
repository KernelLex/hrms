import { rawClient } from "@/lib/db";
import type { WaitingRow } from "@/lib/workflow/engine";
import { formatINR } from "@/lib/money";
import { formatTimestamp } from "@/lib/dates";
import { ApprovalDecision } from "./decide";

type Detail = {
  orgUnitName: string;
  jobTitle: string;
  title: string;
  grade: string | null;
  budgetPaise: number;
  reason: string | null;
  requestedByName: string;
  requestedAt: string;
};

async function details(rows: WaitingRow[]): Promise<Map<string, Detail>> {
  const ids = rows.map((r) => Number(r.subjectId));
  if (ids.length === 0) return new Map();
  const r = await rawClient().execute({
    sql: `SELECT h.*, ou.name AS org_unit_name, j.title AS job_title FROM om_headcount_request h
          JOIN om_org_unit ou ON ou.code = h.org_unit_code
          JOIN om_job j ON j.code = h.job_code
          WHERE h.id IN (${ids.map(() => "?").join(", ")})`,
    args: ids,
  });
  const out = new Map<string, Detail>();
  for (const h of r.rows) {
    out.set(String(h.id), {
      orgUnitName: String(h.org_unit_name),
      jobTitle: String(h.job_title),
      title: String(h.title),
      grade: h.grade === null ? null : String(h.grade),
      budgetPaise: Number(h.budget_paise),
      reason: h.reason === null ? null : String(h.reason),
      requestedByName: String(h.requested_by_name),
      requestedAt: String(h.requested_at),
    });
  }
  return out;
}

/** Headcount requests waiting on a decision, each with the department, job and budget asked for. */
export async function HeadcountList({ rows, steps }: { rows: WaitingRow[]; steps: Map<number, string> }) {
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
                  {d.title}
                  {d.grade ? ` · ${d.grade}` : ""}
                </div>
                <div className="mt-0.5 text-[13px] text-muted">
                  {d.orgUnitName} · {d.jobTitle} · budgeted at {formatINR(d.budgetPaise)} a month
                </div>
                <div className="mt-0.5 text-[13px] text-muted">
                  Asked by {d.requestedByName}, {formatTimestamp(d.requestedAt)}
                  {steps.get(r.id) ? ` · ${steps.get(r.id)}` : ""}
                  {r.onBehalfOfName ? ` · you, for ${r.onBehalfOfName}` : ""}
                </div>
                {d.reason ? <div className="mt-2 text-[13px] text-ink-hover">&ldquo;{d.reason}&rdquo;</div> : null}
              </div>
              <ApprovalDecision requestId={r.id} describe={`${d.title} in ${d.orgUnitName}, budgeted at ${formatINR(d.budgetPaise)} a month`} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
