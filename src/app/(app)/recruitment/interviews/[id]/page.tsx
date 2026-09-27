import { notFound } from "next/navigation";
import { FileText, Info } from "lucide-react";
import { can, requirePage } from "@/lib/access";
import { getInterview } from "@/lib/repositories/recruitment";
import { experienceText, INTERVIEW_LABEL, INTERVIEW_TONE, RECOMMENDATION_LABEL } from "@/lib/recruitment-values";
import { formatDate, formatTime, formatTimestamp } from "@/lib/dates";
import { Card, CardHeader, KeyValue, KeyValueRow, Notice, PageHeader, Status } from "@/components/ui";
import { Lines, Paragraphs } from "@/components/prose";
import { FeedbackForm } from "../../forms";

/**
 * One interview round, for the person taking it: who the candidate is, what
 * the role needs, and where to record how it went. Recruiters open it too, to
 * record notes for an interviewer who cannot sign in. Other rounds' notes are
 * not shown here, so each interviewer judges for themselves.
 */
export default async function InterviewPage(props: { params: Promise<{ id: string }> }) {
  const session = await requirePage(["recruitment.manage", "recruitment.interview"], "/");
  const i = await getInterview(Number((await props.params).id));
  const manages = can(session, "recruitment.manage");
  const own = Boolean(i && session.employeeId !== null && i.interviewerEmployeeId === session.employeeId);
  // Someone else's round is not theirs to see.
  if (!i || (!own && !manages)) notFound();

  const open = !i.applicationRejected && i.applicationStage === "Interviewing";
  const recordable = open && (i.status === "Scheduled" || i.status === "Completed");
  const r = i.requisition;
  const c = i.candidate;
  const experience = experienceText(r.experienceMinYears, r.experienceMaxYears);

  return (
    <>
      <PageHeader
        back={manages ? { href: `/recruitment/applications/${i.applicationId}`, label: "Application" } : { href: "/recruitment/my-interviews", label: "My interviews" }}
        title={`${i.round} with ${i.candidateName}`}
        badge={<Status tone={INTERVIEW_TONE[i.status] ?? "neutral"}>{INTERVIEW_LABEL[i.status] ?? i.status}</Status>}
        subtitle={`For ${i.roleTitle}. ${formatDate(i.scheduledDate)}${i.scheduledTime ? ` at ${formatTime(i.scheduledTime)}` : ""}, ${i.durationMinutes} minutes, ${i.mode.toLowerCase()}.`}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-6">
          {recordable ? (
            <Card>
              <CardHeader
                title={own ? "Your notes" : `Notes for ${i.interviewer}`}
                description={
                  i.status === "Completed"
                    ? `Recorded by ${i.completedBy ?? "HR"}${i.completedAt ? `, ${formatTimestamp(i.completedAt)}` : ""}. They can change until the candidate is decided on.`
                    : "Record them after the interview. Recruitment reads them when deciding on the candidate."
                }
              />
              <div className="px-6 pb-6">
                <FeedbackForm id={i.id} existing={{ rating: i.rating, recommendation: i.recommendation, feedback: i.feedback }} />
              </div>
            </Card>
          ) : i.status === "Completed" ? (
            <Card>
              <CardHeader title="Notes" description={`Recorded by ${i.completedBy ?? "HR"}. The candidate has been decided on, so they no longer change.`} />
              <div className="px-6 pb-6">
                <p className="text-[13px] font-medium text-ink">
                  {i.rating ? `${i.rating} of 5` : "Not rated"}
                  {i.recommendation ? ` · ${RECOMMENDATION_LABEL[i.recommendation] ?? i.recommendation}` : ""}
                </p>
                <Paragraphs text={i.feedback} className="mt-2 text-[15px] leading-relaxed text-ink-hover" />
              </div>
            </Card>
          ) : (
            <Notice icon={<Info />}>
              {i.status === "Cancelled" || i.status === "No-show"
                ? `This round was marked ${INTERVIEW_LABEL[i.status].toLowerCase()}. There is nothing to record.`
                : "The candidate has been decided on, so there is nothing more to record."}
            </Notice>
          )}

          <Card>
            <CardHeader title="The role" description={`${r.code}, ${r.department}.`} />
            <div className="px-6 pb-6 text-[15px] leading-relaxed text-ink-hover">
              {r.description ? <Paragraphs text={r.description} /> : <p className="text-muted">No description.</p>}
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
              {experience ? <p className="mt-6 text-[13px] text-muted">Experience wanted: {experience}.</p> : null}
            </div>
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader title="When and where" />
            <div className="px-6 pb-4">
              <KeyValue>
                <KeyValueRow label="Date">{formatDate(i.scheduledDate)}</KeyValueRow>
                <KeyValueRow label="Time">{i.scheduledTime ? formatTime(i.scheduledTime) : "Not set"}</KeyValueRow>
                <KeyValueRow label="Length">{i.durationMinutes} minutes</KeyValueRow>
                <KeyValueRow label="How">{i.mode}</KeyValueRow>
                <KeyValueRow label="Interviewer">{i.interviewer}</KeyValueRow>
              </KeyValue>
              {i.location ? (
                <p className="mt-3 text-[13px] break-all">
                  {/^https?:\/\//i.test(i.location) ? (
                    <a href={i.location} target="_blank" rel="noopener noreferrer" className="font-medium text-ink underline underline-offset-2">
                      Join: {i.location}
                    </a>
                  ) : (
                    <span className="text-ink-hover">{i.location}</span>
                  )}
                </p>
              ) : null}
            </div>
          </Card>

          <Card>
            <CardHeader title={c.fullName} />
            <div className="px-6 pb-4">
              <KeyValue>
                <KeyValueRow label="Works at">{c.currentEmployer ?? "Not given"}</KeyValueRow>
                <KeyValueRow label="Experience">{c.experienceYears !== null ? `${c.experienceYears} years` : "Not given"}</KeyValueRow>
                <KeyValueRow label="Notice period">{c.noticePeriodDays !== null ? `${c.noticePeriodDays} days` : "Not given"}</KeyValueRow>
              </KeyValue>
              <div className="mt-3 flex flex-col gap-1.5 text-[13px]">
                {i.resume ? (
                  <a href={`/api/documents/${i.resume.id}`} className="inline-flex items-center gap-1.5 font-medium text-ink hover:underline">
                    <FileText className="size-4" />
                    {i.resume.fileName}
                  </a>
                ) : c.resumeLink ? (
                  <a href={c.resumeLink} target="_blank" rel="noopener noreferrer" className="font-medium text-ink hover:underline">
                    Resume (external link)
                  </a>
                ) : (
                  <span className="text-muted">No resume on file.</span>
                )}
                {c.profileLink ? (
                  <a href={c.profileLink} target="_blank" rel="noopener noreferrer" className="break-all text-secondary hover:underline">
                    {c.profileLink}
                  </a>
                ) : null}
              </div>
            </div>
          </Card>

          {i.coverNote ? (
            <Card>
              <CardHeader title="Their note" />
              <Paragraphs text={i.coverNote} className="px-6 pb-5 text-[13px] leading-relaxed text-ink-hover" />
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
