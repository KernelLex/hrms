import { requirePage } from "@/lib/access";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  pmAppraisal,
  pmAppraisalCycle,
  pmCalibration,
  RATING_LABELS,
} from "@/db/schema";
import { listEmployees, fullName } from "@/lib/repositories/employees";
import {
  Card,
  CardHeader,
  PageHeader,
  Table,
  Th,
  Tr,
  Td,
  TwoLine,
  Status,
  EmptyState,
} from "@/components/ui";
import { Scale } from "lucide-react";
import { PerformanceTabs } from "../tabs";
import { CalibrateButton } from "./actions";

/** PM-04 — calibration, so a 4 means the same thing across teams. */
export default async function CalibrationPage() {
  await requirePage(["performance.manage"], "/performance");

  const [rows, employees] = await Promise.all([
    db
      .select({
        appraisalId: pmAppraisal.id,
        employeeId: pmAppraisal.employeeId,
        managerRating: pmAppraisal.managerRating,
        appraisalStatus: pmAppraisal.status,
        cycleName: pmAppraisalCycle.name,
        calibratedRating: pmCalibration.calibratedRating,
        committeeComments: pmCalibration.committeeComments,
        calibrationStatus: pmCalibration.status,
      })
      .from(pmAppraisal)
      .innerJoin(pmAppraisalCycle, eq(pmAppraisalCycle.id, pmAppraisal.cycleId))
      .leftJoin(pmCalibration, eq(pmCalibration.appraisalId, pmAppraisal.id))
      .orderBy(desc(pmAppraisal.updatedAt)),
    listEmployees(),
  ]);

  const name = new Map(employees.map((e) => [e.id, fullName(e)]));
  const numberOf = new Map(employees.map((e) => [e.id, e.employee_number]));

  // Distribution across finalised and in-review calibrated ratings.
  const distribution = [5, 4, 3, 2, 1].map((rating) => ({
    rating,
    label: RATING_LABELS[rating],
    count: rows.filter((r) => r.calibratedRating === rating).length,
  }));
  const maxCount = Math.max(1, ...distribution.map((d) => d.count));
  const rated = rows.filter((r) => r.calibratedRating).length;

  return (
    <>
      <PerformanceTabs />
      <PageHeader
        title="Calibration"
        subtitle="Moderating ratings across teams before anyone is told a number. The manager's rating is kept, so moderating does not erase what they originally thought."
      />

      {rated > 0 ? (
        <Card className="mb-6">
          <CardHeader
            title="Rating distribution"
            description={`${rated} calibrated so far`}
          />
          <div className="flex flex-col gap-2.5 px-6 pb-5">
            {distribution.map((d) => (
              <div key={d.rating} className="flex items-center gap-3">
                <div className="w-36 shrink-0 truncate text-[13px] text-muted">
                  {d.rating} — {d.label}
                </div>
                <div className="flex-1">
                  {/* §8.10 bar list: ink bar, longest reaching 85% of the width. */}
                  <div
                    className="h-3 rounded-r-[4px] bg-ink"
                    style={{ width: `${(d.count / maxCount) * 85}%`, minWidth: d.count > 0 ? "2px" : "0" }}
                  />
                </div>
                <div className="tabular w-8 shrink-0 text-right text-xs font-medium text-ink">
                  {d.count}
                </div>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      <Card>
        {rows.length === 0 ? (
          <EmptyState icon={<Scale />} title="Nothing to calibrate">
            Appraisals appear here once both ratings are in.
          </EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Employee</Th>
                <Th>Cycle</Th>
                <Th>Manager rating</Th>
                <Th>Calibrated</Th>
                <Th>Committee note</Th>
                <Th>Status</Th>
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const ready = r.appraisalStatus === "Completed";
                const moved =
                  r.calibratedRating && r.managerRating && r.calibratedRating !== r.managerRating;
                return (
                  <Tr key={r.appraisalId}>
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
                      {r.managerRating ? (
                        <span className="tabular">{r.managerRating} of 5</span>
                      ) : (
                        <span className="text-decor">&mdash;</span>
                      )}
                    </Td>
                    <Td>
                      {r.calibratedRating ? (
                        <TwoLine
                          value={`${r.calibratedRating} of 5`}
                          sub={moved ? `moved from ${r.managerRating}` : undefined}
                        />
                      ) : (
                        <span className="text-decor">&mdash;</span>
                      )}
                    </Td>
                    <Td>
                      <span className="text-secondary">
                        {r.committeeComments ?? <span className="text-decor">&mdash;</span>}
                      </span>
                    </Td>
                    <Td>
                      <Status
                        tone={
                          r.calibrationStatus === "Finalised"
                            ? "done"
                            : r.calibrationStatus === "In review"
                              ? "action"
                              : "waiting"
                        }
                      >
                        {r.calibrationStatus ?? "Pending"}
                      </Status>
                    </Td>
                    <Td className="text-right whitespace-nowrap">
                      {ready ? (
                        <CalibrateButton
                          appraisalId={r.appraisalId}
                          employeeName={name.get(r.employeeId) ?? "this employee"}
                          managerRating={r.managerRating}
                          currentRating={r.calibratedRating}
                          currentComments={r.committeeComments}
                          finalised={r.calibrationStatus === "Finalised"}
                        />
                      ) : (
                        <span className="text-[13px] text-muted">Awaiting ratings</span>
                      )}
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
