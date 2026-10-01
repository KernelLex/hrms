import { requirePage } from "@/lib/access";
import { rawClient } from "@/lib/db";
import { listEmployees, fullName } from "@/lib/repositories/employees";
import { formatDate } from "@/lib/dates";
import { Card, CardHeader, PageHeader, Status, EmptyState } from "@/components/ui";
import { Paragraphs } from "@/components/prose";
import { PerformanceTabs } from "../tabs";
import { PipForm, PipCheckinForm, ClosePipForm } from "./form";

const TONE: Record<string, "waiting" | "done" | "problem"> = { Ongoing: "waiting", Passed: "done", Failed: "problem" };

/** PM-08 — improvement plans: goals and dates for someone who is struggling, checked in on, and closed with an outcome. */
export default async function PipPage() {
  await requirePage(["performance.manage"], "/performance/mine");

  const [plans, checkins, employees] = await Promise.all([
    rawClient().execute(
      `SELECT p.*, TRIM(COALESCE(d.first_name,'')||' '||COALESCE(d.last_name,'')) AS employee_name
       FROM pm_pip p
       LEFT JOIN pa_it0002_personal_data d ON d.employee_id = p.employee_id AND d.valid_from <= date('now') AND d.valid_to >= date('now')
       ORDER BY p.id DESC`,
    ),
    rawClient().execute("SELECT * FROM pm_pip_checkin ORDER BY created_at DESC"),
    listEmployees(),
  ]);

  const checkinsByPip = new Map<number, typeof checkins.rows>();
  for (const c of checkins.rows) {
    const pipId = Number(c.pip_id);
    checkinsByPip.set(pipId, [...(checkinsByPip.get(pipId) ?? []), c]);
  }

  return (
    <>
      <PerformanceTabs />
      <PageHeader title="Improvement plans" subtitle="Goals and dates for someone who is struggling, checked in on, and closed with an outcome." />

      <Card>
        <CardHeader title="Open a plan" />
        <div className="px-6 pb-6">
          <PipForm employees={employees.map((e) => ({ id: e.id, label: `${e.employee_number} — ${fullName(e)}` }))} />
        </div>
      </Card>

      <div className="mt-6 flex flex-col gap-6">
        {plans.rows.length === 0 ? (
          <Card>
            <EmptyState title="No plans yet">Open one above.</EmptyState>
          </Card>
        ) : (
          plans.rows.map((p) => (
            <Card key={String(p.id)}>
              <CardHeader
                title={String(p.employee_name) || "—"}
                description={`${formatDate(String(p.start_date))} to ${formatDate(String(p.end_date))}`}
                actions={<Status tone={TONE[String(p.outcome)] ?? "neutral"}>{String(p.outcome)}</Status>}
              />
              <div className="px-6 pb-5">
                <h3 className="mb-1 text-[13px] font-semibold text-ink">Why</h3>
                <Paragraphs text={String(p.reason)} className="mb-3 text-[13px] leading-relaxed text-ink-hover" />
                <h3 className="mb-1 text-[13px] font-semibold text-ink">Goals</h3>
                <Paragraphs text={String(p.goals)} className="mb-4 text-[13px] leading-relaxed text-ink-hover" />

                {(checkinsByPip.get(Number(p.id)) ?? []).length > 0 ? (
                  <>
                    <h3 className="mb-1 text-[13px] font-semibold text-ink">Check-ins</h3>
                    <ul className="mb-4 flex flex-col gap-1">
                      {(checkinsByPip.get(Number(p.id)) ?? []).map((c) => (
                        <li key={String(c.id)} className="text-[13px] text-ink-hover">
                          <span className="tabular text-muted">{formatDate(String(c.created_at).slice(0, 10))}</span> {String(c.note)}
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}

                {p.outcome === "Ongoing" ? (
                  <div className="flex flex-wrap items-end gap-3">
                    <PipCheckinForm pipId={Number(p.id)} />
                    <ClosePipForm id={Number(p.id)} />
                  </div>
                ) : (
                  <p className="text-[13px] text-muted">
                    Closed {formatDate(String(p.closed_at).slice(0, 10))} by {String(p.closed_by)}.
                  </p>
                )}
              </div>
            </Card>
          ))
        )}
      </div>
    </>
  );
}
