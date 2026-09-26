import { requirePage } from "@/lib/access";
import { asc } from "drizzle-orm";
import { db } from "@/lib/db";
import { tdsSectionMaster, tdsTaxSlab } from "@/db/schema";
import { formatINR, toRupees } from "@/lib/money";
import { MasterScreen, type Column, type FieldDef } from "@/components/master-screen";
import { saveSection, deleteSection } from "@/app/actions/tax";
import { Card, CardHeader, Status, Table, Th, Tr, Td } from "@/components/ui";
import { TaxTabs } from "../tabs";

const COLUMNS: Column[] = [
  { key: "code", label: "Section" },
  { key: "description", label: "Covers" },
  { key: "rate", label: "Rate" },
  { key: "threshold", label: "Threshold", numeric: true },
  { key: "applicable", label: "Applies to" },
  { key: "status", label: "Status" },
];

const FIELDS: FieldDef[] = [
  { kind: "text", name: "code", label: "Section code", required: true, placeholder: "194J", uppercase: true },
  {
    kind: "text",
    name: "description",
    label: "What it covers",
    required: true,
    full: true,
    placeholder: "TDS on professional or technical fees",
  },
  {
    kind: "text",
    name: "ratePercent",
    label: "Rate %",
    placeholder: "10",
    hint: "Leave empty when the section is slab based, as salary is.",
  },
  { kind: "text", name: "threshold", label: "Threshold", placeholder: "30000", hint: "In rupees." },
  {
    kind: "select",
    name: "applicableTo",
    label: "Applies to",
    required: true,
    options: ["Employee", "Vendor", "Individual"].map((a) => ({ value: a, label: a })),
  },
  { kind: "checkbox", name: "isSlabBased", label: "Slab based" },
  { kind: "checkbox", name: "isActive", label: "Active" },
];

/** TDS-01 — sections and rates, plus the slab table the engine reads. */
export default async function SectionsPage() {
  await requirePage(["tax.manage"], "/tax/declarations");

  const [rows, slabs] = await Promise.all([
    db.select().from(tdsSectionMaster).orderBy(asc(tdsSectionMaster.code)),
    db
      .select()
      .from(tdsTaxSlab)
      .orderBy(asc(tdsTaxSlab.financialYear), asc(tdsTaxSlab.regime), asc(tdsTaxSlab.fromPaise)),
  ]);

  const years = [...new Set(slabs.map((s) => s.financialYear))].sort().reverse();
  const latest = years[0];
  const latestSlabs = slabs.filter((s) => s.financialYear === latest);
  const dash = <span className="text-decor">&mdash;</span>;

  return (
    <>
      <TaxTabs />
      <MasterScreen
        title="Sections and rates"
        subtitle="The statutory sections tax is deducted under. Salary sits under section 192, which is slab based rather than a flat rate."
        entity="section"
        columns={COLUMNS}
        idField="code"
        fields={FIELDS}
        saveAction={saveSection}
        deleteAction={deleteSection}
        wideDialog
        emptyHint="Add the sections your deductions are made under."
        rows={rows.map((r) => ({
          id: r.code,
          describe: `Section ${r.code}`,
          cells: {
            code: <span className="font-medium text-ink">{r.code}</span>,
            description: <span className="text-secondary">{r.description}</span>,
            rate: r.isSlabBased ? (
              <span className="text-secondary">Slab based</span>
            ) : r.rateBasisPoints !== null ? (
              <span className="tabular">{(r.rateBasisPoints / 100).toFixed(1)}%</span>
            ) : (
              dash
            ),
            threshold: r.thresholdPaise ? formatINR(r.thresholdPaise) : dash,
            applicable: <span className="text-secondary">{r.applicableTo}</span>,
            status: (
              <Status tone={r.isActive ? "done" : "neutral"}>
                {r.isActive ? "Active" : "Inactive"}
              </Status>
            ),
          },
          values: {
            code: r.code,
            description: r.description,
            ratePercent: r.rateBasisPoints !== null ? String(r.rateBasisPoints / 100) : "",
            threshold: r.thresholdPaise ? String(toRupees(r.thresholdPaise)) : "",
            applicableTo: r.applicableTo,
            isSlabBased: r.isSlabBased,
            isActive: r.isActive,
          },
        }))}
      />

      {latestSlabs.length > 0 ? (
        <div className="mt-6">
          <Card>
            <CardHeader
              title={`Salary tax slabs, FY ${latest}`}
              description="What the engine reads when it computes tax. Held as data, so a rate change is a row edit rather than a code change."
            />
            <Table>
              <thead>
                <tr>
                  <Th>Regime</Th>
                  <Th numeric>From</Th>
                  <Th numeric>To</Th>
                  <Th numeric>Rate</Th>
                </tr>
              </thead>
              <tbody>
                {latestSlabs.map((s) => (
                  <Tr key={s.id}>
                    <Td>
                      <span className="font-medium text-ink">{s.regime}</span>
                    </Td>
                    <Td numeric>{formatINR(s.fromPaise)}</Td>
                    <Td numeric>
                      {s.toPaise === null ? (
                        <span className="text-muted">and above</span>
                      ) : (
                        formatINR(s.toPaise)
                      )}
                    </Td>
                    <Td numeric>
                      <span className="tabular">{(s.rateBasisPoints / 100).toFixed(0)}%</span>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </Card>
        </div>
      ) : null}
    </>
  );
}
