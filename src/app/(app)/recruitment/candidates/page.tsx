import { redirect } from "next/navigation";
import { count, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { rcCandidate, rcApplication, rcRequisition } from "@/db/schema";
import { getSession, hasRole } from "@/lib/auth";
import { MasterScreen, type Column, type FieldDef } from "@/components/master-screen";
import { saveCandidate, deleteCandidate } from "@/app/actions/recruitment";
import { TwoLine } from "@/components/ui";
import { RecruitmentTabs } from "../tabs";
import { documentsFor } from "@/lib/storage";
import { ResumeCell } from "./resume";
import { Pagination, pageFrom } from "@/components/pagination";

const COLUMNS: Column[] = [
  { key: "code", label: "Candidate" },
  { key: "contact", label: "Contact" },
  { key: "source", label: "Source" },
  { key: "applications", label: "Applications", numeric: true },
  { key: "resume", label: "Resume" },
];

const SOURCES = ["Referral", "Job portal", "Campus", "Agency", "LinkedIn"];

/** RC-02 — applicant master data. */
export default async function CandidatesPage(props: {
  searchParams: Promise<{ page?: string }>;
}) {
  const session = await getSession();
  if (!hasRole(session, "HR_ADMIN")) redirect("/");
  const { page, limit, offset } = pageFrom((await props.searchParams).page);

  const [rows, [{ n: total }], openRequisitions] = await Promise.all([
    db.select().from(rcCandidate).orderBy(desc(rcCandidate.id)).limit(limit).offset(offset),
    db.select({ n: count() }).from(rcCandidate),
    db
      .select()
      .from(rcRequisition)
      .where(eq(rcRequisition.status, "Open"))
      .orderBy(desc(rcRequisition.postedDate)),
  ]);

  // Application counts for this page of candidates only.
  const appCounts = rows.length
    ? await db
        .select({ candidateId: rcApplication.candidateId, n: count() })
        .from(rcApplication)
        .where(inArray(rcApplication.candidateId, rows.map((r) => r.id)))
        .groupBy(rcApplication.candidateId)
    : [];

  const applications = new Map(appCounts.map((a) => [a.candidateId, a.n]));
  const resumes = await documentsFor(
    "candidate",
    rows.map((r) => r.id),
  );
  const resumeOf = new Map<number, (typeof resumes)[number]>();
  for (const d of resumes) if (d.kind === "Resume" && !resumeOf.has(d.ownerId)) resumeOf.set(d.ownerId, d);
  const safeLink = (link: string | null) => (link && /^https?:\/\//i.test(link) ? link : null);

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
      hint: "Optional, for a resume kept elsewhere. Upload the file itself from the list.",
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
        total={total}
        footer={<Pagination page={page} total={total} path="/recruitment/candidates" noun="candidates" />}
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
            resume: (
              <ResumeCell
                candidateId={r.id}
                candidateName={r.fullName}
                doc={resumeOf.get(r.id) ?? null}
                link={safeLink(r.resumeLink)}
              />
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
