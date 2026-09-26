import { asc } from "drizzle-orm";
import { db } from "@/lib/db";
import { omPosition, omOrgUnit, omJob, OPEN_ENDED } from "@/db/schema";
import { MasterScreen, type Column, type FieldDef } from "@/components/master-screen";
import { savePosition, deletePosition } from "@/app/actions/org";
import { Status, TwoLine } from "@/components/ui";

const COLUMNS: Column[] = [
  { key: "code", label: "Code" },
  { key: "title", label: "Position" },
  { key: "department", label: "Department" },
  { key: "reportsTo", label: "Reports to" },
  { key: "occupancy", label: "Occupancy" },
  { key: "status", label: "Status" },
];

export default async function PositionsPage() {
  const [rows, units, jobs] = await Promise.all([
    db.select().from(omPosition).orderBy(asc(omPosition.code)),
    db.select().from(omOrgUnit).orderBy(asc(omOrgUnit.code)),
    db.select().from(omJob).orderBy(asc(omJob.code)),
  ]);

  const unitName = new Map(units.map((u) => [u.code, u.name]));
  const positionTitle = new Map(rows.map((p) => [p.code, p.title]));

  const fields: FieldDef[] = [
    { kind: "text", name: "code", label: "Position code", required: true, placeholder: "PS0001", uppercase: true },
    { kind: "text", name: "title", label: "Position title", required: true, placeholder: "Senior software engineer" },
    {
      kind: "select",
      name: "orgUnitCode",
      label: "Department",
      required: true,
      options: units.map((u) => ({ value: u.code, label: `${u.code} — ${u.name}` })),
    },
    {
      kind: "select",
      name: "jobCode",
      label: "Job",
      required: true,
      options: jobs.map((j) => ({ value: j.code, label: `${j.code} — ${j.title}` })),
    },
    {
      kind: "select",
      name: "reportsToCode",
      label: "Reports to",
      options: rows.map((p) => ({ value: p.code, label: `${p.code} — ${p.title}` })),
      emptyLabel: "Top position",
    },
    { kind: "date", name: "validFrom", label: "Valid from", required: true },
    { kind: "date", name: "validTo", label: "Valid to", hint: `Leave empty for ${OPEN_ENDED}.` },
    { kind: "checkbox", name: "isManager", label: "Manager position" },
    { kind: "checkbox", name: "isVacant", label: "Vacant — recruitment can open a requisition against it" },
    { kind: "checkbox", name: "isActive", label: "Active" },
  ];

  return (
    <MasterScreen
      title="Positions"
      subtitle="The individual chairs. Each points at a department and a job, and may report to another position."
      entity="position"
      columns={COLUMNS}
      idField="code"
      fields={fields}
      saveAction={savePosition}
      deleteAction={deletePosition}
      wideDialog
      emptyHint="Add a position once you have at least one department and one job."
      rows={rows.map((r) => ({
        id: r.code,
        describe: `${r.code} — ${r.title}`,
        cells: {
          code: <span className="font-medium text-ink">{r.code}</span>,
          title: (
            <TwoLine value={r.title} sub={r.isManager ? "Manager position" : undefined} />
          ),
          department: (
            <span className="text-secondary">
              {unitName.get(r.orgUnitCode) ?? r.orgUnitCode}
            </span>
          ),
          reportsTo: r.reportsToCode ? (
            <span className="text-secondary">
              {positionTitle.get(r.reportsToCode) ?? r.reportsToCode}
            </span>
          ) : (
            <span className="text-muted">Top position</span>
          ),
          // Vacancy is a state to act on, not a problem — outlined, not red.
          occupancy: (
            <Status tone={r.isVacant ? "action" : "done"}>
              {r.isVacant ? "Vacant" : "Filled"}
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
          title: r.title,
          orgUnitCode: r.orgUnitCode,
          jobCode: r.jobCode,
          reportsToCode: r.reportsToCode ?? "",
          validFrom: r.validFrom,
          validTo: r.validTo === OPEN_ENDED ? "" : r.validTo,
          isManager: r.isManager,
          isVacant: r.isVacant,
          isActive: r.isActive,
        },
      }))}
    />
  );
}
