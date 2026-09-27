import { Scale } from "lucide-react";
import { requirePage } from "@/lib/access";
import { reconciliation } from "@/lib/repositories/integrations";
import { formatINR } from "@/lib/money";
import { formatDate, formatMonth } from "@/lib/dates";
import { Card, CardHeader, EmptyState, Status, Table, Th, Tr, Td, TwoLine } from "@/components/ui";

/**
 * Every posted payroll journal against what the ERP did with it: delivered,
 * booked under which reference, and whether its totals agree with ours.
 */
export default async function ReconciliationPage() {
  await requirePage(["integrations.manage"], "/admin");
  const rows = await reconciliation();
  const booked = rows.filter((r) => r.state === "acknowledged").length;
  const mismatched = rows.filter((r) => r.matches === false).length;

  return (
    <Card>
      <CardHeader
        title="Reconciliation"
        description={`${booked} of ${rows.length} journals booked in the ERP${mismatched ? `; ${mismatched} with totals that do not agree` : ""}.`}
      />
      {rows.length === 0 ? (
        <EmptyState icon={<Scale />} title="No journals yet">
          Journals appear here once a payroll run is posted to the ledger.
        </EmptyState>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Journal</Th>
              <Th numeric>Debit</Th>
              <Th numeric>Credit</Th>
              <Th>In the ERP</Th>
              <Th>Totals</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <Tr key={r.id}>
                <Td>
                  <TwoLine
                    value={`${formatMonth(r.year, r.month)}${r.runType === "Off-cycle" ? ", off-cycle" : ""}`}
                    sub={`Posted ${formatDate(r.postingDate)}${r.delivered ? ", delivered" : ""}`}
                  />
                </Td>
                <Td numeric>{formatINR(r.debit)}</Td>
                <Td numeric>{formatINR(r.credit)}</Td>
                <Td>
                  <Status tone={r.state === "acknowledged" ? "done" : r.state === "rejected" ? "problem" : "waiting"}>
                    {r.state === "acknowledged" ? `Booked as ${r.reference}` : r.state === "rejected" ? `Rejected: ${r.reason}` : "Not booked yet"}
                  </Status>
                </Td>
                <Td>
                  {r.matches === null ? (
                    <span className="text-decor">&mdash;</span>
                  ) : r.matches ? (
                    <Status tone="done">Agree</Status>
                  ) : (
                    <TwoLine
                      value={<Status tone="problem">Differ</Status>}
                      sub={r.theirs ? `ERP: ${formatINR(r.theirs.debit)} / ${formatINR(r.theirs.credit)}` : undefined}
                    />
                  )}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}
