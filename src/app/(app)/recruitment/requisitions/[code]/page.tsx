import Link from "next/link";
import { notFound } from "next/navigation";
import { Globe, Users } from "lucide-react";
import { requirePage } from "@/lib/access";
import { getRequisition, listApplications } from "@/lib/repositories/recruitment";
import { experienceText, PIPELINE_STAGES, STAGE_LABEL } from "@/lib/recruitment-values";
import { formatDate, formatTime } from "@/lib/dates";
import { formatINR } from "@/lib/money";
import {
  ButtonLink,
  Card,
  CardHeader,
  EmptyState,
  Figure,
  FigureRow,
  KeyValue,
  KeyValueRow,
  Notice,
  PageHeader,
  Status,
  Table,
  Th,
  Tr,
  Td,
  TwoLine,
} from "@/components/ui";
import { StageTrack } from "@/components/stage-track";
import { Lines, Paragraphs } from "@/components/prose";
import { RecruitmentTabs } from "../../tabs";
import { CopyLink, DeleteRequisitionButton, PublishButton } from "../../forms";

const LABELS = PIPELINE_STAGES.map((s) => STAGE_LABEL[s]);

/** One requisition: the role, where hiring for it stands, and every application. */
export default async function RequisitionPage(props: { params: Promise<{ code: string }> }) {
  await requirePage(["recruitment.manage"], "/");
  const r = await getRequisition((await props.params).code);
  if (!r) notFound();
  const applications = await listApplications({ requisition: r.code });
  const experience = experienceText(r.experienceMinYears, r.experienceMaxYears);
  const budget =
    r.budgetMinPaise || r.budgetMaxPaise
      ? [r.budgetMinPaise, r.budgetMaxPaise].filter((v): v is number => v !== null).map(formatINR).join(" to ")
      : null;

  return (
    <>
      <RecruitmentTabs />
      <PageHeader
        back={{ href: "/recruitment/requisitions", label: "Requisitions" }}
        title={r.title}
        badge={<Status tone={r.status === "Open" ? "action" : r.status === "On hold" ? "waiting" : "neutral"}>{r.status}</Status>}
        subtitle={`${r.code} · ${r.department} · position ${r.positionCode}, ${r.positionTitle}`}
        actions={
          <>
            {applications.length === 0 ? <DeleteRequisitionButton code={r.code} /> : null}
            <ButtonLink href={`/recruitment/requisitions/${r.code}/edit`}>Edit</ButtonLink>
            {r.status === "Open" || r.isPublished ? <PublishButton code={r.code} published={r.isPublished} /> : null}
          </>
        }
      />

      {r.isPublished ? (
        <div className="mb-6">
          <Notice icon={<Globe />}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>
                On the careers page at{" "}
                <Link href={`/careers/${r.code}`} className="font-medium text-ink underline underline-offset-2">
                  /careers/{r.code}
                </Link>
                . Anyone with the link can apply.
              </span>
              <CopyLink path={`/careers/${r.code}`} />
            </div>
          </Notice>
        </div>
      ) : null}

      <FigureRow>
        <Figure label="New" value={r.counts.Applied} hint="waiting to be screened" href={`/recruitment/pipeline?stage=Applied&requisition=${r.code}`} />
        <Figure label="Interviewing" value={r.counts.Interviewing + r.counts.Selected} hint="in rounds, or approved" />
        <Figure label="Offered" value={r.counts.Offered} hint="waiting to join" />
        <Figure label="Hired" value={`${r.counts.Hired} of ${r.openings}`} hint={r.counts.Rejected ? `${r.counts.Rejected} not taken forward` : "openings filled"} />
      </FigureRow>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <CardHeader title="Applications" description="Open one to screen it, schedule interviews, record the decision or make the offer." />
            {applications.length === 0 ? (
              <EmptyState icon={<Users />} title="Nobody has applied yet">
                {r.isPublished ? "Share the careers page link to find candidates." : "Publish the requisition, or add candidates HR already has."}
              </EmptyState>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Candidate</Th>
                    <Th>Stage</Th>
                    <Th>Next</Th>
                  </tr>
                </thead>
                <tbody>
                  {applications.map((a) => (
                    <Tr key={a.id}>
                      <Td>
                        <Link href={`/recruitment/applications/${a.id}`} className="hover:underline">
                          <TwoLine value={a.candidateName} sub={`Applied ${formatDate(a.appliedDate)}, ${a.channel === "Careers page" ? "on the careers page" : "added by HR"}`} />
                        </Link>
                      </Td>
                      <Td>
                        <StageTrack stages={LABELS} currentIndex={Math.max(0, PIPELINE_STAGES.indexOf(a.stage))} failed={a.rejected} />
                      </Td>
                      <Td>
                        <span className="text-[13px] text-secondary">
                          {a.nextRound
                            ? `Interview ${formatDate(a.nextRound.date)}${a.nextRound.time ? `, ${formatTime(a.nextRound.time)}` : ""}`
                            : a.rejected || a.stage === "Hired"
                              ? ""
                              : a.stage === "Applied"
                                ? "Screen"
                                : a.stage === "Interviewing"
                                  ? a.roundsDone > 0
                                    ? "Decide"
                                    : "Schedule a round"
                                  : a.stage === "Selected"
                                    ? "Make the offer"
                                    : "Convert to employee"}
                        </span>
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>

          <Card>
            <CardHeader title="The role, as candidates read it" />
            <div className="px-6 pb-6 text-[15px] leading-relaxed text-ink-hover">
              {r.description ? <Paragraphs text={r.description} /> : <p className="text-muted">No description yet. Add one before publishing.</p>}
              {r.qualifications ? (
                <>
                  <h3 className="mt-6 mb-2 text-[13px] font-semibold text-ink">Qualifications</h3>
                  <Lines text={r.qualifications} />
                </>
              ) : null}
              {r.skills ? (
                <>
                  <h3 className="mt-6 mb-2 text-[13px] font-semibold text-ink">Skills</h3>
                  <Lines text={r.skills} />
                </>
              ) : null}
            </div>
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader title="Details" />
            <div className="px-6 pb-4">
              <KeyValue>
                <KeyValueRow label="Type">{r.employmentType}</KeyValueRow>
                <KeyValueRow label="Works">{r.workMode}</KeyValueRow>
                <KeyValueRow label="Location">{r.location ?? "Not given"}</KeyValueRow>
                <KeyValueRow label="Experience">{experience ?? "Not given"}</KeyValueRow>
                <KeyValueRow label="Openings">{r.openings}</KeyValueRow>
                <KeyValueRow label="Priority">{r.priority}</KeyValueRow>
                <KeyValueRow label="Hiring manager">{r.hiringManager ?? "Not named"}</KeyValueRow>
                <KeyValueRow label="Monthly budget">{budget ?? "Not set"}</KeyValueRow>
                <KeyValueRow label="Posted">{formatDate(r.postedDate)}</KeyValueRow>
                <KeyValueRow label="Close by">{r.targetCloseDate ? formatDate(r.targetCloseDate) : "Not set"}</KeyValueRow>
              </KeyValue>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
