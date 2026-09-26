import { redirect } from "next/navigation";
import { asc, desc, eq } from "drizzle-orm";
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
import { getSession, hasRole } from "@/lib/auth";
import { formatINR } from "@/lib/money";
import {
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
import { Landmark } from "lucide-react";
import { PayrollTabs } from "../tabs";
import { PostingForms, RemitButton } from "./forms";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** PY-05 — bank transfer file, ledger posting and statutory remittance. */
export default async function PostingPage(props: {
  searchParams: Promise<{ run?: string }>;
}) {
  const session = await getSession();
  if (!hasRole(session, "HR_ADMIN")) redirect("/payroll/my-payslips");

  const params = await props.searchParams;

  const runs = await db
    .select({
      id: pyPayrollRun.id,
      runAt: pyPayrollRun.runAt,
      netTotalPaise: pyPayrollRun.netTotalPaise,
      errorCount: pyPayrollRun.errorCount,
      year: pyPayrollPeriod.year,
      month: pyPayrollPeriod.month,
      areaCode: pyPayrollPeriod.areaCode,
      periodStatus: pyPayrollPeriod.status,
    })
    .from(pyPayrollRun)
    .innerJoin(pyPayrollPeriod, eq(pyPayrollPeriod.id, pyPayrollRun.periodId))
    .orderBy(desc(pyPayrollRun.runAt));

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

  const [bankLines, glLines] = await Promise.all([
    bankFile
      ? db
          .select()
          .from(pyBankTransferLine)
          .where(eq(pyBankTransferLine.fileId, bankFile.id))
      : Promise.resolve([]),
    posting
      ? db.select().from(pyGlPostingLine).where(eq(pyGlPostingLine.postingId, posting.id))
      : Promise.resolve([]),
  ]);

  const totalDebit = glLines.reduce((s, l) => s + l.debitPaise, 0);
  const totalCredit = glLines.reduce((s, l) => s + l.creditPaise, 0);
  const balanced = totalDebit === totalCredit;
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <PayrollTabs />
      <PageHeader
        title="Bank and posting"
        subtitle={`${MONTHS[run.month - 1]} ${run.year}, ${run.areaCode}. Net payable ${formatINR(run.netTotalPaise)}.`}
      />

      <PostingForms
        runs={runs.map((r) => ({
          value: String(r.id),
          label: `${MONTHS[r.month - 1]} ${r.year} — ${r.areaCode}`,
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
                ? `${bankFile.lineCount} payments totalling ${formatINR(bankFile.totalPaise)}, ${bankFile.format}.`
                : "Generate the payment file once the run is correct."
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
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>

      {/* Ledger posting */}
      <div className="mt-6">
        <Card>
          <CardHeader
            title="Ledger posting"
            description={
              posting
                ? `Posted ${posting.postingDate} by ${posting.postedBy}.`
                : "Posts salary expense and the payables it creates."
            }
          />
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
                      <Td numeric>
                        {l.debitPaise > 0 ? formatINR(l.debitPaise) : <span className="text-decor">&mdash;</span>}
                      </Td>
                      <Td numeric>
                        {l.creditPaise > 0 ? formatINR(l.creditPaise) : <span className="text-decor">&mdash;</span>}
                      </Td>
                    </Tr>
                  ))}
                  <Tr>
                    <Td colSpan={2}>
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
                          {r.dueDate}
                          {overdue ? " — overdue" : ""}
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
