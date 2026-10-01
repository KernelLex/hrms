import { requirePage } from "@/lib/access";
import { listSessions, listNominations, listCertifications } from "@/lib/repositories/training";
import { formatDate } from "@/lib/dates";
import { Card, CardHeader, PageHeader, Table, Th, Tr, Td, Status, EmptyState, Notice } from "@/components/ui";
import { TrainingTabs } from "../tabs";
import { NominateForm, CertificationForm, DeleteCertificationButton } from "./form";

const TONE: Record<string, "waiting" | "done" | "neutral"> = { Requested: "waiting", Approved: "done", Rejected: "neutral" };

/** Self-service: nominate for a session, see where your nominations stand, and keep your certifications on file. */
export default async function MyTrainingPage() {
  const session = await requirePage(["self.training"]);
  if (!session.employeeId) {
    return (
      <>
        <PageHeader title="My training" subtitle="Nominate yourself for a session, and keep your certifications on file." />
        <Notice>This sign-in is not linked to an employee record.</Notice>
      </>
    );
  }
  const employeeId = session.employeeId;

  const [sessions, nominations, certifications] = await Promise.all([listSessions(), listNominations({ employeeId }), listCertifications(employeeId)]);
  const nominatedSessionIds = new Set(nominations.map((n) => n.sessionId));
  const upcoming = sessions.filter((s) => s.startDate >= new Date().toISOString().slice(0, 10) && !nominatedSessionIds.has(s.id));

  return (
    <>
      <TrainingTabs />
      <PageHeader title="My training" subtitle="Nominate yourself for a session, and keep your certifications on file." />

      <Card>
        <CardHeader title="Available sessions" />
        {upcoming.length === 0 ? (
          <EmptyState title="Nothing open to nominate for right now" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Course</Th>
                <Th>Starts</Th>
                <Th>Seats</Th>
                <Th></Th>
              </tr>
            </thead>
            <tbody>
              {upcoming.map((s) => (
                <Tr key={s.id}>
                  <Td>{s.courseTitle}</Td>
                  <Td>
                    <span className="tabular text-secondary">{formatDate(s.startDate)}</span>
                  </Td>
                  <Td>{s.approved}/{s.capacity}</Td>
                  <Td>
                    <NominateForm sessionId={s.id} full={s.approved >= s.capacity} />
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <div className="mt-6">
        <Card>
          <CardHeader title="My nominations" />
          {nominations.length === 0 ? (
            <EmptyState title="No nominations yet" />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Course</Th>
                  <Th>Starts</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {nominations.map((n) => (
                  <Tr key={n.id}>
                    <Td>{n.courseTitle}</Td>
                    <Td>
                      <span className="tabular text-secondary">{formatDate(n.startDate)}</span>
                    </Td>
                    <Td>
                      <Status tone={TONE[n.status] ?? "neutral"}>{n.status}</Status>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>

      <div className="mt-6">
        <Card>
          <CardHeader title="My certifications" />
          <div className="px-6 pb-5">
            <CertificationForm />
          </div>
          {certifications.length > 0 ? (
            <Table>
              <thead>
                <tr>
                  <Th>Name</Th>
                  <Th>Issuer</Th>
                  <Th>Issued</Th>
                  <Th>Expires</Th>
                  <Th></Th>
                </tr>
              </thead>
              <tbody>
                {certifications.map((c) => (
                  <Tr key={c.id}>
                    <Td>
                      <span className="font-medium text-ink">{c.name}</span>
                    </Td>
                    <Td>{c.issuer ?? "—"}</Td>
                    <Td>
                      <span className="tabular text-secondary">{formatDate(c.issuedDate)}</span>
                    </Td>
                    <Td>{c.expiryDate ? <span className="tabular text-secondary">{formatDate(c.expiryDate)}</span> : <span className="text-decor">&mdash;</span>}</Td>
                    <Td>
                      <DeleteCertificationButton id={c.id} />
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          ) : null}
        </Card>
      </div>
    </>
  );
}
