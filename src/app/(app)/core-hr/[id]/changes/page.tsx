import { History } from "lucide-react";
import { requirePage } from "@/lib/access";
import { listChanges } from "@/lib/repositories/change-log";
import { Card, CardHeader, EmptyState } from "@/components/ui";
import { ChangeLogTable } from "@/components/change-log";
import { Pagination, pageFrom } from "@/components/pagination";

/**
 * Every change to this person's records: who made it, when, and what it was
 * before and after. The writes half of the audit trail; the access log is
 * the reads half.
 *
 * HR-only, like the rest of the employee record (the layout checks).
 */
export default async function EmployeeChangeLogPage(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  await requirePage(["audit.view"]);
  const [{ id }, params] = await Promise.all([props.params, props.searchParams]);
  const employeeId = Number(id);
  const { page, limit, offset } = pageFrom(params.page);
  const { rows, total } = await listChanges({ subjectEmployeeId: employeeId }, limit, offset);

  return (
    <Card>
      <CardHeader
        title="Change log"
        description="Every change to this person's records, newest first, with the value before and after."
      />
      {rows.length === 0 ? (
        <EmptyState icon={<History />} title="No changes recorded yet">
          Changes made from now on — a new salary, a transfer, an approved leave — are listed
          here with who made them.
        </EmptyState>
      ) : (
        <>
          <ChangeLogTable rows={rows} />
          <Pagination
            page={page}
            total={total}
            path={`/core-hr/${employeeId}/changes`}
            noun="changes"
          />
        </>
      )}
    </Card>
  );
}
