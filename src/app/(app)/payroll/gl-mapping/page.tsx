import { requirePage } from "@/lib/access";
import { asc } from "drizzle-orm";
import { db } from "@/lib/db";
import { pyGlMapping, omCompany, pyWageType } from "@/db/schema";
import { MasterScreen, type Column, type FieldDef } from "@/components/master-screen";
import { saveGlMapping, deleteGlMapping } from "@/app/actions/statutory";
import { PayrollTabs } from "../tabs";

const COLUMNS: Column[] = [
  { key: "company", label: "Company" },
  { key: "wageType", label: "Wage type" },
  { key: "glAccount", label: "GL account" },
];

/** A per-company override of a wage type's default GL account. */
export default async function GlMappingPage() {
  await requirePage(["payroll.setup"], "/payroll/my-payslips");

  const [rows, companies, wageTypes] = await Promise.all([
    db.select().from(pyGlMapping),
    db.select().from(omCompany).orderBy(asc(omCompany.code)),
    db.select().from(pyWageType).orderBy(asc(pyWageType.sortOrder)),
  ]);
  const companyName = new Map(companies.map((c) => [c.code, c.name]));
  const wageTypeName = new Map(wageTypes.map((w) => [w.code, w.name]));

  const FIELDS: FieldDef[] = [
    { kind: "select", name: "companyCode", label: "Company", required: true, options: companies.map((c) => ({ value: c.code, label: `${c.code} — ${c.name}` })) },
    { kind: "select", name: "wageTypeCode", label: "Wage type", required: true, options: wageTypes.map((w) => ({ value: w.code, label: `${w.code} — ${w.name}` })) },
    { kind: "text", name: "glAccount", label: "GL account", required: true, placeholder: "5010" },
  ];

  return (
    <>
      <PayrollTabs />
      <MasterScreen
        title="GL mapping"
        subtitle="Overrides a wage type's default GL account for one company — the ERP's own chart of accounts, as far as it reaches HRMS."
        entity="GL mapping"
        columns={COLUMNS}
        idField="id"
        fields={FIELDS}
        saveAction={saveGlMapping}
        deleteAction={deleteGlMapping}
        emptyHint="Without a mapping, posting uses the wage type's own GL account for every company."
        rows={rows.map((r) => ({
          id: String(r.id),
          describe: `${r.wageTypeCode} at ${r.companyCode}`,
          cells: {
            company: <span className="font-medium text-ink">{companyName.get(r.companyCode) ?? r.companyCode}</span>,
            wageType: wageTypeName.get(r.wageTypeCode) ?? r.wageTypeCode,
            glAccount: <span className="tabular text-secondary">{r.glAccount}</span>,
          },
          values: { companyCode: r.companyCode, wageTypeCode: r.wageTypeCode, glAccount: r.glAccount },
        }))}
      />
    </>
  );
}
