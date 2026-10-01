import { redirect } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { can, getAccess } from "@/lib/access";
import { logAccess } from "@/lib/access-log";
import { pySalaryStructure, pyCostSplit } from "@/db/schema";
import { readHistory, SLICED_TABLES } from "@/lib/engines/timeslice";
import { previewCtc } from "@/lib/engines/payroll";
import { todayInIndia, formatDate } from "@/lib/dates";
import { formatINR } from "@/lib/money";
import { Card, CardHeader, CardBody, Table, Th, Tr, Td, EmptyState } from "@/components/ui";
import { RateSection } from "@/components/rate-section";
import { saveCostSplit, deleteCostSplit } from "@/app/actions/statutory";
import { CtcForm } from "./form";

type CtcRow = { id: number; structure_code: string; annual_ctc_paise: number; valid_from: string; valid_to: string };

export default async function CtcPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const employeeId = Number(id);
  const session = await getAccess();
  if (!session || !can(session, "pay.view")) redirect(`/core-hr/${employeeId}`);
  logAccess(session, { subjectEmployeeId: employeeId, resource: "CTC" });

  const [structures, history, splits] = await Promise.all([
    db.select().from(pySalaryStructure).where(eq(pySalaryStructure.isActive, true)).orderBy(asc(pySalaryStructure.name)),
    readHistory<CtcRow>(SLICED_TABLES.employeeCtc, employeeId),
    db.select().from(pyCostSplit).where(eq(pyCostSplit.employeeId, employeeId)).orderBy(asc(pyCostSplit.validFrom)),
  ]);

  const today = todayInIndia();
  const current = history.find((h) => h.valid_from <= today && h.valid_to >= today);
  const breakdown = current ? await previewCtc(current.structure_code, Number(current.annual_ctc_paise), today) : null;

  return (
    <div className="flex flex-col gap-6">
      <CtcForm employeeId={employeeId} structures={structures.map((s) => ({ value: s.code, label: `${s.name} (${s.code})` }))} />

      <Card>
        <CardHeader title="CTC history" description="What the structure derives from each slice: basic pay through the usual time-slice engine, the rest as a monthly breakdown." />
        {history.length === 0 ? (
          <EmptyState title="No CTC on record" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Structure</Th>
                <Th numeric>Annual CTC</Th>
                <Th>Valid from</Th>
                <Th>Valid to</Th>
              </tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <Tr key={h.id}>
                  <Td>
                    <span className="font-medium text-ink">{h.structure_code}</span>
                  </Td>
                  <Td numeric>{formatINR(Number(h.annual_ctc_paise))}</Td>
                  <Td>{formatDate(h.valid_from)}</Td>
                  <Td>{h.valid_to === "9999-12-31" ? "Open" : formatDate(h.valid_to)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {breakdown ? (
        <Card>
          <CardHeader title="Monthly breakdown" description={`At today's rates, for the ${formatINR(breakdown.monthlyCtcPaise)}/month currently in force.`} />
          <CardBody>
            <Table>
              <thead>
                <tr>
                  <Th>Component</Th>
                  <Th numeric>Amount</Th>
                </tr>
              </thead>
              <tbody>
                {breakdown.lines.map((l) => (
                  <Tr key={l.wageTypeCode}>
                    <Td>{l.wageTypeName}</Td>
                    <Td numeric>{formatINR(l.amountPaise)}</Td>
                  </Tr>
                ))}
                <Tr>
                  <Td>
                    <span className="font-medium text-ink">Gross</span>
                  </Td>
                  <Td numeric>
                    <span className="font-medium text-ink">{formatINR(breakdown.grossPaise)}</span>
                  </Td>
                </Tr>
                <Tr>
                  <Td>Employer PF, EPS, EDLI and admin charge</Td>
                  <Td numeric>{formatINR(breakdown.employerPfPaise)}</Td>
                </Tr>
                {breakdown.employerEsiPaise > 0 ? (
                  <Tr>
                    <Td>Employer ESI</Td>
                    <Td numeric>{formatINR(breakdown.employerEsiPaise)}</Td>
                  </Tr>
                ) : null}
              </tbody>
            </Table>
          </CardBody>
        </Card>
      ) : null}

      <RateSection
        title="Cost splits"
        description="Splits this person's payroll cost across more than one cost centre by percentage. Without one, the full cost follows their org assignment's own cost centre."
        entity="cost split"
        idField="id"
        hiddenFields={{ employeeId }}
        saveAction={saveCostSplit}
        deleteAction={deleteCostSplit}
        emptyHint="Add a split only where cost should be shared; most people need none."
        columns={[
          { key: "centre", label: "Cost centre" },
          { key: "percent", label: "Percent", numeric: true },
          { key: "from", label: "Valid from" },
          { key: "to", label: "Valid to" },
        ]}
        rows={splits.map((s) => ({
          id: String(s.id),
          describe: `${s.costCentre}, ${(s.percentBasisPoints / 100).toFixed(0)}%`,
          cells: {
            centre: <span className="font-medium text-ink">{s.costCentre}</span>,
            percent: `${(s.percentBasisPoints / 100).toFixed(0)}%`,
            from: formatDate(s.validFrom),
            to: s.validTo === "9999-12-31" ? "Open" : formatDate(s.validTo),
          },
          values: {
            costCentre: s.costCentre,
            percent: String(s.percentBasisPoints / 100),
            validFrom: s.validFrom,
            validTo: s.validTo === "9999-12-31" ? "" : s.validTo,
          },
        }))}
        fields={[
          { kind: "text", name: "costCentre", label: "Cost centre", required: true, placeholder: "CC-IT-01" },
          { kind: "text", name: "percent", label: "Percent", required: true, hint: "This person's own splits should add up to 100." },
          { kind: "date", name: "validFrom", label: "Valid from", required: true },
          { kind: "date", name: "validTo", label: "Valid to", hint: "Leave blank for open-ended." },
        ]}
      />
    </div>
  );
}
