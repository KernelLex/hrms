import { requirePage } from "@/lib/access";
import { asc, desc, count } from "drizzle-orm";
import { db } from "@/lib/db";
import { pmAppraisalCycle, pmAppraisalTemplate, pmAppraisal } from "@/db/schema";
import { MasterScreen, type Column, type FieldDef } from "@/components/master-screen";
import { saveCycle, deleteCycle } from "@/app/actions/performance";
import { Status } from "@/components/ui";
import { PerformanceTabs } from "../tabs";
import { OpenCycleButton } from "./actions";
import { formatDateRange } from "@/lib/dates";

const COLUMNS: Column[] = [
  { key: "name", label: "Cycle" },
  { key: "period", label: "Period" },
  { key: "dates", label: "Runs" },
  { key: "template", label: "Template" },
  { key: "appraisals", label: "Appraisals", numeric: true },
  { key: "status", label: "Status" },
  { key: "open", label: "" },
];

/** PM-01 — appraisal cycle setup. */
export default async function CyclesPage() {
  await requirePage(["performance.manage"], "/performance");

  const [rows, templates, appraisalCounts] = await Promise.all([
    db.select().from(pmAppraisalCycle).orderBy(desc(pmAppraisalCycle.startDate)),
    db.select().from(pmAppraisalTemplate).orderBy(asc(pmAppraisalTemplate.code)),
    db
      .select({ cycleId: pmAppraisal.cycleId, n: count() })
      .from(pmAppraisal)
      .groupBy(pmAppraisal.cycleId),
  ]);

  const counts = new Map(appraisalCounts.map((a) => [a.cycleId, a.n]));

  const fields: FieldDef[] = [
    { kind: "text", name: "name", label: "Cycle name", required: true, placeholder: "Annual appraisal FY2025-26" },
    { kind: "text", name: "periodLabel", label: "Period", placeholder: "FY2025-26 (Apr-Mar)" },
    { kind: "date", name: "startDate", label: "Start date", required: true },
    { kind: "date", name: "endDate", label: "End date", required: true },
    {
      kind: "select",
      name: "templateCode",
      label: "Template",
      required: true,
      options: templates.map((t) => ({ value: t.code, label: t.name })),
    },
    {
      kind: "select",
      name: "status",
      label: "Status",
      required: true,
      options: ["Draft", "Active", "Closed"].map((s) => ({ value: s, label: s })),
      hint: "Opening a cycle creates an appraisal for every active employee.",
    },
  ];

  return (
    <>
      <PerformanceTabs />
      <MasterScreen
        title="Appraisal cycles"
        subtitle="The yearly review. Opening a cycle creates an appraisal for every active employee, so the rating screens start with rows rather than an empty list."
        entity="cycle"
        columns={COLUMNS}
        idField="id"
        fields={fields}
        saveAction={saveCycle}
        deleteAction={deleteCycle}
        wideDialog
        emptyHint="Set up a review cycle to start the process."
        rows={rows.map((r) => ({
          id: String(r.id),
          describe: r.name,
          cells: {
            name: <span className="font-medium text-ink">{r.name}</span>,
            period: <span className="text-secondary">{r.periodLabel}</span>,
            dates: (
              <span className="tabular text-secondary">
                {formatDateRange(r.startDate, r.endDate)}
              </span>
            ),
            template: (
              <span className="text-secondary">
                {templates.find((t) => t.code === r.templateCode)?.name ?? r.templateCode}
              </span>
            ),
            appraisals: String(counts.get(r.id) ?? 0),
            status: (
              <Status
                tone={r.status === "Active" ? "done" : r.status === "Draft" ? "waiting" : "neutral"}
              >
                {r.status}
              </Status>
            ),
            open:
              r.status === "Draft" ? (
                <OpenCycleButton id={r.id} />
              ) : null,
          },
          values: {
            name: r.name,
            periodLabel: r.periodLabel,
            startDate: r.startDate,
            endDate: r.endDate,
            templateCode: r.templateCode,
            status: r.status,
          },
        }))}
      />
    </>
  );
}
