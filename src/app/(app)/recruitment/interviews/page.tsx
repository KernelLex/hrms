import { redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { rcInterview, rcApplication, rcCandidate, rcRequisition } from "@/db/schema";
import { getSession, hasRole } from "@/lib/auth";
import { MasterScreen, type Column, type FieldDef } from "@/components/master-screen";
import { saveInterview, deleteInterview } from "@/app/actions/recruitment";
import { TwoLine } from "@/components/ui";
import { RecruitmentTabs } from "../tabs";
import { formatDate, formatTime } from "@/lib/dates";

const COLUMNS: Column[] = [
  { key: "candidate", label: "Candidate" },
  { key: "round", label: "Round" },
  { key: "interviewer", label: "Interviewer" },
  { key: "when", label: "When" },
  { key: "mode", label: "Mode" },
  { key: "rating", label: "Rating" },
  { key: "feedback", label: "Feedback" },
];

const ROUNDS = ["Screening call", "Technical round 1", "Technical round 2", "HR round"];
const MODES = ["Video call", "Onsite", "Phone"];

/** RC-04 — interview scheduling and feedback. */
export default async function InterviewsPage() {
  const session = await getSession();
  if (!hasRole(session, "HR_ADMIN")) redirect("/");

  const [rows, applications] = await Promise.all([
    db
      .select({
        id: rcInterview.id,
        applicationId: rcInterview.applicationId,
        round: rcInterview.round,
        interviewer: rcInterview.interviewer,
        scheduledDate: rcInterview.scheduledDate,
        scheduledTime: rcInterview.scheduledTime,
        mode: rcInterview.mode,
        rating: rcInterview.rating,
        feedback: rcInterview.feedback,
        candidateName: rcCandidate.fullName,
        requisitionCode: rcRequisition.code,
      })
      .from(rcInterview)
      .innerJoin(rcApplication, eq(rcApplication.id, rcInterview.applicationId))
      .innerJoin(rcCandidate, eq(rcCandidate.id, rcApplication.candidateId))
      .innerJoin(rcRequisition, eq(rcRequisition.id, rcApplication.requisitionId))
      .orderBy(desc(rcInterview.scheduledDate)),
    db
      .select({
        id: rcApplication.id,
        stage: rcApplication.stage,
        candidateName: rcCandidate.fullName,
        requisitionCode: rcRequisition.code,
      })
      .from(rcApplication)
      .innerJoin(rcCandidate, eq(rcCandidate.id, rcApplication.candidateId))
      .innerJoin(rcRequisition, eq(rcRequisition.id, rcApplication.requisitionId))
      .orderBy(desc(rcApplication.appliedDate)),
  ]);

  const dash = <span className="text-decor">&mdash;</span>;

  const fields: FieldDef[] = [
    {
      kind: "select",
      name: "applicationId",
      label: "Application",
      required: true,
      options: applications.map((a) => ({
        value: String(a.id),
        label: `${a.candidateName} — ${a.requisitionCode}`,
      })),
      emptyLabel: applications.length === 0 ? "No applications yet" : undefined,
    },
    {
      kind: "select",
      name: "round",
      label: "Round",
      required: true,
      options: ROUNDS.map((r) => ({ value: r, label: r })),
    },
    { kind: "text", name: "interviewer", label: "Interviewer", required: true, placeholder: "Ravi Kumar" },
    { kind: "date", name: "scheduledDate", label: "Date", required: true },
    { kind: "text", name: "scheduledTime", label: "Time", placeholder: "14:30" },
    {
      kind: "select",
      name: "mode",
      label: "Mode",
      required: true,
      options: MODES.map((m) => ({ value: m, label: m })),
    },
    {
      kind: "select",
      name: "rating",
      label: "Rating",
      options: ["1", "2", "3", "4", "5"].map((r) => ({ value: r, label: r })),
      emptyLabel: "Not yet rated",
    },
    {
      kind: "text",
      name: "feedback",
      label: "Feedback",
      full: true,
      placeholder: "Strong on system design, clear communicator.",
    },
  ];

  return (
    <>
      <RecruitmentTabs />
      <MasterScreen
        title="Interviews"
        subtitle="Rounds scheduled against an application, with the feedback that decides whether it advances."
        entity="interview"
        columns={COLUMNS}
        idField="id"
        fields={fields}
        saveAction={saveInterview}
        deleteAction={deleteInterview}
        wideDialog
        emptyHint="Schedule a round against one of the open applications."
        rows={rows.map((r) => ({
          id: String(r.id),
          describe: `${r.round} with ${r.candidateName}`,
          cells: {
            candidate: <TwoLine value={r.candidateName} sub={r.requisitionCode} />,
            round: <span className="font-medium text-ink">{r.round}</span>,
            interviewer: <span className="text-secondary">{r.interviewer}</span>,
            when: (
              <span className="tabular text-secondary">
                {formatDate(r.scheduledDate)}
                {r.scheduledTime ? `, ${formatTime(r.scheduledTime)}` : ""}
              </span>
            ),
            mode: <span className="text-secondary">{r.mode}</span>,
            rating: r.rating ? (
              <span className="tabular font-medium text-ink">{r.rating} of 5</span>
            ) : (
              dash
            ),
            feedback: r.feedback ? (
              <span className="text-secondary">{r.feedback}</span>
            ) : (
              dash
            ),
          },
          values: {
            applicationId: String(r.applicationId),
            round: r.round,
            interviewer: r.interviewer,
            scheduledDate: r.scheduledDate,
            scheduledTime: r.scheduledTime ?? "",
            mode: r.mode,
            rating: r.rating ? String(r.rating) : "",
            feedback: r.feedback ?? "",
          },
        }))}
      />
    </>
  );
}
