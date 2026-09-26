import { asc } from "drizzle-orm";
import { db } from "@/lib/db";
import { omPersonnelSubArea, omPersonnelArea } from "@/db/schema";
import { MasterScreen, type Column, type FieldDef } from "@/components/master-screen";
import { saveSubArea, deleteSubArea } from "@/app/actions/org";
import { Status, TwoLine } from "@/components/ui";

const COLUMNS: Column[] = [
  { key: "code", label: "Code" },
  { key: "name", label: "Sub-area" },
  { key: "area", label: "Personnel area" },
  { key: "status", label: "Status" },
];

export default async function SubAreasPage() {
  const [rows, areas] = await Promise.all([
    db.select().from(omPersonnelSubArea).orderBy(asc(omPersonnelSubArea.code)),
    db.select().from(omPersonnelArea).orderBy(asc(omPersonnelArea.code)),
  ]);

  const areaName = new Map(areas.map((a) => [a.code, a.name]));

  const fields: FieldDef[] = [
    { kind: "text", name: "code", label: "Sub-area code", required: true, placeholder: "PSA01", uppercase: true },
    {
      kind: "select",
      name: "areaCode",
      label: "Personnel area",
      required: true,
      options: areas.map((a) => ({ value: a.code, label: `${a.code} — ${a.name}` })),
      emptyLabel: areas.length === 0 ? "No personnel areas yet" : undefined,
    },
    { kind: "text", name: "name", label: "Sub-area name", required: true, full: true, placeholder: "Day shift" },
    { kind: "checkbox", name: "isActive", label: "Active" },
  ];

  return (
    <MasterScreen
      title="Sub-areas"
      subtitle="Divisions within a personnel area, such as a shift or a site."
      entity="sub-area"
      columns={COLUMNS}
      idField="code"
      fields={fields}
      saveAction={saveSubArea}
      deleteAction={deleteSubArea}
      emptyHint="Add a shift or site under one of your personnel areas."
      rows={rows.map((r) => ({
        id: r.code,
        describe: `${r.code} — ${r.name}`,
        cells: {
          code: <span className="font-medium text-ink">{r.code}</span>,
          name: r.name,
          area: <TwoLine value={r.areaCode} sub={areaName.get(r.areaCode)} />,
          status: (
            <Status tone={r.isActive ? "done" : "neutral"}>
              {r.isActive ? "Active" : "Inactive"}
            </Status>
          ),
        },
        values: {
          code: r.code,
          areaCode: r.areaCode,
          name: r.name,
          isActive: r.isActive,
        },
      }))}
    />
  );
}
