import { redirect } from "next/navigation";
import { asc, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  pmAppraisal,
  pmAppraisalCycle,
  pmGoal,
  pmCalibration,
  RATING_LABELS,
} from "@/db/schema";
import { getSession } from "@/lib/auth";
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
import { SelfReviewForm } from "./form";
import { formatDate } from "@/lib/dates";

/** Employee self-service: your goals and your self review. */
export default async function MyAppraisalPage() {
  const session = await getSession();
  if (!session) redirect("/sign-in");

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
              <Table>
                <thead>
                  <tr>
                    <Th>Category</Th>
                    <Th>Goal</Th>
                    <Th numeric>Weightage</Th>
                    <Th>Target</Th>
                  </tr>
                </thead>
                <tbody>
                  {myGoals.map((g) => (
                    <Tr key={g.id}>
                      <Td>
                        <span className="text-secondary">{g.category}</span>
                      </Td>
                      <Td>{g.description}</Td>
                      <Td numeric>{g.weightagePercent}%</Td>
                      <Td>
                        {g.targetDate ? (
                          <span className="tabular text-secondary">{formatDate(g.targetDate)}</span>
                        ) : (
                          <span className="text-decor">&mdash;</span>
                        )}
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>

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
