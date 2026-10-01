import { requirePage } from "@/lib/access";
import { rawClient } from "@/lib/db";
import { formatINR } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { Card, PageHeader, Table, Th, Tr, Td, Status, EmptyState, TwoLine } from "@/components/ui";
import { Landmark } from "lucide-react";
import { LoansClaimsTabs } from "./tabs";
import { LoanAdminActions } from "./forms";

const STATUS_TONE = { Pending: "waiting", Active: "action", Rejected: "problem", Closed: "neutral" } as const;

export default async function LoansPage() {
  await requirePage(["payroll.setup"], "/loans-claims/my-loans");

  const loans = await rawClient().execute(
    `SELECT l.*, COALESCE(p.first_name || ' ' || p.last_name, e.employee_number) AS name,
            (SELECT COUNT(*) FROM py_loan_schedule s WHERE s.loan_id = l.id AND s.additional_payment_id IS NULL) AS remaining,
            (SELECT closing_balance_paise FROM py_loan_schedule s WHERE s.loan_id = l.id ORDER BY installment_no DESC LIMIT 1) AS closing_balance_paise
     FROM py_loan l
     JOIN pa_employee e ON e.id = l.employee_id
     LEFT JOIN pa_it0002_personal_data p ON p.employee_id = e.id AND p.valid_from <= date('now') AND p.valid_to >= date('now')
     ORDER BY CASE l.status WHEN 'Pending' THEN 0 WHEN 'Active' THEN 1 ELSE 2 END, l.requested_at DESC`,
  );

  return (
    <>
      <LoansClaimsTabs />
      <PageHeader title="Loans" subtitle="Every loan asked for, with its schedule and what is still outstanding. New requests come from My loans and go through the usual approval." />
      <Card>
        {loans.rows.length === 0 ? (
          <EmptyState icon={<Landmark />} title="No loans yet" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Employee</Th>
                <Th>Type</Th>
                <Th numeric>Principal</Th>
                <Th numeric>EMI</Th>
                <Th numeric>Outstanding</Th>
                <Th>Status</Th>
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {loans.rows.map((l) => (
                <Tr key={Number(l.id)}>
                  <Td>
                    <span className="font-medium text-ink">{String(l.name)}</span>
                  </Td>
                  <Td>
                    <TwoLine value={String(l.loan_type)} sub={`from ${formatDate(String(l.start_date))}`} />
                  </Td>
                  <Td numeric>{formatINR(Number(l.principal_paise))}</Td>
                  <Td numeric>{formatINR(Number(l.emi_paise))}</Td>
                  <Td numeric>{l.closing_balance_paise === null ? "—" : formatINR(Number(l.closing_balance_paise))}</Td>
                  <Td>
                    <Status tone={STATUS_TONE[String(l.status) as keyof typeof STATUS_TONE] ?? "neutral"}>
                      {String(l.status)}
                      {String(l.status) === "Active" ? `, ${Number(l.remaining)} left` : ""}
                    </Status>
                  </Td>
                  <Td className="text-right whitespace-nowrap">
                    {String(l.status) === "Active" ? <LoanAdminActions id={Number(l.id)} name={String(l.name)} /> : null}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
