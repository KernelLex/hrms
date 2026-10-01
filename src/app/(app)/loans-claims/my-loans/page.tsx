import { requirePage } from "@/lib/access";
import { desc, eq } from "drizzle-orm";
import { db, rawClient } from "@/lib/db";
import { pyLoan } from "@/db/schema";
import { formatINR } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { Card, PageHeader, Table, Th, Tr, Td, Status, EmptyState, Notice, CardHeader } from "@/components/ui";
import { Landmark } from "lucide-react";
import { RequestLoanForm } from "./form";
import { WithdrawLoan } from "./cancel";

const STATUS_TONE = { Pending: "waiting", Active: "action", Rejected: "problem", Closed: "neutral" } as const;

/** Employee self-service: ask for a loan, and see its schedule once it is active. */
export default async function MyLoansPage() {
  const session = await requirePage(["self.loans"]);

  if (!session.employeeId) {
    return (
      <>
        <PageHeader title="My loans" subtitle="Ask for a loan, and see its schedule." />
        <Notice>This sign-in is not linked to an employee record, so there is nothing to show here.</Notice>
      </>
    );
  }

  const employeeId = session.employeeId;
  const loans = await db.select().from(pyLoan).where(eq(pyLoan.employeeId, employeeId)).orderBy(desc(pyLoan.requestedAt));
  const open = loans.find((l) => l.status === "Pending" || l.status === "Active");
  const active = loans.find((l) => l.status === "Active");

  const schedule = active
    ? (
        await rawClient().execute({
          sql: `SELECT installment_no, due_date, principal_paise, interest_paise, closing_balance_paise, additional_payment_id,
                       (SELECT paid_run_id FROM py_it0015_additional_payment WHERE id = additional_payment_id) AS paid_run_id
                FROM py_loan_schedule WHERE loan_id = ? ORDER BY installment_no`,
          args: [active.id],
        })
      ).rows
    : [];

  return (
    <>
      <PageHeader title="My loans" subtitle="Ask for a loan, and see where each instalment stands." />

      {!open ? <RequestLoanForm /> : null}

      <div className="mt-6">
        <Card>
          <CardHeader title="My requests" />
          {loans.length === 0 ? (
            <EmptyState icon={<Landmark />} title="No loans yet">
              Ask above and it will appear here with its status.
            </EmptyState>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Type</Th>
                  <Th numeric>Principal</Th>
                  <Th numeric>EMI</Th>
                  <Th>From</Th>
                  <Th>Status</Th>
                  <Th>
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {loans.map((l) => (
                  <Tr key={l.id}>
                    <Td>
                      <span className="font-medium text-ink">{l.loanType}</span>
                    </Td>
                    <Td numeric>{formatINR(l.principalPaise)}</Td>
                    <Td numeric>{formatINR(l.emiPaise)}</Td>
                    <Td>
                      <span className="tabular text-secondary">{formatDate(l.startDate)}</span>
                    </Td>
                    <Td>
                      <Status tone={STATUS_TONE[l.status as keyof typeof STATUS_TONE] ?? "neutral"}>{l.status}</Status>
                    </Td>
                    <Td className="text-right">{l.status === "Pending" ? <WithdrawLoan id={l.id} /> : null}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>

      {active ? (
        <div className="mt-6">
          <Card>
            <CardHeader title="Schedule" description={`${active.loanType}, ${formatINR(active.principalPaise)} from ${formatDate(active.startDate)}.`} />
            <Table>
              <thead>
                <tr>
                  <Th numeric>#</Th>
                  <Th>Due</Th>
                  <Th numeric>Principal</Th>
                  <Th numeric>Interest</Th>
                  <Th numeric>Balance after</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {schedule.map((s) => (
                  <Tr key={Number(s.installment_no)}>
                    <Td numeric>{Number(s.installment_no)}</Td>
                    <Td>
                      <span className="tabular text-secondary">{formatDate(String(s.due_date))}</span>
                    </Td>
                    <Td numeric>{formatINR(Number(s.principal_paise))}</Td>
                    <Td numeric>{formatINR(Number(s.interest_paise))}</Td>
                    <Td numeric>{formatINR(Number(s.closing_balance_paise))}</Td>
                    <Td>
                      <Status tone={s.paid_run_id ? "done" : s.additional_payment_id ? "waiting" : "neutral"}>
                        {s.paid_run_id ? "Paid" : s.additional_payment_id ? "Queued" : "Upcoming"}
                      </Status>
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
