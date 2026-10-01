import { requirePage } from "@/lib/access";
import { asc, desc, eq } from "drizzle-orm";
import { db, rawClient } from "@/lib/db";
import { pyClaim, pyClaimCategory } from "@/db/schema";
import { formatINR } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { Card, PageHeader, Table, Th, Tr, Td, Status, EmptyState, Notice, CardHeader } from "@/components/ui";
import { FileText, ReceiptText } from "lucide-react";
import { RequestClaimForm } from "./form";
import { WithdrawClaim } from "./cancel";

const STATUS_TONE = { Pending: "waiting", Approved: "done", Rejected: "problem" } as const;

/** Employee self-service: submit a reimbursement claim with its bills, and see where each one stands. */
export default async function MyClaimsPage() {
  const session = await requirePage(["self.claims"]);

  if (!session.employeeId) {
    return (
      <>
        <PageHeader title="My claims" subtitle="Submit a reimbursement claim with its bills." />
        <Notice>This sign-in is not linked to an employee record, so there is nothing to show here.</Notice>
      </>
    );
  }

  const employeeId = session.employeeId;
  const [categories, claims] = await Promise.all([
    db.select().from(pyClaimCategory).where(eq(pyClaimCategory.isActive, true)).orderBy(asc(pyClaimCategory.name)),
    db
      .select({
        id: pyClaim.id,
        categoryName: pyClaimCategory.name,
        claimDate: pyClaim.claimDate,
        totalAmountPaise: pyClaim.totalAmountPaise,
        status: pyClaim.status,
        decisionNote: pyClaim.decisionNote,
      })
      .from(pyClaim)
      .innerJoin(pyClaimCategory, eq(pyClaimCategory.code, pyClaim.categoryCode))
      .where(eq(pyClaim.employeeId, employeeId))
      .orderBy(desc(pyClaim.requestedAt)),
  ]);

  const claimIds = claims.map((c) => c.id);
  const linesWithBills =
    claimIds.length === 0
      ? []
      : (
          await rawClient().execute({
            sql: `SELECT cl.claim_id, cl.description, cl.amount_paise, d.id AS document_id, d.file_name
                  FROM py_claim_line cl LEFT JOIN app_document d ON d.owner_type = 'claim_line' AND d.owner_id = cl.id
                  WHERE cl.claim_id IN (${claimIds.map(() => "?").join(", ")})`,
            args: claimIds,
          })
        ).rows;
  const billsFor = (claimId: number) => linesWithBills.filter((l) => Number(l.claim_id) === claimId);

  return (
    <>
      <PageHeader title="My claims" subtitle="Submit a reimbursement claim with its bills, and see where each one stands." />

      <RequestClaimForm categories={categories.map((c) => ({ value: c.code, label: c.name }))} />

      <div className="mt-6">
        <Card>
          <CardHeader title="My claims" />
          {claims.length === 0 ? (
            <EmptyState icon={<ReceiptText />} title="No claims yet">
              Submit one above and it will appear here with its status.
            </EmptyState>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Category</Th>
                  <Th>Date</Th>
                  <Th numeric>Amount</Th>
                  <Th>Bills</Th>
                  <Th>Status</Th>
                  <Th>
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {claims.map((c) => (
                  <Tr key={c.id}>
                    <Td>
                      <span className="font-medium text-ink">{c.categoryName}</span>
                    </Td>
                    <Td>
                      <span className="tabular text-secondary">{formatDate(c.claimDate)}</span>
                    </Td>
                    <Td numeric>{formatINR(c.totalAmountPaise)}</Td>
                    <Td>
                      <div className="flex flex-wrap gap-2">
                        {billsFor(c.id)
                          .filter((l) => l.document_id !== null)
                          .map((l) => (
                            <a key={Number(l.document_id)} href={`/api/documents/${Number(l.document_id)}`} className="inline-flex items-center gap-1 text-[13px] text-ink underline underline-offset-2">
                              <FileText className="size-3.5" />
                              {String(l.file_name)}
                            </a>
                          ))}
                        {billsFor(c.id).filter((l) => l.document_id !== null).length === 0 ? <span className="text-decor">&mdash;</span> : null}
                      </div>
                    </Td>
                    <Td>
                      <Status tone={STATUS_TONE[c.status as keyof typeof STATUS_TONE] ?? "neutral"}>{c.status}</Status>
                      {c.decisionNote ? <p className="mt-0.5 text-[13px] text-muted">&ldquo;{c.decisionNote}&rdquo;</p> : null}
                    </Td>
                    <Td className="text-right">{c.status === "Pending" ? <WithdrawClaim id={c.id} /> : null}</Td>
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
