import { asc } from "drizzle-orm";
import { db } from "@/lib/db";
import { omOrgUnit, omCompany, omLevelType, ptHolidayCalendar, OPEN_ENDED } from "@/db/schema";
import { MasterScreen, type Column, type FieldDef } from "@/components/master-screen";
import { saveOrgUnit, deleteOrgUnit } from "@/app/actions/org";
import { Status, TwoLine } from "@/components/ui";
import { formatDateRange } from "@/lib/dates";

const COLUMNS: Column[] = [
  { key: "code", label: "Code" },
  { key: "name", label: "Org unit" },
  { key: "level", label: "Level" },
  { key: "parent", label: "Sits under" },
  { key: "company", label: "Company" },
  { key: "validity", label: "Valid" },
  { key: "status", label: "Status" },
];

export default async function OrgUnitsPage() {
  const [rows, companies, levels, calendars] = await Promise.all([
    db.select().from(omOrgUnit).orderBy(asc(omOrgUnit.code)),
    db.select().from(omCompany).orderBy(asc(omCompany.code)),
    db.select().from(omLevelType).orderBy(asc(omLevelType.rank), asc(omLevelType.code)),
    db.select().from(ptHolidayCalendar).orderBy(asc(ptHolidayCalendar.code)),
  ]);

  const unitName = new Map(rows.map((u) => [u.code, u.name]));
  const level = new Map(levels.map((l) => [l.code, l]));
  const calendarName = new Map(calendars.map((c) => [c.code, c.name]));

  const fields: FieldDef[] = [
    { kind: "text", name: "code", label: "Org unit code", required: true, placeholder: "OU0001", uppercase: true },
    { kind: "text", name: "name", label: "Org unit name", required: true, placeholder: "Information technology" },
    {
      kind: "select",
      name: "levelTypeCode",
      label: "Level",
      required: true,
      options: levels.filter((l) => l.isActive).map((l) => ({ value: l.code, label: `${l.name} (${l.code})` })),
      hint: "What this unit is. Levels are set up under Org levels.",
    },
    {
      kind: "select",
      name: "parentCode",
      label: "Sits under",
      options: rows.map((u) => ({ value: u.code, label: `${u.code} — ${u.name}` })),
      emptyLabel: "Top level",
      hint: "A level may only sit under the level it was set up for, or another unit of its own level.",
    },
    {
      kind: "select",
      name: "companyCode",
      label: "Company",
      options: companies.map((c) => ({ value: c.code, label: `${c.code} — ${c.name}` })),
      emptyLabel: "Above the companies",
      hint: "Leave empty only for a group node that spans every legal entity.",
    },
    {
      kind: "select",
      name: "calendarCode",
      label: "Holiday calendar",
      options: calendars.map((c) => ({ value: c.code, label: c.name })),
      emptyLabel: "Inherited from above",
      hint: "Set only on a level that carries a calendar. Everyone below inherits it.",
    },
    { kind: "date", name: "validFrom", label: "Valid from", required: true },
    { kind: "date", name: "validTo", label: "Valid to", hint: `Leave empty for ${OPEN_ENDED}.` },
    { kind: "checkbox", name: "isActive", label: "Active" },
  ];

  return (
    <MasterScreen
      title="Org units"
      subtitle="Every node of the hierarchy, at every level: a vertical, a business center, a department, a cost centre. What a unit is comes from its level, and each carries validity dates so the structure has a history."
      entity="org unit"
      columns={COLUMNS}
      idField="code"
      fields={fields}
      saveAction={saveOrgUnit}
      deleteAction={deleteOrgUnit}
      wideDialog
      emptyHint="Add the first org unit to start the tree."
      rows={rows.map((r) => ({
        id: r.code,
        describe: `${r.code} — ${r.name}`,
        cells: {
          code: <span className="font-medium text-ink">{r.code}</span>,
          name: r.name,
          level: (
            <TwoLine
              value={level.get(r.levelTypeCode)?.name ?? r.levelTypeCode}
              sub={r.calendarCode ? (calendarName.get(r.calendarCode) ?? r.calendarCode) : undefined}
            />
          ),
          parent: r.parentCode ? (
            <span className="text-secondary">
              {r.parentCode} — {unitName.get(r.parentCode) ?? "unknown"}
            </span>
          ) : (
            <span className="text-muted">Top level</span>
          ),
          company: r.companyCode ?? <span className="text-decor">&mdash;</span>,
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
          levelTypeCode: r.levelTypeCode,
          parentCode: r.parentCode ?? "",
          companyCode: r.companyCode ?? "",
          calendarCode: r.calendarCode ?? "",
          validFrom: r.validFrom,
          validTo: r.validTo === OPEN_ENDED ? "" : r.validTo,
          isActive: r.isActive,
        },
      }))}
    />
  );
}
