import Link from "next/link";
import { Users } from "lucide-react";
import { requirePage } from "@/lib/access";
import { rawClient } from "@/lib/db";
import { listApplications, stageCounts } from "@/lib/repositories/recruitment";
import { PIPELINE_STAGES, STAGE_LABEL, type PipelineStage } from "@/lib/recruitment-values";
import { formatDate, formatTime } from "@/lib/dates";
import { formatINR } from "@/lib/money";
import { Card, EmptyState, PageHeader, Tab, Tabs, Table, Th, Tr, Td, TwoLine } from "@/components/ui";
import { StageTrack } from "@/components/stage-track";
import { RecruitmentTabs } from "../tabs";
import { NewApplicationForm } from "../forms";

const LABELS = PIPELINE_STAGES.map((s) => STAGE_LABEL[s]);
const FILTERS: (PipelineStage | "Rejected" | "All")[] = ["Applied", "Interviewing", "Selected", "Offered", "Hired", "Rejected", "All"];
const FILTER_LABEL = { ...STAGE_LABEL, Rejected: "Not taken forward", All: "All" } as Record<string, string>;

/** What happens next for an application, in a few words. */
function nextStep(a: Awaited<ReturnType<typeof listApplications>>[number]): string {
  if (a.rejected || a.stage === "Hired") return "";
  if (a.nextRound) return `${a.nextRound.interviewer}, ${formatDate(a.nextRound.date)}${a.nextRound.time ? ` ${formatTime(a.nextRound.time)}` : ""}`;
  if (a.stage === "Applied") return "Screen the profile";
  if (a.stage === "Interviewing") return a.roundsDone > 0 ? "Approve or reject" : "Schedule a round";
  if (a.stage === "Selected") return "Make the offer";
  return "Convert to employee";
}

/** RC-03 — every application, by where it stands. */
export default async function PipelinePage(props: { searchParams: Promise<{ stage?: string; requisition?: string }> }) {
  await requirePage(["recruitment.manage"], "/");
  const q = await props.searchParams;
  const stage = (FILTERS as string[]).includes(q.stage ?? "") ? (q.stage as (typeof FILTERS)[number]) : "Applied";
  const requisition = q.requisition ?? null;

  const [rows, counts, candidates, requisitions] = await Promise.all([
    listApplications({ stage: stage === "All" ? null : stage, requisition }),
    stageCounts(),
    rawClient().execute("SELECT id, code, full_name FROM rc_candidate ORDER BY id DESC"),
    rawClient().execute("SELECT id, code, title FROM rc_requisition WHERE status = 'Open' ORDER BY posted_date DESC"),
  ]);
  const href = (s: string) => `/recruitment/pipeline?stage=${s}${requisition ? `&requisition=${requisition}` : ""}`;

  return (
    <>
      <RecruitmentTabs />
      <PageHeader
        title="Applications"
        subtitle="Screen new ones, run the interview rounds, then approve or reject. Open an application to act on it."
        actions={
          <NewApplicationForm
            candidates={candidates.rows.map((c) => ({ value: String(c.id), label: `${String(c.full_name)} (${String(c.code)})` }))}
            requisitions={requisitions.rows.map((r) => ({ value: String(r.id), label: `${String(r.title) || String(r.code)} (${String(r.code)})` }))}
          />
        }
      />

      <Tabs>
        {FILTERS.map((f) => (
          <Tab key={f} href={href(f)} active={f === stage} count={counts[f]}>
            {FILTER_LABEL[f]}
          </Tab>
        ))}
      </Tabs>

      {requisition ? (
        <p className="-mt-3 mb-4 text-[13px] text-muted">
          For {requisition} only.{" "}
          <Link href={`/recruitment/pipeline?stage=${stage}`} className="font-medium text-ink hover:underline">
            Show every requisition
          </Link>
        </p>
      ) : null}

      <Card>
        {rows.length === 0 ? (
          <EmptyState icon={<Users />} title={stage === "Applied" ? "Nothing to screen" : "No applications here"}>
            {stage === "Applied" ? "New applications from the careers page, and ones HR adds, arrive here." : "Applications appear here as they reach this stage."}
          </EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Candidate</Th>
                <Th>Role</Th>
                <Th>Stage</Th>
                <Th>Next</Th>
                <Th numeric>Offer</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <Tr key={a.id}>
                  <Td>
                    <Link href={`/recruitment/applications/${a.id}`} className="hover:underline">
                      <TwoLine value={a.candidateName} sub={`Applied ${formatDate(a.appliedDate)}${a.channel === "Careers page" ? ", careers page" : ""}`} />
                    </Link>
                  </Td>
                  <Td>
                    <TwoLine value={a.roleTitle} sub={a.requisitionCode} />
                  </Td>
                  <Td>
                    <StageTrack stages={LABELS} currentIndex={Math.max(0, PIPELINE_STAGES.indexOf(a.stage))} failed={a.rejected} />
                  </Td>
                  <Td>
                    <span className="text-[13px] text-secondary">{nextStep(a)}</span>
                  </Td>
                  <Td numeric>{a.offeredSalaryPaise ? formatINR(a.offeredSalaryPaise) : <span className="text-decor">&mdash;</span>}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
