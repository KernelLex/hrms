import { requirePage } from "@/lib/access";
import { listNominations } from "@/lib/repositories/training";
import { formatDate } from "@/lib/dates";
import { Card, PageHeader, Table, Th, Tr, Td, Status, EmptyState } from "@/components/ui";
import { TrainingTabs } from "../tabs";
import { DecideNominationForm, AttendanceForm } from "./form";

const TONE: Record<string, "waiting" | "done" | "neutral"> = { Requested: "waiting", Approved: "done", Rejected: "neutral" };

/** Every nomination, decided against the department's training budget for the year, and attendance recorded afterwards. */
export default async function NominationsPage() {
  await requirePage(["training.manage"], "/training/my-training");
  const nominations = await listNominations();

  return (
    <>
      <TrainingTabs />
      <PageHeader title="Nominations" subtitle="Approving checks the nominee's department budget for the session's year." />

      <Card>
        {nominations.length === 0 ? (
          <EmptyState title="No nominations yet" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Employee</Th>
                <Th>Course</Th>
                <Th>Starts</Th>
                <Th>Status</Th>
                <Th>Attended</Th>
              </tr>
            </thead>
            <tbody>
              {nominations.map((n) => (
                <Tr key={n.id}>
                  <Td>
                    <span className="font-medium text-ink">{n.employeeName}</span>
                  </Td>
                  <Td>{n.courseTitle}</Td>
                  <Td>
                    <span className="tabular text-secondary">{formatDate(n.startDate)}</span>
                  </Td>
                  <Td>
                    {n.status === "Requested" ? <DecideNominationForm id={n.id} /> : <Status tone={TONE[n.status] ?? "neutral"}>{n.status}</Status>}
                  </Td>
                  <Td>{n.status === "Approved" ? <AttendanceForm id={n.id} attended={n.attended} /> : <span className="text-decor">&mdash;</span>}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
