import { asc } from "drizzle-orm";
import { db } from "@/lib/db";
import { omOrgUnit, omCompany, omPersonnelArea, OPEN_ENDED } from "@/db/schema";
import { MasterScreen, type Column, type FieldDef } from "@/components/master-screen";
import { saveOrgUnit, deleteOrgUnit } from "@/app/actions/org";
import { Status } from "@/components/ui";
import { formatDateRange } from "@/lib/dates";

const COLUMNS: Column[] = [
  { key: "code", label: "Code" },
  { key: "name", label: "Department" },
  { key: "parent", label: "Reports into" },
  { key: "company", label: "Company" },
  { key: "validity", label: "Valid" },
  { key: "status", label: "Status" },
];

export default async function DepartmentsPage() {
  const [rows, companies, areas] = await Promise.all([
    db.select().from(omOrgUnit).orderBy(asc(omOrgUnit.code)),
    db.select().from(omCompany).orderBy(asc(omCompany.code)),
    db.select().from(omPersonnelArea).orderBy(asc(omPersonnelArea.code)),
  ]);

  const unitName = new Map(rows.map((u) => [u.code, u.name]));

  const fields: FieldDef[] = [
    { kind: "text", name: "code", label: "Department code", required: true, placeholder: "OU0001", uppercase: true },
    { kind: "text", name: "name", label: "Department name", required: true, placeholder: "Information technology" },
    {
      kind: "select",
      name: "parentCode",
      label: "Reports into",
      options: rows.map((u) => ({ value: u.code, label: `${u.code} — ${u.name}` })),
      emptyLabel: "Top level",
      hint: "Leave as top level for a division that reports to nobody.",
    },
    {
      kind: "select",
      name: "companyCode",
      label: "Company",
      required: true,
      options: companies.map((c) => ({ value: c.code, label: `${c.code} — ${c.name}` })),
    },
    {
      kind: "select",
      name: "areaCode",
      label: "Personnel area",
      options: areas.map((a) => ({ value: a.code, label: `${a.code} — ${a.name}` })),
      emptyLabel: "None",
    },
    { kind: "date", name: "validFrom", label: "Valid from", required: true },
    { kind: "date", name: "validTo", label: "Valid to", hint: `Leave empty for ${OPEN_ENDED}.` },
    { kind: "checkbox", name: "isActive", label: "Active" },
  ];

  return (
    <MasterScreen
      title="Departments"
      subtitle="The department tree. A department may sit under another, and carries validity dates so the structure has a history."
      entity="department"
      columns={COLUMNS}
      idField="code"
      fields={fields}
      saveAction={saveOrgUnit}
      deleteAction={deleteOrgUnit}
      wideDialog
      emptyHint="Add the first department to start the tree."
      rows={rows.map((r) => ({
        id: r.code,
        describe: `${r.code} — ${r.name}`,
        cells: {
          code: <span className="font-medium text-ink">{r.code}</span>,
          name: r.name,
          parent: r.parentCode ? (
            <span className="text-secondary">
              {r.parentCode} — {unitName.get(r.parentCode) ?? "unknown"}
            </span>
          ) : (
            <span className="text-muted">Top level</span>
          ),
          company: r.companyCode,
          validity: (
            <span className="tabular text-secondary">
              {formatDateRange(r.validFrom, r.validTo)}
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
          name: r.name,
          parentCode: r.parentCode ?? "",
          companyCode: r.companyCode,
          areaCode: r.areaCode ?? "",
          validFrom: r.validFrom,
          validTo: r.validTo === OPEN_ENDED ? "" : r.validTo,
          isActive: r.isActive,
        },
      }))}
    />
  );
}
