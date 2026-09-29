import { can, getAccess } from "@/lib/access";
import { checklistFor, lettersFor, letterTemplates, monitoringFor } from "@/lib/repositories/lifecycle";
import { Card, CardBody, CardHeader, EmptyState, Status, Table, Td, Th, Tr } from "@/components/ui";
import { formatDate } from "@/lib/dates";
import { IssueLetterButton, ProbationActions } from "./actions";

const TASK_TONE = { Pending: "waiting", Done: "done" } as const;
const REVIEW_TONE = { Pending: "waiting", Confirmed: "done", Extended: "neutral", Ended: "problem" } as const;

export default async function CareerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const employeeId = Number(id);
  const session = await getAccess();
  const mayEdit = !!session && can(session, "employee.edit");

  const [checklist, monitoring, letters, templates] = await Promise.all([
    checklistFor(employeeId),
    monitoringFor(employeeId),
    lettersFor(employeeId),
    letterTemplates(),
  ]);
  const pendingReview = monitoring.find((m) => m.status === "Pending");

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader
          title="Onboarding"
          description={
            !checklist
              ? "No onboarding checklist on record."
              : checklist.completedAt
                ? `Finished ${formatDate(checklist.completedAt)}.`
                : "In progress."
          }
        />
        {checklist ? (
          <CardBody>
            <ul className="flex flex-col gap-3">
              {checklist.tasks.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-4 text-[13px]">
                  <div className="min-w-0">
                    <p className="text-ink">{t.task}</p>
                    <p className="text-muted">
                      {t.assigneeName ?? "Unassigned"} · due {formatDate(t.dueDate)}
                    </p>
                  </div>
                  <Status tone={TASK_TONE[t.status as keyof typeof TASK_TONE] ?? "neutral"}>{t.status}</Status>
                </li>
              ))}
            </ul>
          </CardBody>
        ) : null}
      </Card>

      <Card>
        <CardHeader title="Probation" description="Reviewed once, from the hire or conversion date." />
        <CardBody>
          {monitoring.length === 0 ? (
            <EmptyState title="No probation reviews">Nothing has been scheduled for this record.</EmptyState>
          ) : (
            <ul className="flex flex-col gap-3">
              {monitoring.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-4 text-[13px]">
                  <div className="min-w-0">
                    <p className="text-ink">{formatDate(m.date)}</p>
                    {m.note ? <p className="text-muted">{m.note}</p> : null}
                  </div>
                  <Status tone={REVIEW_TONE[m.status as keyof typeof REVIEW_TONE] ?? "neutral"}>{m.status}</Status>
                </li>
              ))}
            </ul>
          )}
          {mayEdit && pendingReview ? <ProbationActions id={pendingReview.id} /> : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Letters"
          description="Issued from a template, kept exactly as given."
          actions={mayEdit ? <IssueLetterButton employeeId={employeeId} templates={templates} /> : null}
        />
        <CardBody>
          {letters.length === 0 ? (
            <EmptyState title="No letters issued" />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Kind</Th>
                  <Th>Issue date</Th>
                  <Th>Issued by</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {letters.map((l) => (
                  <Tr key={l.id}>
                    <Td>{l.kind}</Td>
                    <Td>{formatDate(l.issueDate)}</Td>
                    <Td>{l.issuedBy}</Td>
                    <Td>
                      <a href={`/api/letters/${l.id}/pdf`} target="_blank" rel="noreferrer" className="text-[13px] text-ink underline underline-offset-2">
                        View PDF
                      </a>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
