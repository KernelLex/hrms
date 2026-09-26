import { redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  rcApplication,
  rcCandidate,
  rcRequisition,
  omPosition,
  PIPELINE_STAGES,
} from "@/db/schema";
import { getSession, hasRole } from "@/lib/auth";
import { formatINR } from "@/lib/money";
import {
  Card,
  PageHeader,
  Table,
  Th,
  Tr,
  Td,
  TwoLine,
  FigureRow,
  Figure,
  EmptyState,
} from "@/components/ui";
import { StageTrack } from "@/components/stage-track";
import { Users } from "lucide-react";
import { RecruitmentTabs } from "../tabs";
import { PipelineActions, NewApplicationForm } from "./actions";

/** RC-03 — the application pipeline. */
export default async function PipelinePage() {
  const session = await getSession();
  if (!hasRole(session, "HR_ADMIN")) redirect("/");

  const [rows, candidates, requisitions, positions] = await Promise.all([
    db
      .select({
        id: rcApplication.id,
        candidateId: rcApplication.candidateId,
        requisitionId: rcApplication.requisitionId,
        stage: rcApplication.stage,
        appliedDate: rcApplication.appliedDate,
        rejectedAt: rcApplication.rejectedAt,
        rejectedReason: rcApplication.rejectedReason,
        offeredSalaryPaise: rcApplication.offeredSalaryPaise,
        candidateName: rcCandidate.fullName,
        candidateCode: rcCandidate.code,
        requisitionCode: rcRequisition.code,
        positionCode: rcRequisition.positionCode,
      })
      .from(rcApplication)
      .innerJoin(rcCandidate, eq(rcCandidate.id, rcApplication.candidateId))
      .innerJoin(rcRequisition, eq(rcRequisition.id, rcApplication.requisitionId))
      .orderBy(desc(rcApplication.appliedDate)),
    db.select().from(rcCandidate).orderBy(desc(rcCandidate.id)),
    db
      .select()
      .from(rcRequisition)
      .where(eq(rcRequisition.status, "Open"))
      .orderBy(desc(rcRequisition.postedDate)),
    db.select().from(omPosition),
  ]);

  const positionTitle = new Map(positions.map((p) => [p.code, p.title]));

  const active = rows.filter((r) => !r.rejectedAt && r.stage !== "Hired");
  const offered = rows.filter((r) => r.stage === "Offered" && !r.rejectedAt);
  const hired = rows.filter((r) => r.stage === "Hired");
  const rejected = rows.filter((r) => r.rejectedAt);

  return (
    <>
      <RecruitmentTabs />
      <PageHeader
        title="Pipeline"
        subtitle="Every application and where it stands. Stages move one step at a time, and each move is recorded."
      />

      <FigureRow>
        <Figure label="In progress" value={active.length} hint="not yet decided" />
        <Figure label="Offered" value={offered.length} hint="ready to convert" />
        <Figure label="Hired" value={hired.length} hint="became employees" />
        <Figure label="Rejected" value={rejected.length} hint="closed without a hire" />
      </FigureRow>

      <div className="mt-6">
        <NewApplicationForm
          candidates={candidates.map((c) => ({
            value: String(c.id),
            label: `${c.code} — ${c.fullName}`,
          }))}
          requisitions={requisitions.map((r) => ({ value: String(r.id), label: r.code }))}
        />
      </div>

      <div className="mt-6">
        <Card>
          {rows.length === 0 ? (
            <EmptyState icon={<Users />} title="No applications yet">
              Add a candidate and apply them to an open requisition.
            </EmptyState>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Candidate</Th>
                  <Th>Requisition</Th>
                  <Th>Stage</Th>
                  <Th>Applied</Th>
                  <Th numeric>Offer</Th>
                  <Th>
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const index = PIPELINE_STAGES.indexOf(
                    r.stage as (typeof PIPELINE_STAGES)[number],
                  );
                  return (
                    <Tr key={r.id}>
                      <Td>
                        <TwoLine value={r.candidateName} sub={r.candidateCode} />
                      </Td>
                      <Td>
                        <TwoLine
                          value={r.requisitionCode}
                          sub={positionTitle.get(r.positionCode) ?? r.positionCode}
                        />
                      </Td>
                      <Td>
                        <StageTrack
                          stages={PIPELINE_STAGES}
                          currentIndex={Math.max(0, index)}
                          failed={Boolean(r.rejectedAt)}
                        />
                      </Td>
                      <Td>
                        <span className="tabular text-secondary">{r.appliedDate}</span>
                      </Td>
                      <Td numeric>
                        {r.offeredSalaryPaise ? (
                          formatINR(r.offeredSalaryPaise)
                        ) : (
                          <span className="text-decor">&mdash;</span>
                        )}
                      </Td>
                      <Td className="text-right whitespace-nowrap">
                        <PipelineActions
                          id={r.id}
                          stage={r.stage}
                          rejected={Boolean(r.rejectedAt)}
                          describe={`${r.candidateName}, ${r.requisitionCode}`}
                        />
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
