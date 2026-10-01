import { requirePage } from "@/lib/access";
import { rawClient } from "@/lib/db";
import { formatINR } from "@/lib/money";
import { formatDate, todayInIndia } from "@/lib/dates";
import { Card, CardHeader, PageHeader, Table, Th, Tr, Td, Status, EmptyState, TwoLine, Notice } from "@/components/ui";
import { ShieldCheck } from "lucide-react";
import { TaxTabs } from "../tabs";
import { ProofWindowForm } from "./window-form";
import { ProofDecision } from "./decide";

/** HR's proof verification queue: the window for each year, and every proof still pending a decision. */
export default async function ProofsPage() {
  await requirePage(["tax.manage"]);

  const [windows, pending] = await Promise.all([
    rawClient().execute("SELECT * FROM tds_proof_window ORDER BY financial_year DESC"),
    rawClient().execute(`
      SELECT p.*, COALESCE(pd.first_name || ' ' || pd.last_name, e.employee_number) AS name
      FROM tds_proof p
      JOIN pa_employee e ON e.id = p.employee_id
      LEFT JOIN pa_it0002_personal_data pd ON pd.employee_id = e.id AND pd.valid_from <= date('now') AND pd.valid_to >= date('now')
      WHERE p.status = 'Pending'
      ORDER BY p.submitted_at
    `),
  ]);

  const today = todayInIndia();

  return (
    <>
      <TaxTabs />
      <PageHeader title="Proof verification" subtitle="Open a window for each year, then verify or reject what is filed against it. After a window closes, only what was verified still reduces TDS." />

      <Card>
        <CardHeader title="Proof windows" />
        <ProofWindowForm />
        {windows.rows.length > 0 ? (
          <Table>
            <thead>
              <tr>
                <Th>Year</Th>
                <Th>Opens</Th>
                <Th>Closes</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {windows.rows.map((w) => (
                <Tr key={String(w.financial_year)}>
                  <Td className="tabular">{String(w.financial_year)}</Td>
                  <Td className="tabular text-secondary">{formatDate(String(w.opens_at))}</Td>
                  <Td className="tabular text-secondary">{formatDate(String(w.closes_at))}</Td>
                  <Td>
                    <Status tone={String(w.closes_at) < today ? "neutral" : "action"}>{String(w.closes_at) < today ? "Closed" : "Open"}</Status>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <div className="px-6 pb-5">
            <Notice>No window has been opened yet — every declared amount is used for TDS as declared.</Notice>
          </div>
        )}
      </Card>

      <div className="mt-6">
        <Card>
          <CardHeader title="Waiting on a decision" />
          {pending.rows.length === 0 ? (
            <EmptyState icon={<ShieldCheck />} title="Nothing waiting">
              Proof filed against a declaration appears here.
            </EmptyState>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Employee</Th>
                  <Th>Section</Th>
                  <Th numeric>Amount</Th>
                  <Th>Filed</Th>
                  <Th>
                    <span className="sr-only">Decision</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {pending.rows.map((p) => (
                  <Tr key={Number(p.id)}>
                    <Td>
                      <TwoLine value={String(p.name)} sub={String(p.financial_year)} />
                    </Td>
                    <Td>{String(p.section)}</Td>
                    <Td numeric>{formatINR(Number(p.amount_paise))}</Td>
                    <Td className="text-secondary">{formatDate(String(p.submitted_at).slice(0, 10))}</Td>
                    <Td className="text-right">
                      <ProofDecision id={Number(p.id)} describe={`${p.name}'s ${p.section} proof of ${formatINR(Number(p.amount_paise))}`} />
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
