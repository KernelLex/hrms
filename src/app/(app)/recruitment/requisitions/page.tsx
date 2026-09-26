import { requirePage } from "@/lib/access";
import { asc, desc, count } from "drizzle-orm";
import { db } from "@/lib/db";
import { rcRequisition, rcApplication, omPosition, omOrgUnit } from "@/db/schema";
import { MasterScreen, type Column, type FieldDef } from "@/components/master-screen";
import { saveRequisition, deleteRequisition } from "@/app/actions/recruitment";
import { Status, TwoLine } from "@/components/ui";
import { RecruitmentTabs } from "../tabs";

const COLUMNS: Column[] = [
  { key: "code", label: "Requisition" },
  { key: "position", label: "Position" },
  { key: "unit", label: "Department" },
  { key: "openings", label: "Openings", numeric: true },
  { key: "applicants", label: "Applicants", numeric: true },
  { key: "priority", label: "Priority" },
  { key: "status", label: "Status" },
];

/** RC-01 — job requisitions, opened against a vacant position. */
export default async function RequisitionsPage() {
  await requirePage(["recruitment.manage"], "/");

  const [rows, positions, units, applicationCounts] = await Promise.all([
    db.select().from(rcRequisition).orderBy(desc(rcRequisition.postedDate)),
    db.select().from(omPosition).orderBy(asc(omPosition.code)),
    db.select().from(omOrgUnit).orderBy(asc(omOrgUnit.code)),
    db
      .select({ requisitionId: rcApplication.requisitionId, n: count() })
      .from(rcApplication)
      .groupBy(rcApplication.requisitionId),
  ]);

  const positionTitle = new Map(positions.map((p) => [p.code, p.title]));
  const unitName = new Map(units.map((u) => [u.code, u.name]));
  const applicants = new Map(applicationCounts.map((a) => [a.requisitionId, a.n]));

  // Only vacant positions can take a new requisition.
  const vacant = positions.filter((p) => p.isVacant && p.isActive);

  const fields: FieldDef[] = [
    {
      kind: "select",
      name: "positionCode",
      label: "Position",
      required: true,
      options: vacant.map((p) => ({ value: p.code, label: `${p.code} — ${p.title}` })),
      emptyLabel: vacant.length === 0 ? "No vacant positions" : undefined,
      hint: "The department and job follow from the position.",
    },
    { kind: "text", name: "openings", label: "Openings", required: true, placeholder: "1" },
    {
      kind: "select",
      name: "priority",
      label: "Priority",
      required: true,
      options: ["High", "Medium", "Low"].map((p) => ({ value: p, label: p })),
    },
    { kind: "date", name: "postedDate", label: "Posted date", required: true },
    { kind: "date", name: "targetCloseDate", label: "Target close date" },
    {
      kind: "select",
      name: "status",
      label: "Status",
      required: true,
      options: ["Open", "On hold", "Closed"].map((s) => ({ value: s, label: s })),
    },
  ];

  return (
    <>
      <RecruitmentTabs />
      <MasterScreen
        title="Requisitions"
        subtitle="A requisition opens hiring against a vacant position. It closes itself once its openings are filled."
        entity="requisition"
        columns={COLUMNS}
        idField="code"
        fields={fields}
        saveAction={saveRequisition}
        deleteAction={deleteRequisition}
        wideDialog
        emptyHint="Open a requisition against one of your vacant positions."
        rows={rows.map((r) => ({
          id: r.code,
          describe: `${r.code} — ${positionTitle.get(r.positionCode) ?? r.positionCode}`,
          cells: {
            code: <span className="font-medium text-ink">{r.code}</span>,
            position: (
              <TwoLine
                value={positionTitle.get(r.positionCode) ?? r.positionCode}
                sub={r.positionCode}
              />
            ),
            unit: (
              <span className="text-secondary">
                {unitName.get(r.orgUnitCode) ?? r.orgUnitCode}
              </span>
            ),
            openings: String(r.openings),
            applicants: String(applicants.get(r.id) ?? 0),
            priority: <span className="text-secondary">{r.priority}</span>,
            status: (
              <Status
                tone={
                  r.status === "Open" ? "action" : r.status === "On hold" ? "waiting" : "neutral"
                }
              >
                {r.status}
              </Status>
            ),
          },
          values: {
            positionCode: r.positionCode,
            openings: String(r.openings),
            priority: r.priority,
            postedDate: r.postedDate,
            targetCloseDate: r.targetCloseDate ?? "",
            status: r.status,
          },
        }))}
      />
    </>
  );
}
