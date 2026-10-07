import { rawClient } from "@/lib/db";
import { requirePage } from "@/lib/access";
import { listScorecardCriteria } from "@/lib/repositories/recruitment";
import { saveScorecardCriterion, deleteScorecardCriterion } from "@/app/actions/recruitment";
import { MasterScreen, type Column, type FieldDef } from "@/components/master-screen";
import { PageHeader, TwoLine } from "@/components/ui";
import { RecruitmentTabs } from "../tabs";

const COLUMNS: Column[] = [
  { key: "job", label: "Job" },
  { key: "criterion", label: "Rated on" },
  { key: "weight", label: "Weight", numeric: true },
  { key: "order", label: "Order", numeric: true },
  { key: "active", label: "Active" },
];

/**
 * The scorecard each job's interviewers fill in. The criteria are rows HR
 * keeps, not a list fixed in the software, and a round for a job that has
 * them cannot be saved until every active one is rated.
 */
export default async function ScorecardsPage() {
  await requirePage(["recruitment.manage"], "/");

  const [criteria, jobs] = await Promise.all([
    listScorecardCriteria(),
    rawClient().execute("SELECT code, title FROM om_job ORDER BY title"),
  ]);

  const fields: FieldDef[] = [
    {
      kind: "select",
      name: "jobCode",
      label: "Job",
      required: true,
      options: jobs.rows.map((j) => ({ value: String(j.code), label: `${String(j.code)} — ${String(j.title)}` })),
    },
    { kind: "text", name: "criterion", label: "Rated on", required: true, full: true, placeholder: "Problem solving" },
    { kind: "text", name: "weight", label: "Weight", hint: "1 to 10. How much this criterion counts next to the others." },
    { kind: "text", name: "sortOrder", label: "Order", hint: "Lower numbers come first on the interviewer's form." },
    { kind: "checkbox", name: "isActive", label: "Active" },
  ];

  return (
    <>
      <RecruitmentTabs />
      <PageHeader
        title="Scorecards"
        subtitle="What interviewers rate a candidate on, chosen per job. A job with no criteria leaves the interviewer their overall rating and notes."
      />

      <MasterScreen
        title="Criteria"
        subtitle="Each one is rated from 1 to 5 on every round for that job."
        entity="criterion"
        columns={COLUMNS}
        idField="id"
        fields={fields}
        saveAction={saveScorecardCriterion}
        deleteAction={deleteScorecardCriterion}
        emptyHint="Add what interviewers should rate for a job."
        rows={criteria.map((c) => ({
          id: String(c.id),
          describe: `${c.criterion} on ${c.jobTitle}`,
          cells: {
            job: <TwoLine value={c.jobTitle} sub={c.jobCode} />,
            criterion: <span className="font-medium text-ink">{c.criterion}</span>,
            weight: c.weight,
            order: c.sortOrder,
            active: c.isActive ? "Yes" : "No",
          },
          values: {
            id: String(c.id),
            jobCode: c.jobCode,
            criterion: c.criterion,
            weight: String(c.weight),
            sortOrder: String(c.sortOrder),
            isActive: c.isActive ? "1" : "0",
          },
        }))}
      />
    </>
  );
}
