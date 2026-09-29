import { requirePage } from "@/lib/access";
import { tasksFor, type TaskRow } from "@/lib/repositories/lifecycle";
import { PageHeader, Card, CardHeader, CardBody, EmptyState, Status } from "@/components/ui";
import { formatDate } from "@/lib/dates";
import { ListChecks } from "lucide-react";
import { CompleteTaskButton } from "./complete-button";

function TaskRowItem({ t, done }: { t: TaskRow; done: boolean }) {
  return (
    <li className="flex items-center justify-between gap-4 text-[13px]">
      <div className="min-w-0">
        <p className="text-ink">{t.task}</p>
        <p className="text-muted">
          {t.employeeName} · due {formatDate(t.dueDate)}
        </p>
      </div>
      {done ? (
        <Status tone="done">Done</Status>
      ) : t.overdue ? (
        <div className="flex items-center gap-2">
          <Status tone="problem">Overdue</Status>
          <CompleteTaskButton id={t.id} />
        </div>
      ) : (
        <CompleteTaskButton id={t.id} />
      )}
    </li>
  );
}

export default async function TasksPage() {
  const session = await requirePage(["self.profile"]);
  const { open, done } = await tasksFor(session.userId);

  return (
    <>
      <PageHeader title="My tasks" subtitle="What onboarding needs from you, for the people you are managing or helping settle in." />
      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader title="Open" />
          <CardBody>
            {open.length === 0 ? (
              <EmptyState icon={<ListChecks />} title="Nothing open">You have no onboarding tasks waiting.</EmptyState>
            ) : (
              <ul className="flex flex-col gap-3">
                {open.map((t) => (
                  <TaskRowItem key={t.id} t={t} done={false} />
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        {done.length > 0 ? (
          <Card>
            <CardHeader title="Recently done" />
            <CardBody>
              <ul className="flex flex-col gap-3">
                {done.map((t) => (
                  <TaskRowItem key={t.id} t={t} done />
                ))}
              </ul>
            </CardBody>
          </Card>
        ) : null}
      </div>
    </>
  );
}
