import { requirePage } from "@/lib/access";
import { rawClient } from "@/lib/db";
import { formatINR } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { Card, PageHeader, Table, Th, Tr, Td, Status, EmptyState, TwoLine } from "@/components/ui";
import { ReceiptText } from "lucide-react";
import { LoansClaimsTabs } from "../tabs";

const STATUS_TONE = { Pending: "waiting", Approved: "done", Rejected: "problem" } as const;

export default async function ClaimsPage() {
  await requirePage(["payroll.setup"], "/loans-claims/my-claims");

  const claims = await rawClient().execute(
    `SELECT c.*, cat.name AS category_name, COALESCE(p.first_name || ' ' || p.last_name, e.employee_number) AS name,
            (SELECT COUNT(*) FROM py_claim_line cl WHERE cl.claim_id = c.id) AS line_count,
            ap.paid_run_id
     FROM py_claim c
     JOIN pa_employee e ON e.id = c.employee_id
     JOIN py_claim_category cat ON cat.code = c.category_code
     LEFT JOIN pa_it0002_personal_data p ON p.employee_id = e.id AND p.valid_from <= date('now') AND p.valid_to >= date('now')
     LEFT JOIN py_it0015_additional_payment ap ON ap.id = c.additional_payment_id
     ORDER BY CASE c.status WHEN 'Pending' THEN 0 ELSE 1 END, c.requested_at DESC`,
  );

  return (
    <>
      <LoansClaimsTabs />
      <PageHeader title="Claims" subtitle="Every reimbursement claim, with what category and how many lines. New claims come from My claims and go through approval: the employee's manager, then Finance." />
      <Card>
        {claims.rows.length === 0 ? (
          <EmptyState icon={<ReceiptText />} title="No claims yet" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Employee</Th>
                <Th>Category</Th>
                <Th numeric>Lines</Th>
                <Th numeric>Amount</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {claims.rows.map((c) => (
                <Tr key={Number(c.id)}>
                  <Td>
                    <span className="font-medium text-ink">{String(c.name)}</span>
                  </Td>
                  <Td>
                    <TwoLine value={String(c.category_name)} sub={formatDate(String(c.claim_date))} />
                  </Td>
                  <Td numeric>{Number(c.line_count)}</Td>
                  <Td numeric>{formatINR(Number(c.total_amount_paise))}</Td>
                  <Td>
                    <Status tone={STATUS_TONE[String(c.status) as keyof typeof STATUS_TONE] ?? "neutral"}>
                      {String(c.status) === "Approved" ? (c.paid_run_id ? "Paid" : "Approved, queued to pay") : String(c.status)}
                    </Status>
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
