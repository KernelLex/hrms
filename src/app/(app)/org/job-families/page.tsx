import { asc, count } from "drizzle-orm";
import { db } from "@/lib/db";
import { omJob, omJobFamily } from "@/db/schema";
import { MasterScreen, type Column, type FieldDef } from "@/components/master-screen";
import { saveJobFamily, deleteJobFamily } from "@/app/actions/org";
import { Status } from "@/components/ui";

const COLUMNS: Column[] = [
  { key: "code", label: "Code" },
  { key: "name", label: "Job family" },
  { key: "jobs", label: "Jobs", numeric: true },
  { key: "status", label: "Status" },
];

const FIELDS: FieldDef[] = [
  { kind: "text", name: "code", label: "Family code", required: true, placeholder: "IT", uppercase: true },
  { kind: "text", name: "name", label: "Family name", required: true, placeholder: "Information technology" },
  { kind: "checkbox", name: "isActive", label: "Active" },
];

export default async function JobFamiliesPage() {
  const [rows, jobCounts] = await Promise.all([
    db.select().from(omJobFamily).orderBy(asc(omJobFamily.code)),
    db.select({ family: omJob.jobFamilyCode, n: count() }).from(omJob).groupBy(omJob.jobFamilyCode),
  ]);
  const jobs = new Map(jobCounts.map((j) => [j.family, j.n]));

  return (
    <MasterScreen
      title="Job families"
      subtitle="Groups of similar jobs across the whole organisation, cutting across the hierarchy. Manufacturing, IT, HR."
      entity="job family"
      columns={COLUMNS}
      idField="code"
      fields={FIELDS}
      saveAction={saveJobFamily}
      deleteAction={deleteJobFamily}
      emptyHint="Add the families your jobs group into."
      rows={rows.map((r) => ({
        id: r.code,
        describe: `${r.code} — ${r.name}`,
        cells: {
          code: <span className="font-medium text-ink">{r.code}</span>,
          name: r.name,
          jobs: <span className="tabular text-secondary">{jobs.get(r.code) ?? 0}</span>,
          status: <Status tone={r.isActive ? "done" : "neutral"}>{r.isActive ? "Active" : "Inactive"}</Status>,
        },
        values: { code: r.code, name: r.name, isActive: r.isActive },
      }))}
    />
  );
}
