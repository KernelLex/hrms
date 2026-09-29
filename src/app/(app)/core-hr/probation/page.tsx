import Link from "next/link";
import { requirePage } from "@/lib/access";
import { probationDueList } from "@/lib/repositories/lifecycle";
import { PageHeader, Card, CardBody, EmptyState, Status } from "@/components/ui";
import { formatDate } from "@/lib/dates";
import { UserCheck } from "lucide-react";
import { ProbationActions } from "../[id]/career/actions";

export default async function ProbationDuePage() {
  await requirePage(["employee.edit"]);
  const due = await probationDueList(30);

  return (
    <>
      <PageHeader title="Probation due" subtitle="Reviews due in the next 30 days, or already overdue." />
      <Card>
        <CardBody>
          {due.length === 0 ? (
            <EmptyState icon={<UserCheck />} title="Nothing due">No probation review falls due in the next 30 days.</EmptyState>
          ) : (
            <ul className="flex flex-col gap-5">
              {due.map((d) => (
                <li key={d.id} className="flex flex-col gap-2 border-b border-soft pb-5 last:border-0 last:pb-0">
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <Link href={`/core-hr/${d.employeeId}/career`} className="text-[13px] font-medium text-ink hover:underline">
                        {d.employeeName}
                      </Link>
                      <p className="text-[13px] text-muted">
                        {d.employeeNumber}
                        {d.positionTitle ? ` · ${d.positionTitle}` : ""} · due {formatDate(d.date)}
                      </p>
                    </div>
                    <Status tone={d.overdue ? "problem" : "waiting"}>{d.overdue ? "Overdue" : "Due soon"}</Status>
                  </div>
                  <ProbationActions id={d.id} />
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </>
  );
}
