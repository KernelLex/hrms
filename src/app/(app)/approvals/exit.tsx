import { rawClient } from "@/lib/db";
import type { WaitingRow } from "@/lib/workflow/engine";
import { formatDate, formatTimestamp } from "@/lib/dates";
import { ApprovalDecision } from "./decide";

type Detail = {
  exitType: string;
  requestedLastDay: string;
  noticeDays: number;
  reason: string | null;
  requestedBy: string;
  requestedAt: string;
};

async function details(rows: WaitingRow[]): Promise<Map<string, Detail>> {
  const ids = rows.map((r) => Number(r.subjectId));
  if (ids.length === 0) return new Map();
  const r = await rawClient().execute({
    sql: `SELECT * FROM pa_exit WHERE id IN (${ids.map(() => "?").join(", ")})`,
    args: ids,
  });
  const out = new Map<string, Detail>();
  for (const x of r.rows) {
    out.set(String(x.id), {
      exitType: String(x.exit_type),
      requestedLastDay: String(x.requested_last_day),
      noticeDays: Number(x.notice_days),
      reason: x.reason === null ? null : String(x.reason),
      requestedBy: String(x.requested_by),
      requestedAt: String(x.requested_at),
    });
  }
  return out;
}

/** Exits waiting on a decision, each with its last day and notice. */
export async function ExitList({ rows, steps }: { rows: WaitingRow[]; steps: Map<number, string> }) {
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
                  {d.exitType}: last day {formatDate(d.requestedLastDay)}
                </div>
                <div className="mt-0.5 text-[13px] text-muted">{d.noticeDays} days&apos; notice</div>
                <div className="mt-0.5 text-[13px] text-muted">
                  Asked by {d.requestedBy}, {formatTimestamp(d.requestedAt)}
                  {steps.get(r.id) ? ` · ${steps.get(r.id)}` : ""}
                  {r.onBehalfOfName ? ` · you, for ${r.onBehalfOfName}` : ""}
                </div>
                {d.reason ? <div className="mt-2 text-[13px] text-ink-hover">&ldquo;{d.reason}&rdquo;</div> : null}
              </div>
              <ApprovalDecision requestId={r.id} describe={`${d.exitType}, last day ${formatDate(d.requestedLastDay)}`} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
