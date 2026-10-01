import { requirePage } from "@/lib/access";
import { desc } from "drizzle-orm";
import { db, rawClient } from "@/lib/db";
import { pmAppraisalCycle } from "@/db/schema";
import { listEmployees, fullName } from "@/lib/repositories/employees";
import { peerFeedbackSummary } from "@/lib/performance";
import { Card, CardHeader, Table, Th, Tr, Td, Status, EmptyState, PageHeader } from "@/components/ui";
import { PerformanceTabs } from "../tabs";
import { RequestFeedbackForm } from "./form";

const TONE: Record<string, "waiting" | "done" | "neutral"> = { Requested: "waiting", Submitted: "done", Declined: "neutral" };

/** PM-06 — 360 feedback: who is asked about whom, and what the aggregate says once it is safe to show. */
export default async function FeedbackPage() {
  await requirePage(["performance.manage", "performance.rate_any", "performance.rate_team"], "/performance/mine");

  const [cycles, employees, requests] = await Promise.all([
    db.select().from(pmAppraisalCycle).orderBy(desc(pmAppraisalCycle.startDate)),
    listEmployees(),
    rawClient().execute(
      `SELECT r.id, r.cycle_id, r.relationship, r.status, c.name AS cycle_name,
              rv.id AS reviewee_id, rr.id AS reviewer_id,
              TRIM(COALESCE(pv.first_name,'')||' '||COALESCE(pv.last_name,'')) AS reviewee_name,
              TRIM(COALESCE(pr.first_name,'')||' '||COALESCE(pr.last_name,'')) AS reviewer_name
       FROM pm_feedback_request r
       JOIN pm_appraisal_cycle c ON c.id = r.cycle_id
       JOIN pa_employee rv ON rv.id = r.reviewee_employee_id
       JOIN pa_employee rr ON rr.id = r.reviewer_employee_id
       LEFT JOIN pa_it0002_personal_data pv ON pv.employee_id = rv.id AND pv.valid_from <= date('now') AND pv.valid_to >= date('now')
       LEFT JOIN pa_it0002_personal_data pr ON pr.employee_id = rr.id AND pr.valid_from <= date('now') AND pr.valid_to >= date('now')
       ORDER BY r.id DESC`,
    ),
  ]);

  const revieweeCycles = new Map<string, { revieweeId: number; cycleId: number; name: string; cycleName: string }>();
  for (const r of requests.rows) {
    const key = `${r.reviewee_id}:${r.cycle_id}`;
    if (!revieweeCycles.has(key)) revieweeCycles.set(key, { revieweeId: Number(r.reviewee_id), cycleId: Number(r.cycle_id), name: String(r.reviewee_name), cycleName: String(r.cycle_name) });
  }
  const summaries = await Promise.all([...revieweeCycles.values()].map(async (rc) => ({ ...rc, summary: await peerFeedbackSummary(rc.revieweeId, rc.cycleId) })));

  return (
    <>
      <PerformanceTabs />
      <PageHeader title="360 feedback" subtitle="Ask peers, managers and reports for feedback on someone, for one cycle. Peer feedback is shown in aggregate once three people have answered." />

      <Card>
        <CardHeader title="Ask for feedback" />
        <div className="px-6 pb-6">
          <RequestFeedbackForm cycles={cycles.map((c) => ({ id: c.id, label: c.name }))} employees={employees.map((e) => ({ id: e.id, label: `${e.employee_number} — ${fullName(e)}` }))} />
        </div>
      </Card>

      <div className="mt-6">
        <Card>
          <CardHeader title="Requests" />
          {requests.rows.length === 0 ? (
            <EmptyState title="No requests yet">Ask for feedback above.</EmptyState>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>About</Th>
                  <Th>Asked</Th>
                  <Th>Relationship</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {requests.rows.map((r) => (
                  <Tr key={String(r.id)}>
                    <Td>
                      <span className="font-medium text-ink">{String(r.reviewee_name)}</span>
                      <span className="text-muted"> · {String(r.cycle_name)}</span>
                    </Td>
                    <Td>
                      <span className="text-secondary">{String(r.reviewer_name)}</span>
                    </Td>
                    <Td>{String(r.relationship)}</Td>
                    <Td>
                      <Status tone={TONE[String(r.status)] ?? "neutral"}>{String(r.status)}</Status>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>

      {summaries.length > 0 ? (
        <div className="mt-6 flex flex-col gap-6">
          {summaries.map((s) => (
            <Card key={`${s.revieweeId}:${s.cycleId}`}>
              <CardHeader title={`${s.name} — ${s.cycleName}`} />
              <div className="px-6 pb-5">
                <h3 className="mb-2 text-[13px] font-semibold text-ink">Peer feedback (aggregate)</h3>
                {s.summary.peerAverageByCompetency ? (
                  <dl className="mb-4 flex flex-wrap gap-x-8 gap-y-2">
                    {Object.entries(s.summary.peerAverageByCompetency).map(([c, avg]) => (
                      <div key={c}>
                        <dt className="text-xs text-muted">{c}</dt>
                        <dd className="text-[15px] font-medium text-ink">{avg} of 5</dd>
                      </div>
                    ))}
                  </dl>
                ) : (
                  <p className="mb-4 text-[13px] text-muted">
                    Hidden until three peers have answered ({s.summary.peerResponseCount} so far).
                  </p>
                )}
                {s.summary.individual.length > 0 ? (
                  <>
                    <h3 className="mb-2 text-[13px] font-semibold text-ink">Manager, report and self feedback</h3>
                    <ul className="flex flex-col gap-1.5 text-[13px] text-ink-hover">
                      {s.summary.individual.map((f, i) => (
                        <li key={i}>
                          {f.relationship} · {f.competency}: {f.rating ?? "—"} of 5{f.comments ? ` — ${f.comments}` : ""}
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}
              </div>
            </Card>
          ))}
        </div>
      ) : null}
    </>
  );
}
