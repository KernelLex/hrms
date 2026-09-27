import { can, requirePage } from "@/lib/access";
import { rawClient } from "@/lib/db";
import { ackState } from "@/lib/services/integration";
import { ResendJournal } from "./resend";
import { and, asc, count, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  pyPayrollRun,
  pyPayrollPeriod,
  pyBankTransferFile,
  pyBankTransferLine,
  pyGlPosting,
  pyGlPostingLine,
  pyStatutoryRemittance,
} from "@/db/schema";
import { formatINR } from "@/lib/money";
import { formatDate, formatMonth, todayInIndia } from "@/lib/dates";
import { Pagination, pageFrom } from "@/components/pagination";
import {
  ButtonAnchor,
  Card,
  CardHeader,
  PageHeader,
  Table,
  Th,
  Tr,
  Td,
  TwoLine,
  Status,
  EmptyState,
  Notice,
} from "@/components/ui";
import { Download, Landmark } from "lucide-react";
import { PayrollTabs } from "../tabs";
import { PostingForms, RemitButton } from "./forms";

/** PY-05 — bank transfer file, ledger posting and statutory remittance. */
export default async function PostingPage(props: {
  searchParams: Promise<{ run?: string; page?: string }>;
}) {
  const session = await requirePage(["payroll.view"], "/payroll/my-payslips");

  const params = await props.searchParams;

  const runs = await db
    .select({
      id: pyPayrollRun.id,
      runAt: pyPayrollRun.runAt,
      runType: pyPayrollRun.runType,
      reason: pyPayrollRun.reason,
      netTotalPaise: pyPayrollRun.netTotalPaise,
      errorCount: pyPayrollRun.errorCount,
      year: pyPayrollPeriod.year,
      month: pyPayrollPeriod.month,
      areaCode: pyPayrollPeriod.areaCode,
      periodStatus: pyPayrollPeriod.status,
    })
    .from(pyPayrollRun)
    .innerJoin(pyPayrollPeriod, eq(pyPayrollPeriod.id, pyPayrollRun.periodId))
    .where(eq(pyPayrollRun.status, "Completed"))
    .orderBy(desc(pyPayrollRun.runAt));

  const runLabel = (r: (typeof runs)[number]) =>
    `${formatMonth(r.year, r.month)}, ${r.areaCode}${r.runType === "Off-cycle" ? `, off-cycle: ${r.reason ?? "payment"}` : ""}`;

  if (runs.length === 0) {
    return (
      <>
        <PayrollTabs />
        <PageHeader
          title="Bank and posting"
          subtitle="What happens after the run: paying people, posting to the ledger, and remitting statutory amounts."
        />
        <Card>
          <EmptyState icon={<Landmark />} title="Nothing to post yet">
            Run payroll for a period, then come back to generate the bank file
            and post the journal.
          </EmptyState>
        </Card>
      </>
    );
  }

  const runId = Number(params.run) || runs[0].id;
  const run = runs.find((r) => r.id === runId) ?? runs[0];

  const [bankFile, posting, remittances] = await Promise.all([
    db.query.pyBankTransferFile.findFirst({
      where: eq(pyBankTransferFile.runId, run.id),
    }),
    db.query.pyGlPosting.findFirst({ where: eq(pyGlPosting.runId, run.id) }),
    db
      .select()
      .from(pyStatutoryRemittance)
      .where(eq(pyStatutoryRemittance.runId, run.id))
      .orderBy(asc(pyStatutoryRemittance.dueDate)),
  ]);

  // A bank file has a line per person paid, so it is read a page at a time.
  const { page, limit, offset } = pageFrom(params.page);
  const [bankLines, bankLineCount, glLines] = await Promise.all([
    bankFile
      ? db
          .select()
          .from(pyBankTransferLine)
          .where(eq(pyBankTransferLine.fileId, bankFile.id))
          .orderBy(asc(pyBankTransferLine.employeeName))
          .limit(limit)
          .offset(offset)
      : Promise.resolve([]),
    bankFile
      ? db
          .select({ n: count() })
          .from(pyBankTransferLine)
          .where(and(eq(pyBankTransferLine.fileId, bankFile.id)))
          .then((r) => r[0].n)
      : Promise.resolve(0),
    posting
      ? db.select().from(pyGlPostingLine).where(eq(pyGlPostingLine.postingId, posting.id))
      : Promise.resolve([]),
  ]);

  // What the ERP sent back: whether it booked the journal and paid each salary.
  const [erpConnected, ack, paymentCounts] = await Promise.all([
    rawClient()
      .execute("SELECT 1 FROM int_client WHERE status = 'active' LIMIT 1")
      .then((r) => r.rows.length > 0),
    posting ? ackState("gl_posting", posting.id) : Promise.resolve(null),
    bankFile
      ? rawClient()
          .execute({
            sql: "SELECT payment_status, COUNT(*) AS n FROM py_bank_transfer_line WHERE file_id = ? GROUP BY payment_status",
            args: [bankFile.id],
          })
          .then((r) => Object.fromEntries(r.rows.map((x) => [String(x.payment_status), Number(x.n)])) as Record<string, number>)
      : Promise.resolve({} as Record<string, number>),
  ]);

  const totalDebit = glLines.reduce((s, l) => s + l.debitPaise, 0);
  const totalCredit = glLines.reduce((s, l) => s + l.creditPaise, 0);
  const balanced = totalDebit === totalCredit;
  const today = todayInIndia();

  return (
    <>
      <PayrollTabs />
      <PageHeader
        title="Bank and posting"
        subtitle={`${runLabel(run)}. Net payable ${formatINR(run.netTotalPaise)}.`}
      />

      <PostingForms
        runs={runs.map((r) => ({
          value: String(r.id),
          label: runLabel(r),
        }))}
        selectedRunId={String(run.id)}
        hasBankFile={Boolean(bankFile)}
        hasPosting={Boolean(posting)}
      />

      {/* Bank transfer */}
      <div className="mt-6">
        <Card>
          <CardHeader
            title="Bank transfer"
            description={
              bankFile
                ? `${bankFile.lineCount} payments totalling ${formatINR(bankFile.totalPaise)}, paid ${formatDate(bankFile.paymentDate)}. ${bankFile.format}.` +
                  (erpConnected
                    ? ` The ERP has confirmed ${paymentCounts.paid ?? 0} of ${bankFile.lineCount} paid${paymentCounts.failed ? ` and ${paymentCounts.failed} failed` : ""}.`
                    : "")
                : "Generate the payment file once the run is correct."
            }
            actions={
              bankFile ? (
                <ButtonAnchor href={`/api/payroll/bank-file/${bankFile.id}`} size="sm" download>
                  <Download />
                  Download CSV
                </ButtonAnchor>
              ) : undefined
            }
          />
          {bankLines.length === 0 ? (
            <EmptyState icon={<Landmark />} title="No bank file yet">
              Generate one above to list every payment this run produces.
            </EmptyState>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Employee</Th>
                  <Th>Bank</Th>
                  <Th>Account</Th>
                  <Th numeric>Amount</Th>
                  {erpConnected ? <Th>Payment</Th> : null}
                </tr>
              </thead>
              <tbody>
                {bankLines.map((l) => (
                  <Tr key={l.id}>
                    <Td>
                      <span className="font-medium text-ink">{l.employeeName}</span>
                    </Td>
                    <Td>
                      <TwoLine value={l.bankName} sub={l.ifsc ?? undefined} />
                    </Td>
                    <Td>
                      <span className="tabular text-secondary">{l.accountNumber}</span>
                    </Td>
                    <Td numeric>{formatINR(l.amountPaise)}</Td>
                    {erpConnected ? (
                      <Td>
                        <TwoLine
                          value={
                            <Status tone={l.paymentStatus === "paid" ? "done" : l.paymentStatus === "failed" ? "problem" : "waiting"}>
                              {l.paymentStatus === "paid" ? "Paid" : l.paymentStatus === "failed" ? "Failed" : "Waiting for the ERP"}
                            </Status>
                          }
                          sub={l.paymentStatus === "failed" ? (l.failureReason ?? undefined) : (l.bankReference ?? undefined)}
                        />
                      </Td>
                    ) : null}
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
          {bankFile ? (
            <Pagination
              page={page}
              total={bankLineCount}
              path="/payroll/posting"
              params={{ run: String(run.id) }}
              noun="payments"
            />
          ) : null}
        </Card>
      </div>

      {/* Ledger posting */}
      <div className="mt-6">
        <Card>
          <CardHeader
            title="Ledger posting"
            description={
              posting
                ? `Posted ${formatDate(posting.postingDate)} by ${posting.postedBy}.`
                : "Posts salary expense and the payables it creates."
            }
          />
          {posting && erpConnected && ack ? (
            <div className="flex flex-wrap items-center justify-between gap-3 px-6 pb-4">
              <Status tone={ack.state === "acknowledged" ? "done" : ack.state === "rejected" ? "problem" : "waiting"}>
                {ack.state === "acknowledged"
                  ? `Booked in the ERP as ${ack.reference}`
                  : ack.state === "rejected"
                    ? `Rejected by the ERP: ${ack.reason}`
                    : "Waiting for the ERP to book it"}
              </Status>
              {ack.state === "rejected" && (can(session, "payroll.post") || can(session, "integrations.manage")) ? <ResendJournal id={posting.id} /> : null}
            </div>
          ) : null}
          {glLines.length === 0 ? (
            <EmptyState icon={<Landmark />} title="Not posted yet">
              Post the journal above to send this run to the ledger.
            </EmptyState>
          ) : (
            <>
              {!balanced ? (
                <div className="px-6 pb-4">
                  <Notice problem>
                    Debits and credits do not agree. This journal would not post
                    to a real ledger.
                  </Notice>
                </div>
              ) : null}
              <Table>
                <thead>
                  <tr>
                    <Th>Account</Th>
                    <Th>Description</Th>
                    <Th>Cost centre</Th>
                    <Th numeric>Debit</Th>
                    <Th numeric>Credit</Th>
                  </tr>
                </thead>
                <tbody>
                  {glLines.map((l) => (
                    <Tr key={l.id}>
                      <Td>
                        <span className="tabular font-medium text-ink">{l.glAccount}</span>
                      </Td>
                      <Td>
                        <span className="text-secondary">{l.description}</span>
                      </Td>
                      <Td>
                        {l.costCenter ? (
                          <span className="tabular text-secondary">{l.costCenter}</span>
                        ) : (
                          <span className="text-decor">&mdash;</span>
                        )}
                      </Td>
                      <Td numeric>
                        {l.debitPaise > 0 ? formatINR(l.debitPaise) : <span className="text-decor">&mdash;</span>}
                      </Td>
                      <Td numeric>
                        {l.creditPaise > 0 ? formatINR(l.creditPaise) : <span className="text-decor">&mdash;</span>}
                      </Td>
                    </Tr>
                  ))}
                  <Tr>
                    <Td colSpan={3}>
                      <span className="font-medium text-ink">Total</span>
                    </Td>
                    <Td numeric>
                      <span className="font-medium text-ink">{formatINR(totalDebit)}</span>
                    </Td>
                    <Td numeric>
                      <span className="font-medium text-ink">{formatINR(totalCredit)}</span>
                    </Td>
                  </Tr>
                </tbody>
              </Table>
            </>
          )}
        </Card>
      </div>

      {/* Statutory remittance */}
      <div className="mt-6">
        <Card>
          <CardHeader
            title="Statutory remittance"
            description="What is owed to the authorities, and by when."
          />
          {remittances.length === 0 ? (
            <EmptyState icon={<Landmark />} title="Nothing due">
              Remittances appear once the run has been posted.
            </EmptyState>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Authority</Th>
                  <Th numeric>Amount</Th>
                  <Th>Due</Th>
                  <Th>Status</Th>
                  <Th>
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {remittances.map((r) => {
                  const overdue = r.status === "Due" && r.dueDate < today;
                  return (
                    <Tr key={r.id}>
                      <Td>
                        <span className="font-medium text-ink">{r.authority}</span>
                      </Td>
                      <Td numeric>{formatINR(r.amountPaise)}</Td>
                      <Td>
                        {/* Overdue statutory money is a genuine problem. */}
                        <span
                          className={
                            overdue ? "tabular font-medium text-danger" : "tabular text-secondary"
                          }
                        >
                          {formatDate(r.dueDate)}
                          {overdue ? ", overdue" : ""}
                        </span>
                      </Td>
                      <Td>
                        <Status tone={r.status === "Remitted" ? "done" : overdue ? "problem" : "action"}>
                          {r.status}
                        </Status>
                      </Td>
                      <Td className="text-right">
                        {r.status === "Due" ? <RemitButton id={r.id} /> : null}
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
