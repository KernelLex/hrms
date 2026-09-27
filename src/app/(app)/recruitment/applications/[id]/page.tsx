import Link from "next/link";
import { notFound } from "next/navigation";
import { CircleCheck, CircleX, FileText } from "lucide-react";
import { can, requirePage } from "@/lib/access";
import { employeeChoices, getApplication, type Interview } from "@/lib/repositories/recruitment";
import { INTERVIEW_LABEL, INTERVIEW_TONE, PIPELINE_STAGES, RECOMMENDATION_LABEL, STAGE_LABEL } from "@/lib/recruitment-values";
import { formatDate, formatTime, formatTimestamp, todayInIndia } from "@/lib/dates";
import { formatINR } from "@/lib/money";
import {
  ButtonLink,
  Card,
  CardHeader,
  EmptyState,
  KeyValue,
  KeyValueRow,
  Notice,
  PageHeader,
  Status,
} from "@/components/ui";
import { StageTrack } from "@/components/stage-track";
import { Paragraphs } from "@/components/prose";
import { RecruitmentTabs } from "../../tabs";
import {
  DecisionActions,
  InterviewButton,
  InterviewStatusActions,
  OfferForm,
  RejectButton,
  ScreeningActions,
} from "../../forms";

const LABELS = PIPELINE_STAGES.map((s) => STAGE_LABEL[s]);


const isLink = (v: string | null) => Boolean(v && /^https?:\/\//i.test(v));

/** Why the candidate cannot be approved yet, if they cannot. */
function blocker(interviews: Interview[]): string | null {
  if (!interviews.some((i) => i.status === "Completed")) return "Record at least one round's notes before deciding.";
  const waiting = interviews.find((i) => i.status === "Scheduled");
  return waiting ? `${waiting.round} with ${waiting.interviewer} is still scheduled: record its notes or cancel it first.` : null;
}

function Round({
  i,
  live,
  applicationId,
  employees,
  today,
}: {
  i: Interview;
  live: boolean;
  applicationId: number;
  employees: { id: number; label: string }[];
  today: string;
}) {
  return (
    <li className="border-b border-soft px-6 py-4 last:border-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[15px] font-medium text-ink">{i.round}</span>
            <Status tone={INTERVIEW_TONE[i.status] ?? "neutral"}>{INTERVIEW_LABEL[i.status] ?? i.status}</Status>
          </div>
          <p className="mt-1 text-[13px] text-secondary">
            {i.interviewer} · {formatDate(i.scheduledDate)}
            {i.scheduledTime ? `, ${formatTime(i.scheduledTime)}` : ""} · {i.durationMinutes} min · {i.mode}
          </p>
          {i.location ? (
            <p className="mt-0.5 text-[13px] break-all text-muted">
              {isLink(i.location) ? (
                <a href={i.location} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-ink">
                  {i.location}
                </a>
              ) : (
                i.location
              )}
            </p>
          ) : null}
        </div>
        {live ? (
          <div className="flex flex-wrap items-start justify-end gap-1">
            {i.status !== "Completed" ? (
              <InterviewButton
                applicationId={applicationId}
                employees={employees}
                today={today}
                interview={{
                  id: i.id,
                  round: i.round,
                  interviewerEmployeeId: i.interviewerEmployeeId,
                  interviewer: i.interviewer,
                  scheduledDate: i.scheduledDate,
                  scheduledTime: i.scheduledTime ?? "",
                  durationMinutes: i.durationMinutes,
                  mode: i.mode,
                  location: i.location ?? "",
                }}
              />
            ) : null}
            {i.status !== "Cancelled" && i.status !== "No-show" ? (
              <ButtonLink href={`/recruitment/interviews/${i.id}`} size="sm" variant="ghost">
                {i.status === "Completed" ? "Edit notes" : "Record notes"}
              </ButtonLink>
            ) : null}
            {i.status !== "Completed" ? <InterviewStatusActions id={i.id} status={i.status} /> : null}
          </div>
        ) : null}
      </div>
      {i.status === "Completed" ? (
        <div className="mt-3 rounded-xl bg-canvas px-4 py-3">
          <p className="text-[13px] font-medium text-ink">
            {i.rating ? `${i.rating} of 5` : "Not rated"}
            {i.recommendation ? ` · ${RECOMMENDATION_LABEL[i.recommendation] ?? i.recommendation}` : ""}
          </p>
          <Paragraphs text={i.feedback} className="mt-1.5 text-[13px] leading-relaxed text-ink-hover" />
          {i.completedBy ? <p className="mt-2 text-xs text-muted">Recorded by {i.completedBy}{i.completedAt ? `, ${formatTimestamp(i.completedAt)}` : ""}</p> : null}
        </div>
      ) : null}
    </li>
  );
}

/** One application, and everything done with it: the whole workflow in one place. */
export default async function ApplicationPage(props: { params: Promise<{ id: string }> }) {
  const session = await requirePage(["recruitment.manage"], "/");
  const a = await getApplication(Number((await props.params).id));
  if (!a) notFound();
  const employees = a.stage === "Interviewing" && !a.rejected ? await employeeChoices() : [];
  const today = todayInIndia();
  const live = !a.rejected && a.stage === "Interviewing";
  const index = Math.max(0, PIPELINE_STAGES.indexOf(a.stage));
  const r = a.requisition;
  const budget = [r.budgetMinPaise, r.budgetMaxPaise].filter((v): v is number => v !== null).map(formatINR).join(" to ");
  const doneRounds = a.interviews.filter((i) => i.status === "Completed").length;

  return (
    <>
      <RecruitmentTabs />
      <PageHeader
        back={{ href: "/recruitment/pipeline", label: "Applications" }}
        title={a.candidate.fullName}
        badge={<Status tone={a.rejected ? "neutral" : a.stage === "Hired" ? "done" : "action"}>{a.rejected ? "Not taken forward" : STAGE_LABEL[a.stage]}</Status>}
        subtitle={`For ${r.title} (${r.code}), applied ${formatDate(a.appliedDate)} ${a.channel === "Careers page" ? "on the careers page" : "through HR"}.`}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <div className="px-6 pt-5 pb-6">
              <StageTrack stages={LABELS} currentIndex={index} failed={Boolean(a.rejected)} failedLabel={`Not taken forward at ${STAGE_LABEL[a.stage].toLowerCase()}`} />
              <div className="mt-5">
                {a.rejected ? (
                  <Notice icon={<CircleX />}>
                    <p>
                      Closed by {a.rejected.by ?? "HR"} on {formatDate(a.rejected.at.slice(0, 10))}
                      {a.rejected.reason ? `: ${a.rejected.reason}` : "."}
                    </p>
                  </Notice>
                ) : a.stage === "Applied" ? (
                  <>
                    <h2 className="mb-1 text-[15px] font-semibold text-ink">Screen the profile</h2>
                    <p className="mb-4 text-[13px] text-muted">Read the resume and the note below, then take them to interview or reject the profile.</p>
                    <ScreeningActions id={a.id} />
                  </>
                ) : a.stage === "Interviewing" ? (
                  <>
                    <h2 className="mb-1 text-[15px] font-semibold text-ink">Approve or reject</h2>
                    <p className="mb-4 text-[13px] text-muted">
                      {doneRounds === 0
                        ? "Schedule the rounds below. Once they are done and their notes recorded, decide here."
                        : `${doneRounds} round${doneRounds === 1 ? "" : "s"} done. Schedule another, or decide.`}
                    </p>
                    <DecisionActions id={a.id} blocker={blocker(a.interviews)} />
                  </>
                ) : a.stage === "Selected" ? (
                  <>
                    <h2 className="mb-1 text-[15px] font-semibold text-ink">Make the offer</h2>
                    <p className="mb-4 text-[13px] text-muted">
                      Approved by {a.selected?.by ?? "HR"}
                      {a.selected ? ` on ${formatDate(a.selected.at.slice(0, 10))}` : ""}
                      {a.selected?.note ? `: ${a.selected.note}` : "."}
                    </p>
                    <OfferForm id={a.id} hint={budget ? `The budget for this role is ${budget} a month.` : "Per month, in rupees. Carried into the hire."} />
                  </>
                ) : a.stage === "Offered" ? (
                  <>
                    <h2 className="mb-1 text-[15px] font-semibold text-ink">Offered {a.offeredSalaryPaise ? `${formatINR(a.offeredSalaryPaise)} a month` : ""}</h2>
                    <p className="mb-4 text-[13px] text-muted">
                      {a.offeredAt ? `On ${formatDate(a.offeredAt.slice(0, 10))}. ` : ""}When they accept, convert them into an employee; if they decline, close the application.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {can(session, "recruitment.hire") ? (
                        <ButtonLink href="/recruitment/hire" variant="primary">
                          Convert to employee
                        </ButtonLink>
                      ) : null}
                      <RejectButton
                        id={a.id}
                        label="Offer declined"
                        title="Close the application"
                        description="For an offer the candidate declined, or one withdrawn."
                        placeholder="Accepted another offer"
                        confirm="Close application"
                      />
                    </div>
                  </>
                ) : (
                  <Notice icon={<CircleCheck />}>
                    <p>
                      Hired.{" "}
                      {a.employeeId ? (
                        <Link href={`/core-hr/${a.employeeId}`} className="font-medium text-ink underline underline-offset-2">
                          Open their employee record
                        </Link>
                      ) : null}
                    </p>
                  </Notice>
                )}
              </div>
            </div>
          </Card>

          {a.stage !== "Applied" || a.interviews.length > 0 ? (
            <Card>
              <CardHeader
                title="Interview rounds"
                description="Each round has its own interviewer, time and notes. Interviewers are told, and record their notes themselves."
                actions={live ? <InterviewButton applicationId={a.id} employees={employees} today={today} suggestedRound={a.interviews.length === 0 ? "Technical round 1" : undefined} /> : undefined}
              />
              {a.interviews.length === 0 ? (
                <EmptyState title="No rounds yet">{live ? "Schedule the first round." : "This application closed before any interview."}</EmptyState>
              ) : (
                <ol>
                  {a.interviews.map((i) => (
                    <Round key={i.id} i={i} live={live} applicationId={a.id} employees={employees} today={today} />
                  ))}
                </ol>
              )}
            </Card>
          ) : null}

          <Card>
            <CardHeader title="History" />
            <ol className="px-6 pb-5">
              {a.history.map((h, n) => (
                <li key={n} className="flex gap-3 border-b border-soft py-2.5 text-[13px] last:border-0">
                  <span className="tabular w-[156px] shrink-0 whitespace-nowrap text-muted">{formatTimestamp(h.at)}</span>
                  <span className="min-w-0 text-ink-hover">
                    {h.to === "Rejected"
                      ? "Not taken forward"
                      : h.from === null
                        ? "Applied"
                        : `Moved to ${(STAGE_LABEL as Record<string, string>)[h.to]?.toLowerCase() ?? h.to.toLowerCase()}`}{" "}
                    by {h.by}
                    {h.note ? <span className="text-muted"> — {h.note}</span> : null}
                  </span>
                </li>
              ))}
            </ol>
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader title="Candidate" />
            <div className="px-6 pb-4">
              <KeyValue>
                <KeyValueRow label="Email">
                  <a href={`mailto:${a.candidate.email}`} className="break-all hover:underline">
                    {a.candidate.email}
                  </a>
                </KeyValueRow>
                <KeyValueRow label="Phone">{a.candidate.phone ?? "Not given"}</KeyValueRow>
                <KeyValueRow label="Works at">{a.candidate.currentEmployer ?? "Not given"}</KeyValueRow>
                <KeyValueRow label="Experience">{a.candidate.experienceYears !== null ? `${a.candidate.experienceYears} years` : "Not given"}</KeyValueRow>
                <KeyValueRow label="Notice period">{a.candidate.noticePeriodDays !== null ? `${a.candidate.noticePeriodDays} days` : "Not given"}</KeyValueRow>
                <KeyValueRow label="Source">{a.candidate.source}</KeyValueRow>
              </KeyValue>
              <div className="mt-3 flex flex-col gap-1.5 text-[13px]">
                {a.resume ? (
                  <a href={`/api/documents/${a.resume.id}`} className="inline-flex items-center gap-1.5 font-medium text-ink hover:underline">
                    <FileText className="size-4" />
                    {a.resume.fileName}
                  </a>
                ) : a.candidate.resumeLink ? (
                  <a href={a.candidate.resumeLink} target="_blank" rel="noopener noreferrer" className="font-medium text-ink hover:underline">
                    Resume (external link)
                  </a>
                ) : (
                  <span className="text-muted">No resume on file.</span>
                )}
                {a.candidate.profileLink ? (
                  <a href={a.candidate.profileLink} target="_blank" rel="noopener noreferrer" className="break-all text-secondary hover:underline">
                    {a.candidate.profileLink}
                  </a>
                ) : null}
              </div>
            </div>
          </Card>

          {a.coverNote ? (
            <Card>
              <CardHeader title="Their note" />
              <Paragraphs text={a.coverNote} className="px-6 pb-5 text-[13px] leading-relaxed text-ink-hover" />
            </Card>
          ) : null}

          {a.otherApplications.length > 0 ? (
            <Card>
              <CardHeader title="Other applications" />
              <ul className="px-6 pb-4">
                {a.otherApplications.map((o) => (
                  <li key={o.id} className="border-b border-soft py-2 text-[13px] last:border-0">
                    <Link href={`/recruitment/applications/${o.id}`} className="font-medium text-ink hover:underline">
                      {o.roleTitle}
                    </Link>
                    <span className="text-muted"> · {o.rejected ? "Not taken forward" : ((STAGE_LABEL as Record<string, string>)[o.stage] ?? o.stage)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
