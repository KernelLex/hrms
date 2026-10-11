import { asc } from "drizzle-orm";
import { db } from "@/lib/db";
import { omLevelType } from "@/db/schema";
import { MasterScreen, type Column, type FieldDef } from "@/components/master-screen";
import { saveLevelType, deleteLevelType } from "@/app/actions/org";
import { Status } from "@/components/ui";

const COLUMNS: Column[] = [
  { key: "rank", label: "Rank", numeric: true },
  { key: "code", label: "Code" },
  { key: "name", label: "Level" },
  { key: "parent", label: "Sits under" },
  { key: "carries", label: "Carries" },
  { key: "status", label: "Status" },
];

export default async function LevelTypesPage() {
  const rows = await db.select().from(omLevelType).orderBy(asc(omLevelType.rank), asc(omLevelType.code));
  const name = new Map(rows.map((l) => [l.code, l.name]));

  const fields: FieldDef[] = [
    { kind: "text", name: "code", label: "Level code", required: true, placeholder: "DEPARTMENT", uppercase: true },
    { kind: "text", name: "name", label: "Level name", required: true, placeholder: "Department" },
    {
      kind: "select",
      name: "parentLevelTypeCode",
      label: "Sits under",
      options: rows.map((l) => ({ value: l.code, label: `${l.name} (${l.code})` })),
      emptyLabel: "Top of the hierarchy",
      hint: "Which level a unit of this level may be placed under.",
    },
    { kind: "text", name: "rank", label: "Rank", required: true, placeholder: "3", hint: "Order in the hierarchy, 0 at the top." },
    {
      kind: "checkbox",
      name: "isPayrollGroup",
      label: "Payroll runs against this level",
    },
    { kind: "checkbox", name: "isCalendarLevel", label: "A holiday calendar attaches here" },
    { kind: "checkbox", name: "isCostCentre", label: "Cost is booked here" },
    { kind: "checkbox", name: "isBusinessCentre", label: "Classified as a profit centre or shared services" },
    { kind: "checkbox", name: "isActive", label: "Active" },
  ];

  const carriesOf = (r: (typeof rows)[number]) => {
    const flags = [
      r.isPayrollGroup ? "Payroll group" : null,
      r.isCalendarLevel ? "Holiday calendar" : null,
      r.isCostCentre ? "Cost centre" : null,
      r.isBusinessCentre ? "Profit or shared" : null,
    ].filter(Boolean);
    return flags.length === 0 ? <span className="text-decor">&mdash;</span> : <span className="text-secondary">{flags.join(", ")}</span>;
  };

  return (
    <MasterScreen
      title="Org levels"
      subtitle="The shape of your hierarchy. Add or rename a level here and the whole organisation follows: nothing in the system reads a level by name, only by what you say it carries."
      entity="org level"
      columns={COLUMNS}
      idField="code"
      fields={fields}
      saveAction={saveLevelType}
      deleteAction={deleteLevelType}
      wideDialog
      emptyHint="Add the levels your organisation uses, from the top down."
      rows={rows.map((r) => ({
        id: r.code,
        describe: `${r.code} — ${r.name}`,
        cells: {
          rank: <span className="tabular text-secondary">{r.rank}</span>,
          code: <span className="font-medium text-ink">{r.code}</span>,
          name: r.name,
          parent: r.parentLevelTypeCode ? (
            <span className="text-secondary">{name.get(r.parentLevelTypeCode) ?? r.parentLevelTypeCode}</span>
          ) : (
            <span className="text-muted">Top of the hierarchy</span>
          ),
          carries: carriesOf(r),
          status: <Status tone={r.isActive ? "done" : "neutral"}>{r.isActive ? "Active" : "Inactive"}</Status>,
        },
        values: {
          code: r.code,
          name: r.name,
          parentLevelTypeCode: r.parentLevelTypeCode ?? "",
          rank: String(r.rank),
          isPayrollGroup: r.isPayrollGroup,
          isCalendarLevel: r.isCalendarLevel,
          isCostCentre: r.isCostCentre,
          isBusinessCentre: r.isBusinessCentre,
          isActive: r.isActive,
        },
      }))}
    />
  );
}
