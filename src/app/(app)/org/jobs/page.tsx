import { asc } from "drizzle-orm";
import { db } from "@/lib/db";
import { omJob, omJobFamily } from "@/db/schema";
import { MasterScreen, type Column, type FieldDef } from "@/components/master-screen";
import { saveJob, deleteJob } from "@/app/actions/org";
import { Status, TwoLine } from "@/components/ui";

const COLUMNS: Column[] = [
  { key: "code", label: "Code" },
  { key: "title", label: "Job title" },
  { key: "family", label: "Job family" },
  { key: "description", label: "Description" },
  { key: "status", label: "Status" },
];

export default async function JobsPage() {
  const [rows, families] = await Promise.all([
    db.select().from(omJob).orderBy(asc(omJob.code)),
    db.select().from(omJobFamily).orderBy(asc(omJobFamily.code)),
  ]);
  const familyName = new Map(families.map((f) => [f.code, f.name]));

  const fields: FieldDef[] = [
    { kind: "text", name: "code", label: "Job code", required: true, placeholder: "JB0001", uppercase: true },
    { kind: "text", name: "title", label: "Job title", required: true, placeholder: "Software engineer" },
    {
      kind: "select",
      name: "jobFamilyCode",
      label: "Job family",
      required: true,
      options: families.filter((f) => f.isActive).map((f) => ({ value: f.code, label: `${f.code} — ${f.name}` })),
      emptyLabel: families.length === 0 ? "No job families yet" : undefined,
    },
    {
      kind: "text",
      name: "description",
      label: "Description",
      full: true,
      placeholder: "Develops and maintains applications",
    },
    { kind: "checkbox", name: "isActive", label: "Active" },
  ];

  return (
    <MasterScreen
      title="Jobs"
      subtitle="Generic job classifications, independent of the org chart. Each belongs to a job family, and positions point at one."
      entity="job"
      columns={COLUMNS}
      idField="code"
      fields={fields}
      saveAction={saveJob}
      deleteAction={deleteJob}
      emptyHint="Define the job classifications your positions will draw from."
      rows={rows.map((r) => ({
        id: r.code,
        describe: `${r.code} — ${r.title}`,
        cells: {
          code: <span className="font-medium text-ink">{r.code}</span>,
          title: r.title,
          family: r.jobFamilyCode ? (
            <TwoLine value={r.jobFamilyCode} sub={familyName.get(r.jobFamilyCode)} />
          ) : (
            <span className="text-decor">&mdash;</span>
          ),
          description: (
            <span className="text-secondary">
              {r.description ?? <span className="text-decor">&mdash;</span>}
            </span>
          ),
          status: (
            <Status tone={r.isActive ? "done" : "neutral"}>
              {r.isActive ? "Active" : "Inactive"}
            </Status>
          ),
        },
        values: {
          code: r.code,
          title: r.title,
          jobFamilyCode: r.jobFamilyCode ?? "",
          description: r.description ?? "",
          isActive: r.isActive,
        },
      }))}
    />
  );
}
