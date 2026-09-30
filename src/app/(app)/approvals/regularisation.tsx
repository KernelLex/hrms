import { rawClient } from "@/lib/db";
import type { WaitingRow } from "@/lib/workflow/engine";
import { formatTimestamp } from "@/lib/dates";
import { ApprovalDecision } from "./decide";

type Detail = {
  date: string;
  claimedIn: string | null;
  claimedOut: string | null;
  reason: string;
  submittedAt: string;
};

async function details(rows: WaitingRow[]): Promise<Map<string, Detail>> {
  const ids = rows.map((r) => Number(r.subjectId));
  if (ids.length === 0) return new Map();
  const r = await rawClient().execute({
    sql: `SELECT id, date, claimed_in, claimed_out, reason, submitted_at FROM pt_regularisation WHERE id IN (${ids.map(() => "?").join(", ")})`,
    args: ids,
  });
  const out = new Map<string, Detail>();
  for (const row of r.rows) {
    out.set(String(row.id), {
      date: String(row.date),
      claimedIn: row.claimed_in === null ? null : String(row.claimed_in),
      claimedOut: row.claimed_out === null ? null : String(row.claimed_out),
      reason: String(row.reason),
      submittedAt: String(row.submitted_at),
    });
  }
  return out;
}

const clock = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "—");

/** Attendance regularisations waiting on a decision — the day, and what the employee claims happened. */
export async function RegularisationList({ rows, steps }: { rows: WaitingRow[]; steps: Map<number, string> }) {
  const all = await details(rows);
  return (
    <ul className="divide-y divide-line">
      {rows.map((r) => {
        const d = all.get(r.subjectId);
        if (!d) return null;
        const who = r.summary.split(":")[0];
        return (
          <li key={r.id} className="px-6 py-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="text-[15px] font-medium text-ink">
                  {who} · {d.date}
                </div>
                <div className="mt-0.5 text-[13px] text-muted">
                  Claims {clock(d.claimedIn)} to {clock(d.claimedOut)}
                  {steps.get(r.id) ? ` · ${steps.get(r.id)}` : ""}
                  {r.onBehalfOfName ? ` · you, for ${r.onBehalfOfName}` : ""}
                </div>
                <div className="mt-0.5 text-[13px] text-muted">Asked {formatTimestamp(d.submittedAt)}</div>
                <div className="mt-2 text-[13px] text-ink-hover">&ldquo;{d.reason}&rdquo;</div>
              </div>
              <ApprovalDecision requestId={r.id} describe={`${who}'s attendance for ${d.date}`} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
