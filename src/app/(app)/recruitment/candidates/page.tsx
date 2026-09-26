import { redirect } from "next/navigation";
import { desc, eq, count } from "drizzle-orm";
import { db } from "@/lib/db";
import { rcCandidate, rcApplication, rcRequisition } from "@/db/schema";
import { getSession, hasRole } from "@/lib/auth";
import { MasterScreen, type Column, type FieldDef } from "@/components/master-screen";
import { saveCandidate, deleteCandidate } from "@/app/actions/recruitment";
import { TwoLine } from "@/components/ui";
import { RecruitmentTabs } from "../tabs";

const COLUMNS: Column[] = [
  { key: "code", label: "Candidate" },
  { key: "contact", label: "Contact" },
  { key: "source", label: "Source" },
  { key: "applications", label: "Applications", numeric: true },
  { key: "resume", label: "Resume" },
];

const SOURCES = ["Referral", "Job portal", "Campus", "Agency", "LinkedIn"];

/** RC-02 — applicant master data. */
export default async function CandidatesPage() {
  const session = await getSession();
  if (!hasRole(session, "HR_ADMIN")) redirect("/");

  const [rows, openRequisitions, appCounts] = await Promise.all([
    db.select().from(rcCandidate).orderBy(desc(rcCandidate.id)),
    db
      .select()
      .from(rcRequisition)
      .where(eq(rcRequisition.status, "Open"))
      .orderBy(desc(rcRequisition.postedDate)),
    db
      .select({ candidateId: rcApplication.candidateId, n: count() })
      .from(rcApplication)
      .groupBy(rcApplication.candidateId),
  ]);

  const applications = new Map(appCounts.map((a) => [a.candidateId, a.n]));
  const dash = <span className="text-decor">&mdash;</span>;

  const fields: FieldDef[] = [
    { kind: "text", name: "fullName", label: "Full name", required: true, placeholder: "Kavya Iyer" },
    { kind: "text", name: "email", label: "Email", required: true, placeholder: "kavya.iyer@example.com" },
    { kind: "text", name: "phone", label: "Phone", placeholder: "+91 98765 43210" },
    {
      kind: "select",
      name: "source",
      label: "Source",
      required: true,
      options: SOURCES.map((s) => ({ value: s, label: s })),
    },
    {
      kind: "text",
      name: "resumeLink",
      label: "Resume link",
      full: true,
      placeholder: "https://…",
      hint: "Becomes a file upload when document storage is wired up in phase 9.",
    },
    {
      kind: "select",
      name: "requisitionId",
      label: "Apply to requisition",
      options: openRequisitions.map((r) => ({ value: String(r.id), label: r.code })),
      emptyLabel: "Do not apply yet",
      hint: "Creates the application straight away. Only on a new candidate.",
    },
  ];

  return (
    <>
      <RecruitmentTabs />
      <MasterScreen
        title="Candidates"
        subtitle="People who have applied. A candidate can apply to more than one requisition."
        entity="candidate"
        columns={COLUMNS}
        idField="code"
        fields={fields}
        saveAction={saveCandidate}
        deleteAction={deleteCandidate}
        wideDialog
        emptyHint="Add a candidate, and optionally apply them to an open requisition."
        rows={rows.map((r) => ({
          id: r.code,
          describe: `${r.code} — ${r.fullName}`,
          cells: {
            code: <TwoLine value={r.fullName} sub={r.code} />,
            contact: <TwoLine value={r.email} sub={r.phone ?? undefined} />,
            source: <span className="text-secondary">{r.source}</span>,
            applications: String(applications.get(r.id) ?? 0),
            resume: r.resumeLink ? (
              <a
                href={r.resumeLink}
                target="_blank"
                rel="noreferrer"
                className="text-[13px] font-medium text-ink hover:underline"
              >
                Open
              </a>
            ) : (
              dash
            ),
          },
          values: {
            fullName: r.fullName,
            email: r.email,
            phone: r.phone ?? "",
            source: r.source,
            resumeLink: r.resumeLink ?? "",
            requisitionId: "",
          },
        }))}
      />
    </>
  );
}
