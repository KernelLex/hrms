import { requirePage } from "@/lib/access";
import { asc, desc, eq } from "drizzle-orm";
import { db, rawClient } from "@/lib/db";
import {
  pmAppraisal,
  pmAppraisalCycle,
  pmGoal,
  pmCalibration,
  RATING_LABELS,
} from "@/db/schema";
import {
  Card,
  CardHeader,
  PageHeader,
  Table,
  Th,
  Tr,
  Td,
  Status,
  EmptyState,
  Notice,
  KeyValue,
  KeyValueRow,
} from "@/components/ui";
import { Target } from "lucide-react";
import { SelfReviewForm, CheckinForm, FeedbackResponseForm } from "./form";
import { formatDate } from "@/lib/dates";

/** Employee self-service: your goals and your self review. */
export default async function MyAppraisalPage() {
  const session = await requirePage(["self.appraisal"]);

  if (!session.employeeId) {
    return (
      <>
        <PageHeader title="My appraisal" subtitle="Your goals and your self review." />
        <Notice>
          This sign-in is not linked to an employee record, so there is no
          appraisal to show.
        </Notice>
      </>
    );
  }

  const employeeId = session.employeeId;

  const appraisals = await db
    .select({
      id: pmAppraisal.id,
      cycleId: pmAppraisal.cycleId,
      selfRating: pmAppraisal.selfRating,
      selfComments: pmAppraisal.selfComments,
      managerRating: pmAppraisal.managerRating,
      managerComments: pmAppraisal.managerComments,
      status: pmAppraisal.status,
      cycleName: pmAppraisalCycle.name,
      cycleStatus: pmAppraisalCycle.status,
      periodLabel: pmAppraisalCycle.periodLabel,
    })
    .from(pmAppraisal)
    .innerJoin(pmAppraisalCycle, eq(pmAppraisalCycle.id, pmAppraisal.cycleId))
    .where(eq(pmAppraisal.employeeId, employeeId))
    .orderBy(desc(pmAppraisalCycle.startDate));

  const current = appraisals[0];

  const goals = current
    ? await db
        .select()
        .from(pmGoal)
        .where(eq(pmGoal.cycleId, current.cycleId))
        .orderBy(asc(pmGoal.id))
    : [];
  const myGoals = goals.filter((g) => g.employeeId === employeeId);

  const checkins =
    myGoals.length > 0
      ? (
          await rawClient().execute({
            sql: `SELECT * FROM pm_goal_checkin WHERE goal_id IN (${myGoals.map(() => "?").join(", ")}) ORDER BY created_at DESC`,
            args: myGoals.map((g) => g.id),
          })
        ).rows
      : [];
  const checkinsByGoal = new Map<number, typeof checkins>();
  for (const c of checkins) {
    const goalId = Number(c.goal_id);
    checkinsByGoal.set(goalId, [...(checkinsByGoal.get(goalId) ?? []), c]);
  }

  const feedbackRequests = (
    await rawClient().execute({
      sql: `SELECT r.id, r.relationship, c.full_name AS reviewee_name
            FROM pm_feedback_request r
            JOIN pa_employee e ON e.id = r.reviewee_employee_id
            LEFT JOIN (SELECT employee_id, TRIM(COALESCE(first_name,'')||' '||COALESCE(last_name,'')) AS full_name FROM pa_it0002_personal_data WHERE valid_from <= date('now') AND valid_to >= date('now')) c ON c.employee_id = r.reviewee_employee_id
            WHERE r.reviewer_employee_id = ? AND r.status = 'Requested'`,
      args: [employeeId],
    })
  ).rows;

  // The calibrated rating is what the employee is finally told.
  const calibration = current
    ? await db.query.pmCalibration.findFirst({
        where: eq(pmCalibration.appraisalId, current.id),
      })
    : undefined;
  const finalRating =
    calibration?.status === "Finalised" ? calibration.calibratedRating : null;

  if (!current) {
    return (
      <>
        <PageHeader title="My appraisal" subtitle="Your goals and your self review." />
        <Card>
          <EmptyState icon={<Target />} title="No appraisal open">
            Your appraisal appears here once HR opens a review cycle.
          </EmptyState>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="My appraisal"
        subtitle={`${current.cycleName}, ${current.periodLabel}.`}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader
              title="My goals"
              description={`${myGoals.reduce((s, g) => s + g.weightagePercent, 0)}% of weighting set`}
            />
            {myGoals.length === 0 ? (
              <EmptyState icon={<Target />} title="No goals set yet">
                Your manager sets these at the start of the cycle.
              </EmptyState>
            ) : (
              <ul>
                {myGoals.map((g) => {
                  const history = checkinsByGoal.get(g.id) ?? [];
                  return (
                    <li key={g.id} className="border-b border-soft px-6 py-4 last:border-0">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="text-[15px] font-medium text-ink">{g.description}</span>
                        <span className="text-[13px] text-muted">
                          {g.category} · {g.weightagePercent}%{g.targetDate ? ` · due ${formatDate(g.targetDate)}` : ""}
                        </span>
                      </div>
                      {history.length > 0 ? (
                        <ul className="mt-2 flex flex-col gap-1.5">
                          {history.map((c) => (
                            <li key={String(c.id)} className="text-[13px] text-ink-hover">
                              <span className="tabular text-muted">{formatDate(String(c.checkin_date))}</span>{" "}
                              <Status tone={c.status === "On track" ? "done" : c.status === "At risk" ? "waiting" : "problem"}>{String(c.status)}</Status>{" "}
                              {String(c.author_type)}: {String(c.comment)}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      <div className="mt-3">
                        <CheckinForm goalId={g.id} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          {feedbackRequests.length > 0 ? (
            <div className="flex flex-col gap-4">
              {feedbackRequests.map((r) => (
                <FeedbackResponseForm key={String(r.id)} id={Number(r.id)} revieweeName={String(r.reviewee_name ?? "them")} />
              ))}
            </div>
          ) : null}

          {current.status === "Pending self review" ? (
            <SelfReviewForm
              id={current.id}
              defaultRating={current.selfRating}
              defaultComments={current.selfComments}
            />
          ) : (
            <Card>
              <CardHeader
                title="My self review"
                description="Submitted. Your manager takes it from here."
              />
              <div className="px-6 pb-4">
                <KeyValue>
                  <KeyValueRow label="My rating">
                    {current.selfRating
                      ? `${current.selfRating} of 5 — ${RATING_LABELS[current.selfRating]}`
                      : null}
                  </KeyValueRow>
                  <KeyValueRow label="My comments">{current.selfComments}</KeyValueRow>
                </KeyValue>
              </div>
            </Card>
          )}
        </div>

        <div className="lg:sticky lg:top-8 lg:self-start">
          <Card>
            <CardHeader title="Where it stands" />
            <div className="px-6 pb-5">
              <Status
                tone={
                  current.status === "Completed"
                    ? "done"
                    : current.status === "Pending manager review"
                      ? "waiting"
                      : "action"
                }
              >
                {current.status}
              </Status>

              <div className="mt-5">
                <div className="text-[13px] text-muted">Final rating</div>
                <div className="tabular mt-1 text-[26px] leading-tight font-semibold tracking-[-0.02em] text-ink">
                  {finalRating ? `${finalRating} of 5` : "—"}
                </div>
                <p className="mt-1 text-[13px] text-muted">
                  {finalRating
                    ? RATING_LABELS[finalRating]
                    : "Shown once calibration is finalised."}
                </p>
              </div>

              {current.managerComments && current.status === "Completed" ? (
                <div className="mt-5 border-t border-line pt-4">
                  <div className="text-[13px] text-muted">Manager comments</div>
                  <p className="mt-1 text-sm text-ink">{current.managerComments}</p>
                </div>
              ) : null}
            </div>
          </Card>
        </div>
      </div>

      {appraisals.length > 1 ? (
        <div className="mt-6">
          <Card>
            <CardHeader title="Previous cycles" />
            <Table>
              <thead>
                <tr>
                  <Th>Cycle</Th>
                  <Th>Self</Th>
                  <Th>Manager</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {appraisals.slice(1).map((a) => (
                  <Tr key={a.id}>
                    <Td>
                      <span className="font-medium text-ink">{a.cycleName}</span>
                    </Td>
                    <Td>{a.selfRating ? `${a.selfRating} of 5` : <span className="text-decor">&mdash;</span>}</Td>
                    <Td>{a.managerRating ? `${a.managerRating} of 5` : <span className="text-decor">&mdash;</span>}</Td>
                    <Td>
                      <Status tone={a.status === "Completed" ? "done" : "neutral"}>
                        {a.status}
                      </Status>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </Card>
        </div>
      ) : null}
    </>
  );
}
