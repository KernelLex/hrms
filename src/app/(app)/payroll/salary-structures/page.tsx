import Link from "next/link";
import { requirePage } from "@/lib/access";
import { asc } from "drizzle-orm";
import { db } from "@/lib/db";
import { pySalaryStructure, pySalaryStructureComponent } from "@/db/schema";
import { MasterScreen, type Column, type FieldDef } from "@/components/master-screen";
import { saveSalaryStructure, deleteSalaryStructure } from "@/app/actions/statutory";
import { Status } from "@/components/ui";
import { PayrollTabs } from "../tabs";

const COLUMNS: Column[] = [
  { key: "code", label: "Code" },
  { key: "name", label: "Structure" },
  { key: "status", label: "Status" },
  { key: "components", label: "Components" },
];

const FIELDS: FieldDef[] = [
  { kind: "text", name: "code", label: "Structure code", required: true, placeholder: "STANDARD", uppercase: true },
  { kind: "text", name: "name", label: "Structure name", required: true },
  { kind: "checkbox", name: "isActive", label: "Active" },
];

/** How an annual CTC breaks into monthly wage types. */
export default async function SalaryStructuresPage() {
  await requirePage(["payroll.setup"], "/payroll/my-payslips");

  const [rows, components] = await Promise.all([
    db.select().from(pySalaryStructure).orderBy(asc(pySalaryStructure.name)),
    db.select().from(pySalaryStructureComponent),
  ]);
  const componentCount = new Map<string, number>();
  for (const c of components) componentCount.set(c.structureCode, (componentCount.get(c.structureCode) ?? 0) + 1);

  return (
    <>
      <PayrollTabs />
      <MasterScreen
        title="Salary structures"
        subtitle="How an annual CTC splits into basic, allowances and employer contributions. Open one to set its components."
        entity="salary structure"
        columns={COLUMNS}
        idField="code"
        fields={FIELDS}
        saveAction={saveSalaryStructure}
        deleteAction={deleteSalaryStructure}
        emptyHint="Add a structure, then open it to define its components."
        rows={rows.map((r) => ({
          id: r.code,
          describe: `${r.code} — ${r.name}`,
          cells: {
            code: (
              <Link href={`/payroll/salary-structures/${r.code}`} className="font-medium text-ink underline underline-offset-2">
                {r.code}
              </Link>
            ),
            name: r.name,
            status: <Status tone={r.isActive ? "done" : "neutral"}>{r.isActive ? "Active" : "Inactive"}</Status>,
            components: <span className="text-secondary">{componentCount.get(r.code) ?? 0} component{(componentCount.get(r.code) ?? 0) === 1 ? "" : "s"}</span>,
          },
          values: { code: r.code, name: r.name, isActive: r.isActive },
        }))}
      />
    </>
  );
}
