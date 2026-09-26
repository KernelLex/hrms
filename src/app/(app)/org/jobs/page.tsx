import { asc } from "drizzle-orm";
import { db } from "@/lib/db";
import { omJob } from "@/db/schema";
import { MasterScreen, type Column, type FieldDef } from "@/components/master-screen";
import { saveJob, deleteJob } from "@/app/actions/org";
import { Status } from "@/components/ui";

const JOB_GROUPS = ["IT", "Finance", "HR", "Sales", "Admin", "Operations"];

const COLUMNS: Column[] = [
  { key: "code", label: "Code" },
  { key: "title", label: "Job title" },
  { key: "group", label: "Group" },
  { key: "description", label: "Description" },
  { key: "status", label: "Status" },
];

const FIELDS: FieldDef[] = [
  { kind: "text", name: "code", label: "Job code", required: true, placeholder: "JB0001", uppercase: true },
  { kind: "text", name: "title", label: "Job title", required: true, placeholder: "Software engineer" },
  {
    kind: "select",
    name: "jobGroup",
    label: "Job group",
    options: JOB_GROUPS.map((g) => ({ value: g, label: g })),
    emptyLabel: "None",
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

export default async function JobsPage() {
  const rows = await db.select().from(omJob).orderBy(asc(omJob.code));

  return (
    <MasterScreen
      title="Jobs"
      subtitle="Generic job classifications, independent of the org chart. Positions point at one."
      entity="job"
      columns={COLUMNS}
      idField="code"
      fields={FIELDS}
      saveAction={saveJob}
      deleteAction={deleteJob}
      emptyHint="Define the job classifications your positions will draw from."
      rows={rows.map((r) => ({
        id: r.code,
        describe: `${r.code} — ${r.title}`,
        cells: {
          code: <span className="font-medium text-ink">{r.code}</span>,
          title: r.title,
          group: r.jobGroup ?? <span className="text-decor">&mdash;</span>,
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
          jobGroup: r.jobGroup ?? "",
          description: r.description ?? "",
          isActive: r.isActive,
        },
      }))}
    />
  );
}
