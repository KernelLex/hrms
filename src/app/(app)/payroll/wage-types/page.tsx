import { requirePage } from "@/lib/access";
import { asc } from "drizzle-orm";
import { db } from "@/lib/db";
import { pyWageType } from "@/db/schema";
import { MasterScreen, type Column, type FieldDef } from "@/components/master-screen";
import { saveWageType, deleteWageType } from "@/app/actions/payroll";
import { Status } from "@/components/ui";
import { PayrollTabs } from "../tabs";

const COLUMNS: Column[] = [
  { key: "code", label: "Code" },
  { key: "name", label: "Wage type" },
  { key: "kind", label: "Kind" },
  { key: "basis", label: "Amount" },
  { key: "taxable", label: "Taxable" },
  { key: "status", label: "Status" },
];

const FIELDS: FieldDef[] = [
  { kind: "text", name: "code", label: "Wage type code", required: true, placeholder: "HRA", uppercase: true },
  { kind: "text", name: "name", label: "Wage type name", required: true, placeholder: "House rent allowance" },
  {
    kind: "select",
    name: "kind",
    label: "Kind",
    required: true,
    options: [
      { value: "Earning", label: "Earning" },
      { value: "Deduction", label: "Deduction" },
    ],
  },
  {
    kind: "select",
    name: "amountType",
    label: "Amount type",
    required: true,
    options: [
      { value: "Fixed", label: "Fixed amount" },
      { value: "PercentOfBasic", label: "Percentage of basic" },
      { value: "Formula", label: "Formula" },
    ],
  },
  {
    kind: "text",
    name: "percent",
    label: "Percentage of basic",
    hint: "Only used when the amount type is a percentage. 40 means 40%.",
  },
  { kind: "text", name: "glAccount", label: "GL account", placeholder: "5010" },
  { kind: "text", name: "sortOrder", label: "Sort order", hint: "Lower numbers appear first on the payslip." },
  { kind: "checkbox", name: "isTaxable", label: "Taxable" },
  { kind: "checkbox", name: "isAutomatic", label: "Generated automatically by the run" },
  { kind: "checkbox", name: "isActive", label: "Active" },
];

/** PY-02 — the wage type master. */
export default async function WageTypesPage() {
  await requirePage(["payroll.setup"], "/payroll/my-payslips");

  const rows = await db.select().from(pyWageType).orderBy(asc(pyWageType.sortOrder));

  return (
    <>
      <PayrollTabs />
      <MasterScreen
        title="Wage types"
        subtitle="Everything that can be earned or deducted. The run reads these to build each payslip line."
        entity="wage type"
        columns={COLUMNS}
        idField="code"
        fields={FIELDS}
        saveAction={saveWageType}
        deleteAction={deleteWageType}
        wideDialog
        emptyHint="Define the earnings and deductions your payroll uses."
        rows={rows.map((r) => ({
          id: r.code,
          describe: `${r.code} — ${r.name}`,
          cells: {
            code: <span className="font-medium text-ink">{r.code}</span>,
            name: r.name,
            kind: <span className="text-secondary">{r.kind}</span>,
            basis:
              r.amountType === "PercentOfBasic" && r.percentBasisPoints ? (
                <span className="tabular">{(r.percentBasisPoints / 100).toFixed(0)}% of basic</span>
              ) : r.amountType === "Formula" ? (
                <span className="text-secondary">{r.formulaKey ?? "Formula"}</span>
              ) : (
                <span className="text-secondary">Fixed</span>
              ),
            taxable: (
              <Status tone={r.isTaxable ? "done" : "neutral"}>
                {r.isTaxable ? "Taxable" : "Exempt"}
              </Status>
            ),
            status: (
              <Status tone={r.isActive ? "done" : "neutral"}>
                {r.isActive ? "Active" : "Inactive"}
              </Status>
            ),
          },
          values: {
            code: r.code,
            name: r.name,
            kind: r.kind,
            amountType: r.amountType,
            percent: r.percentBasisPoints ? String(r.percentBasisPoints / 100) : "",
            formulaKey: r.formulaKey ?? "",
            glAccount: r.glAccount ?? "",
            sortOrder: String(r.sortOrder),
            isTaxable: r.isTaxable,
            isAutomatic: r.isAutomatic,
            isActive: r.isActive,
          },
        }))}
      />
    </>
  );
}
