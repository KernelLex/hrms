import { asc } from "drizzle-orm";
import { db } from "@/lib/db";
import { omPersonnelArea, omCompany } from "@/db/schema";
import { MasterScreen, type Column, type FieldDef } from "@/components/master-screen";
import { saveArea, deleteArea } from "@/app/actions/org";
import { Status, TwoLine } from "@/components/ui";

const COLUMNS: Column[] = [
  { key: "code", label: "Code" },
  { key: "name", label: "Area" },
  { key: "company", label: "Company" },
  { key: "location", label: "Location" },
  { key: "status", label: "Status" },
];

export default async function PersonnelAreasPage() {
  const [rows, companies] = await Promise.all([
    db.select().from(omPersonnelArea).orderBy(asc(omPersonnelArea.code)),
    db.select().from(omCompany).orderBy(asc(omCompany.code)),
  ]);

  const companyName = new Map(companies.map((c) => [c.code, c.name]));

  const fields: FieldDef[] = [
    { kind: "text", name: "code", label: "Area code", required: true, placeholder: "PA01", uppercase: true },
    {
      kind: "select",
      name: "companyCode",
      label: "Company",
      required: true,
      options: companies.map((c) => ({ value: c.code, label: `${c.code} — ${c.name}` })),
      emptyLabel: companies.length === 0 ? "No companies yet" : undefined,
    },
    { kind: "text", name: "name", label: "Area name", required: true, placeholder: "Head office" },
    { kind: "text", name: "location", label: "Location", full: true, placeholder: "Bengaluru campus" },
    { kind: "checkbox", name: "isActive", label: "Active" },
  ];

  return (
    <MasterScreen
      title="Personnel areas"
      subtitle="Locations and plants under a company. Payroll periods are released per area."
      entity="personnel area"
      columns={COLUMNS}
      idField="code"
      fields={fields}
      saveAction={saveArea}
      deleteAction={deleteArea}
      emptyHint="Add a location or plant under one of your companies."
      rows={rows.map((r) => ({
        id: r.code,
        describe: `${r.code} — ${r.name}`,
        cells: {
          code: <span className="font-medium text-ink">{r.code}</span>,
          name: r.name,
          company: (
            <TwoLine value={r.companyCode} sub={companyName.get(r.companyCode)} />
          ),
          location: r.location ?? <span className="text-decor">&mdash;</span>,
          status: (
            <Status tone={r.isActive ? "done" : "neutral"}>
              {r.isActive ? "Active" : "Inactive"}
            </Status>
          ),
        },
        values: {
          code: r.code,
          companyCode: r.companyCode,
          name: r.name,
          location: r.location ?? "",
          isActive: r.isActive,
        },
      }))}
    />
  );
}
