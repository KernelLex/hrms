import { asc, desc, eq } from "drizzle-orm";
import { Users2 } from "lucide-react";
import { requirePage, can } from "@/lib/access";
import { db } from "@/lib/db";
import { omHeadcountRequest, omOrgUnit, omJob } from "@/db/schema";
import { formatINR } from "@/lib/money";
import { formatTimestamp } from "@/lib/dates";
import { Card, PageHeader, EmptyState, Status, Table, Th, Tr, Td, TwoLine, type Tone } from "@/components/ui";
import { NewHeadcountRequestButton } from "./form";

const STATUS_TONE: Record<string, Tone> = { Pending: "waiting", Approved: "done", Rejected: "problem", Cancelled: "neutral" };

export default async function HeadcountRequestsPage() {
  const session = await requirePage(["employee.view_team", "org.edit"], "/");
  const isHr = can(session, "org.edit");

  const [units, jobs] = await Promise.all([
    db.select().from(omOrgUnit).where(eq(omOrgUnit.isActive, true)).orderBy(asc(omOrgUnit.code)),
    db.select().from(omJob).where(eq(omJob.isActive, true)).orderBy(asc(omJob.code)),
  ]);

  const rows = isHr
    ? await db.select().from(omHeadcountRequest).orderBy(desc(omHeadcountRequest.id))
    : session.employeeId
      ? await db
          .select()
          .from(omHeadcountRequest)
          .where(eq(omHeadcountRequest.requestedByEmployeeId, session.employeeId))
          .orderBy(desc(omHeadcountRequest.id))
      : [];

  const unitName = new Map(units.map((u) => [u.code, u.name]));
  const jobTitle = new Map(jobs.map((j) => [j.code, j.title]));

  return (
    <>
      <PageHeader
        title="Headcount requests"
        subtitle={isHr ? "Every request to open a new position, and what came of it." : "New positions you have asked for, and their approval."}
        actions={<NewHeadcountRequestButton units={units.map((u) => ({ value: u.code, label: `${u.code} — ${u.name}` }))} jobs={jobs.map((j) => ({ value: j.code, label: `${j.code} — ${j.title}` }))} />}
      />

      <Card>
        {rows.length === 0 ? (
          <EmptyState icon={<Users2 />} title="No requests yet">
            Ask for a new position, and its approval appears here.
          </EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Position</Th>
                <Th>Department</Th>
                <Th numeric>Budget</Th>
                <Th>Asked by</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Tr key={r.id}>
                  <Td>
                    <TwoLine value={r.title} sub={r.grade ?? undefined} />
                  </Td>
                  <Td>
                    <TwoLine value={unitName.get(r.orgUnitCode) ?? r.orgUnitCode} sub={jobTitle.get(r.jobCode)} />
                  </Td>
                  <Td numeric>
                    <span className="tabular text-secondary">{formatINR(r.budgetPaise)}</span>
                  </Td>
                  <Td>
                    <TwoLine value={r.requestedByName} sub={formatTimestamp(r.requestedAt)} />
                  </Td>
                  <Td>
                    <Status tone={STATUS_TONE[r.status] ?? "neutral"}>
                      {r.status}
                      {r.status === "Approved" && r.positionCode ? ` · ${r.positionCode}` : ""}
                    </Status>
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
