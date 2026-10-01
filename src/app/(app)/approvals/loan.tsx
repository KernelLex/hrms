import { rawClient } from "@/lib/db";
import type { WaitingRow } from "@/lib/workflow/engine";
import { formatINR } from "@/lib/money";
import { formatDate, formatTimestamp } from "@/lib/dates";
import { ApprovalDecision } from "./decide";

type Detail = {
  loanType: string;
  principalPaise: number;
  emiPaise: number;
  tenureMonths: number;
  startDate: string;
  reason: string | null;
  requestedBy: string;
  requestedAt: string;
};

async function details(rows: WaitingRow[]): Promise<Map<string, Detail>> {
  const ids = rows.map((r) => Number(r.subjectId));
  if (ids.length === 0) return new Map();
  const r = await rawClient().execute({
    sql: `SELECT * FROM py_loan WHERE id IN (${ids.map(() => "?").join(", ")})`,
    args: ids,
  });
  const out = new Map<string, Detail>();
  for (const l of r.rows) {
    out.set(String(l.id), {
      loanType: String(l.loan_type),
      principalPaise: Number(l.principal_paise),
      emiPaise: Number(l.emi_paise),
      tenureMonths: Number(l.tenure_months),
      startDate: String(l.start_date),
      reason: l.reason === null ? null : String(l.reason),
      requestedBy: String(l.requested_by),
      requestedAt: String(l.requested_at),
    });
  }
  return out;
}

/** Loans waiting on a decision, each with its principal, EMI and tenure. */
export async function LoanList({ rows, steps }: { rows: WaitingRow[]; steps: Map<number, string> }) {
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
                  {d.loanType} loan: {formatINR(d.principalPaise)}
                </div>
                <div className="mt-0.5 text-[13px] text-muted">
                  {formatINR(d.emiPaise)} a month over {d.tenureMonths} months, from {formatDate(d.startDate)}
                </div>
                <div className="mt-0.5 text-[13px] text-muted">
                  Asked by {d.requestedBy}, {formatTimestamp(d.requestedAt)}
                  {steps.get(r.id) ? ` · ${steps.get(r.id)}` : ""}
                  {r.onBehalfOfName ? ` · you, for ${r.onBehalfOfName}` : ""}
                </div>
                {d.reason ? <div className="mt-2 text-[13px] text-ink-hover">&ldquo;{d.reason}&rdquo;</div> : null}
              </div>
              <ApprovalDecision requestId={r.id} describe={`${d.loanType} loan of ${formatINR(d.principalPaise)}`} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
