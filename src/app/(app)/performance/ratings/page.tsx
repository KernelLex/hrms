import { can, requirePage } from "@/lib/access";
import { desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { pmAppraisal, pmAppraisalCycle, RATING_LABELS } from "@/db/schema";
import {
  listEmployees,
  listDirectReports,
  fullName,
} from "@/lib/repositories/employees";
import {
  Card,
  PageHeader,
  Table,
  Th,
  Tr,
  Td,
  TwoLine,
  Status,
  EmptyState,
  FigureRow,
  Figure,
} from "@/components/ui";
import { ClipboardList } from "lucide-react";
import { PerformanceTabs } from "../tabs";
import { ManagerRatingButton } from "./actions";

/** PM-03 — self and manager ratings. */
export default async function RatingsPage() {
  const session = await requirePage(["performance.rate_any", "performance.rate_team"], "/performance/mine");
  const isHr = can(session, "performance.rate_any");
  const visibleIds = isHr
    ? null
    : session.employeeId
      ? (await listDirectReports(session.employeeId)).map((e) => e.id)
      : [];

  const rows =
    visibleIds !== null && visibleIds.length === 0
      ? []
      : await db
          .select({
            id: pmAppraisal.id,
            employeeId: pmAppraisal.employeeId,
            selfRating: pmAppraisal.selfRating,
            selfComments: pmAppraisal.selfComments,
            managerRating: pmAppraisal.managerRating,
            managerComments: pmAppraisal.managerComments,
            status: pmAppraisal.status,
            cycleName: pmAppraisalCycle.name,
            cycleStatus: pmAppraisalCycle.status,
          })
          .from(pmAppraisal)
          .innerJoin(pmAppraisalCycle, eq(pmAppraisalCycle.id, pmAppraisal.cycleId))
          .where(
            visibleIds === null
              ? undefined
              : inArray(pmAppraisal.employeeId, visibleIds),
          )
          .orderBy(desc(pmAppraisal.updatedAt));

  const employees = await listEmployees();
  const name = new Map(employees.map((e) => [e.id, fullName(e)]));
  const numberOf = new Map(employees.map((e) => [e.id, e.employee_number]));

  const awaitingSelf = rows.filter((r) => r.status === "Pending self review").length;
  const awaitingManager = rows.filter((r) => r.status === "Pending manager review").length;
  const completed = rows.filter((r) => r.status === "Completed").length;

  return (
    <>
      <PerformanceTabs />
      <PageHeader
        title="Ratings"
        subtitle={
          isHr
            ? "Every appraisal in flight. A manager rating can only be recorded once the self review is in."
            : "Appraisals for the people who report to you."
        }
      />

      {rows.length > 0 ? (
        <FigureRow>
          <Figure label="Awaiting self review" value={awaitingSelf} hint="with the employee" />
          <Figure label="Awaiting manager" value={awaitingManager} hint="with you" />
          <Figure label="Completed" value={completed} hint="ready to calibrate" />
          <Figure label="Total" value={rows.length} hint="in flight" />
        </FigureRow>
      ) : null}

      <div className={rows.length > 0 ? "mt-6" : ""}>
        <Card>
          {rows.length === 0 ? (
            <EmptyState icon={<ClipboardList />} title="No appraisals yet">
              Open a cycle to create an appraisal for every active employee.
            </EmptyState>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Employee</Th>
                  <Th>Cycle</Th>
                  <Th>Self</Th>
                  <Th>Manager</Th>
                  <Th>Status</Th>
                  <Th>
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <Tr key={r.id}>
                    <Td>
                      <TwoLine
                        value={name.get(r.employeeId) ?? "—"}
                        sub={numberOf.get(r.employeeId)}
                      />
                    </Td>
                    <Td>
                      <span className="text-secondary">{r.cycleName}</span>
                    </Td>
                    <Td>
                      {r.selfRating ? (
                        <TwoLine
                          value={`${r.selfRating} of 5`}
                          sub={RATING_LABELS[r.selfRating]}
                        />
                      ) : (
                        <span className="text-decor">&mdash;</span>
                      )}
                    </Td>
                    <Td>
                      {r.managerRating ? (
                        <TwoLine
                          value={`${r.managerRating} of 5`}
                          sub={RATING_LABELS[r.managerRating]}
                        />
                      ) : (
                        <span className="text-decor">&mdash;</span>
                      )}
                    </Td>
                    <Td>
                      <Status
                        tone={
                          r.status === "Completed"
                            ? "done"
                            : r.status === "Pending manager review"
                              ? "action"
                              : "waiting"
                        }
                      >
                        {r.status}
                      </Status>
                    </Td>
                    <Td className="text-right whitespace-nowrap">
                      {r.status === "Pending manager review" || r.status === "Completed" ? (
                        <ManagerRatingButton
                          id={r.id}
                          employeeName={name.get(r.employeeId) ?? "this employee"}
                          selfRating={r.selfRating}
                          selfComments={r.selfComments}
                          currentRating={r.managerRating}
                          currentComments={r.managerComments}
                          done={r.status === "Completed"}
                        />
                      ) : (
                        <span className="text-[13px] text-muted">With the employee</span>
                      )}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
