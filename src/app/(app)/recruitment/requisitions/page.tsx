import Link from "next/link";
import { Briefcase, Plus } from "lucide-react";
import { requirePage } from "@/lib/access";
import { listRequisitions } from "@/lib/repositories/recruitment";
import { formatDate } from "@/lib/dates";
import { ButtonLink, Card, EmptyState, PageHeader, Status, Table, Th, Tr, Td, TwoLine } from "@/components/ui";
import { RecruitmentTabs } from "../tabs";

/** RC-01 — job requisitions: each a vacant position and the role it offers. */
export default async function RequisitionsPage() {
  await requirePage(["recruitment.manage"], "/");
  const requisitions = await listRequisitions();

  return (
    <>
      <RecruitmentTabs />
      <PageHeader
        title="Requisitions"
        subtitle="Each opens hiring for a vacant position and describes the role. Publish one to take applications on the careers page."
        actions={
          <ButtonLink href="/recruitment/requisitions/new" variant="primary">
            <Plus />
            Open a requisition
          </ButtonLink>
        }
      />
      <Card>
        {requisitions.length === 0 ? (
          <EmptyState icon={<Briefcase />} title="No requisitions yet">
            Open one against a vacant position to start hiring for it.
          </EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Role</Th>
                <Th>Department</Th>
                <Th numeric>Openings</Th>
                <Th numeric>New</Th>
                <Th numeric>Interviewing</Th>
                <Th numeric>Offered</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {requisitions.map((r) => (
                <Tr key={r.id}>
                  <Td>
                    <Link href={`/recruitment/requisitions/${r.code}`} className="hover:underline">
                      <TwoLine value={r.title} sub={`${r.code}, posted ${formatDate(r.postedDate)}`} />
                    </Link>
                  </Td>
                  <Td>
                    <span className="text-secondary">{r.department}</span>
                  </Td>
                  <Td numeric>
                    {r.counts.Hired > 0 ? `${r.counts.Hired} of ${r.openings}` : r.openings}
                  </Td>
                  <Td numeric>{r.counts.Applied || <span className="text-decor">&mdash;</span>}</Td>
                  <Td numeric>{r.counts.Interviewing + r.counts.Selected || <span className="text-decor">&mdash;</span>}</Td>
                  <Td numeric>{r.counts.Offered || <span className="text-decor">&mdash;</span>}</Td>
                  <Td>
                    <div className="flex flex-wrap items-center gap-2">
                      <Status tone={r.status === "Open" ? "action" : r.status === "On hold" ? "waiting" : "neutral"}>{r.status}</Status>
                      {r.isPublished ? <span className="text-xs text-muted">On careers page</span> : null}
                    </div>
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
