import { asc, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { omReportingLine, omPosition } from "@/db/schema";
import { MasterScreen, type Column, type FieldDef } from "@/components/master-screen";
import { saveReportingLine, deleteReportingLine } from "@/app/actions/org";
import { TwoLine } from "@/components/ui";

const COLUMNS: Column[] = [
  { key: "position", label: "Position" },
  { key: "reportsTo", label: "Reports to" },
  { key: "effective", label: "Effective from" },
  { key: "remarks", label: "Remarks" },
];

export default async function ReportingLinesPage() {
  const [rows, positions] = await Promise.all([
    db
      .select()
      .from(omReportingLine)
      .orderBy(desc(omReportingLine.effectiveFrom), desc(omReportingLine.id)),
    db.select().from(omPosition).orderBy(asc(omPosition.code)),
  ]);

  const title = new Map(positions.map((p) => [p.code, p.title]));

  const fields: FieldDef[] = [
    {
      kind: "select",
      name: "positionCode",
      label: "Position",
      required: true,
      options: positions.map((p) => ({ value: p.code, label: `${p.code} — ${p.title}` })),
    },
    {
      kind: "select",
      name: "reportsToCode",
      label: "Reports to",
      required: true,
      options: positions.map((p) => ({ value: p.code, label: `${p.code} — ${p.title}` })),
    },
    { kind: "date", name: "effectiveFrom", label: "Effective from", required: true },
    {
      kind: "text",
      name: "remarks",
      label: "Remarks",
      full: true,
      placeholder: "Reorg — moved under a new manager",
    },
  ];

  return (
    <MasterScreen
      title="Reporting lines"
      subtitle="A dated record of every reporting change. Recording one also moves the position's live manager."
      entity="reporting line"
      columns={COLUMNS}
      idField="id"
      fields={fields}
      saveAction={saveReportingLine}
      deleteAction={deleteReportingLine}
      allowEdit={false}
      emptyHint="Record a reporting change to start the history."
      rows={rows.map((r) => ({
        id: String(r.id),
        describe: `${r.positionCode} reporting to ${r.reportsToCode} from ${r.effectiveFrom}`,
        cells: {
          position: <TwoLine value={r.positionCode} sub={title.get(r.positionCode)} />,
          reportsTo: (
            <TwoLine value={r.reportsToCode} sub={title.get(r.reportsToCode)} />
          ),
          effective: <span className="tabular">{r.effectiveFrom}</span>,
          remarks: (
            <span className="text-secondary">
              {r.remarks ?? <span className="text-decor">&mdash;</span>}
            </span>
          ),
        },
        values: {
          positionCode: r.positionCode,
          reportsToCode: r.reportsToCode,
          effectiveFrom: r.effectiveFrom,
          remarks: r.remarks ?? "",
        },
      }))}
    />
  );
}
