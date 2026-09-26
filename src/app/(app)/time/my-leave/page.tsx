import { redirect } from "next/navigation";
import { asc, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { ptLeaveRequest, ptAbsenceType } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { balancesFor, formatDays } from "@/lib/engines/quota";
import {
  Card,
  PageHeader,
  FigureRow,
  Figure,
  Table,
  Th,
  Tr,
  Td,
  Status,
  EmptyState,
  Notice,
} from "@/components/ui";
import { CalendarCheck } from "lucide-react";
import { RequestLeaveForm } from "./form";
import { CancelRequest } from "./cancel";

/** Employee self-service: balances, a request form, and your own history. */
export default async function MyLeavePage() {
  const session = await getSession();
  if (!session) redirect("/sign-in");

  if (!session.employeeId) {
    return (
      <>
        <PageHeader
          title="My leave"
          subtitle="Your entitlement, your requests and where each one stands."
        />
        <Notice>
          This sign-in is not linked to an employee record, so there is no leave
          to show. HR accounts that are not themselves employees see the approval
          queue instead.
        </Notice>
      </>
    );
  }

  const employeeId = session.employeeId;
  const year = new Date().getUTCFullYear();

  const [balances, types, requests] = await Promise.all([
    balancesFor(employeeId, year),
    db
      .select()
      .from(ptAbsenceType)
      .where(eq(ptAbsenceType.isActive, true))
      .orderBy(asc(ptAbsenceType.code)),
    db
      .select({
        id: ptLeaveRequest.id,
        typeName: ptAbsenceType.name,
        isPaid: ptAbsenceType.isPaid,
        fromDate: ptLeaveRequest.fromDate,
        toDate: ptLeaveRequest.toDate,
        payrollDays: ptLeaveRequest.payrollDays,
        reason: ptLeaveRequest.reason,
        status: ptLeaveRequest.status,
        decisionNote: ptLeaveRequest.decisionNote,
      })
      .from(ptLeaveRequest)
      .innerJoin(ptAbsenceType, eq(ptAbsenceType.code, ptLeaveRequest.absenceTypeCode))
      .where(eq(ptLeaveRequest.employeeId, employeeId))
      .orderBy(desc(ptLeaveRequest.submittedAt)),
  ]);

  const annual = balances.find((b) => b.quotaTypeCode === "ANNUAL");
  const sick = balances.find((b) => b.quotaTypeCode === "SICK");
  const casual = balances.find((b) => b.quotaTypeCode === "CASUAL");
  const pendingCount = requests.filter((r) => r.status === "Pending").length;

  return (
    <>
      <PageHeader
        title="My leave"
        subtitle={`Your entitlement for ${year}, and where each request stands.`}
      />

      <FigureRow>
        <Figure
          label="Annual leave left"
          value={annual ? formatDays(annual.balanceUnits) : "—"}
          hint={annual ? `of ${formatDays(annual.entitledUnits)} days` : "no quota yet"}
        />
        <Figure
          label="Sick leave left"
          value={sick ? formatDays(sick.balanceUnits) : "—"}
          hint={sick ? `of ${formatDays(sick.entitledUnits)} days` : "no quota yet"}
        />
        <Figure
          label="Casual leave left"
          value={casual ? formatDays(casual.balanceUnits) : "—"}
          hint={casual ? `of ${formatDays(casual.entitledUnits)} days` : "no quota yet"}
        />
        <Figure
          label="Awaiting a decision"
          value={pendingCount}
          hint={pendingCount === 1 ? "request" : "requests"}
        />
      </FigureRow>

      <div className="mt-6">
        <RequestLeaveForm
          types={types.map((t) => ({
            value: t.code,
            label: `${t.name}${t.isPaid ? "" : " (unpaid)"}`,
          }))}
        />
      </div>

      <div className="mt-6">
        <Card>
          <div className="px-6 pt-5 pb-3">
            <h2 className="text-[15px] font-semibold text-ink">My requests</h2>
          </div>
          {requests.length === 0 ? (
            <EmptyState icon={<CalendarCheck />} title="No requests yet">
              Apply above and it will appear here with its status.
            </EmptyState>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Leave</Th>
                  <Th>Dates</Th>
                  <Th numeric>Days</Th>
                  <Th>Status</Th>
                  <Th>Note</Th>
                  <Th>
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {requests.map((r) => (
                  <Tr key={r.id}>
                    <Td>
                      <span className="font-medium text-ink">{r.typeName}</span>
                      {r.isPaid ? null : (
                        <span className="ml-2 text-[13px] text-muted">unpaid</span>
                      )}
                    </Td>
                    <Td>
                      <span className="tabular text-secondary">
                        {r.fromDate === r.toDate ? r.fromDate : `${r.fromDate} to ${r.toDate}`}
                      </span>
                    </Td>
                    <Td numeric>{r.payrollDays}</Td>
                    <Td>
                      <Status
                        tone={
                          r.status === "Approved"
                            ? "done"
                            : r.status === "Pending"
                              ? "waiting"
                              : r.status === "Rejected"
                                ? "problem"
                                : "neutral"
                        }
                      >
                        {r.status}
                      </Status>
                    </Td>
                    <Td>
                      <span className="text-secondary">
                        {r.decisionNote ?? <span className="text-decor">&mdash;</span>}
                      </span>
                    </Td>
                    <Td className="text-right">
                      {r.status === "Pending" ? <CancelRequest id={r.id} /> : null}
                    </Td>
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
