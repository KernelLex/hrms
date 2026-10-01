import { requirePage } from "@/lib/access";
import { db } from "@/lib/db";
import { omJob } from "@/db/schema";
import { certificationComplianceReport, listCertificationRequirements } from "@/lib/repositories/training";
import { saveCertificationRequirement, deleteCertificationRequirement } from "@/app/actions/training";
import { MasterScreen, type Column, type FieldDef } from "@/components/master-screen";
import { Card, CardHeader, PageHeader, Table, Th, Tr, Td, EmptyState } from "@/components/ui";
import { TrainingTabs } from "../tabs";

const COLUMNS: Column[] = [
  { key: "job", label: "Job" },
  { key: "name", label: "Certification required" },
];

/** Who needs a certification their job requires and does not currently hold, valid and not expired. */
export default async function CompliancePage() {
  await requirePage(["training.manage"], "/training/my-training");
  const [report, requirements, jobs] = await Promise.all([certificationComplianceReport(), listCertificationRequirements(), db.select().from(omJob)]);

  const fields: FieldDef[] = [
    { kind: "select", name: "jobCode", label: "Job", required: true, options: jobs.map((j) => ({ value: j.code, label: j.title })) },
    { kind: "text", name: "name", label: "Certification", required: true, placeholder: "Forklift license" },
  ];

  return (
    <>
      <TrainingTabs />
      <PageHeader title="Certification compliance" subtitle="Which jobs require a certification, and who is missing one." />

      <Card>
        <CardHeader title="Anyone missing a required certification" />
        {report.length === 0 ? (
          <EmptyState title="Nobody is missing a required certification" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Employee</Th>
                <Th>Job</Th>
                <Th>Missing</Th>
              </tr>
            </thead>
            <tbody>
              {report.map((r) => (
                <Tr key={r.employeeId}>
                  <Td>
                    <span className="font-medium text-ink">{r.employeeName}</span>
                  </Td>
                  <Td>
                    <span className="text-secondary">{r.jobTitle}</span>
                  </Td>
                  <Td>{r.missing.join(", ")}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <div className="mt-6">
        <MasterScreen
          title="Requirements"
          subtitle="Which jobs require a named certification."
          entity="requirement"
          columns={COLUMNS}
          idField="id"
          fields={fields}
          saveAction={saveCertificationRequirement}
          deleteAction={deleteCertificationRequirement}
          allowEdit={false}
          emptyHint="Add a job's certification requirement."
          rows={requirements.map((r) => ({
            id: String(r.id),
            describe: `${r.jobTitle} — ${r.name}`,
            cells: { job: r.jobTitle, name: r.name },
            values: { jobCode: r.jobCode, name: r.name },
          }))}
        />
      </div>
    </>
  );
}
