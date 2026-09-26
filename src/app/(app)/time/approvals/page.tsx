import { redirect } from "next/navigation";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { ptLeaveRequest, ptAbsenceType, ptAbsenceQuota } from "@/db/schema";
import { getSession, hasRole } from "@/lib/auth";
import {
  listEmployees,
  listDirectReports,
  fullName,
} from "@/lib/repositories/employees";
import { formatDays } from "@/lib/engines/quota";
import { formatDateRange } from "@/lib/dates";
import {
  Card,
  PageHeader,
  Table,
  Th,
  Tr,
  Td,
  TwoLine,
  Status,
  EmptyState,
} from "@/components/ui";
import { Inbox } from "lucide-react";
import { DecisionButtons } from "./decision";

/**
 * The manager's approval queue.
 *
 * HR sees every pending request; a manager sees only their direct reports, so
 * the queue is something they can actually finish rather than a company-wide
 * list they must filter mentally.
 */
export default async function ApprovalsPage() {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  if (!hasRole(session, "HR_ADMIN", "MANAGER")) redirect("/");

  const isHr = hasRole(session, "HR_ADMIN");

  const visibleIds = isHr
    ? null
    : session.employeeId
      ? (await listDirectReports(session.employeeId)).map((e) => e.id)
      : [];

  const requests =
    visibleIds !== null && visibleIds.length === 0
      ? []
      : await db
          .select({
            id: ptLeaveRequest.id,
            employeeId: ptLeaveRequest.employeeId,
            typeName: ptAbsenceType.name,
            isPaid: ptAbsenceType.isPaid,
            fromDate: ptLeaveRequest.fromDate,
            toDate: ptLeaveRequest.toDate,
            payrollDays: ptLeaveRequest.payrollDays,
            reason: ptLeaveRequest.reason,
            status: ptLeaveRequest.status,
            submittedAt: ptLeaveRequest.submittedAt,
          })
          .from(ptLeaveRequest)
          .innerJoin(ptAbsenceType, eq(ptAbsenceType.code, ptLeaveRequest.absenceTypeCode))
          .where(
            visibleIds === null
              ? undefined
              : inArray(ptLeaveRequest.employeeId, visibleIds),
          )
          .orderBy(desc(ptLeaveRequest.submittedAt));

  const pending = requests.filter((r) => r.status === "Pending");
  const decided = requests.filter((r) => r.status !== "Pending").slice(0, 10);

  // Names, and every requester's annual balance, in one read each rather
  // than one per request.
  const year = new Date().getUTCFullYear();
  const requesters = [...new Set(pending.map((r) => r.employeeId))];
  const [employees, quotas] = await Promise.all([
    listEmployees(),
    requesters.length === 0
      ? Promise.resolve([])
      : db
          .select({
            employeeId: ptAbsenceQuota.employeeId,
            entitled: ptAbsenceQuota.entitledHalfDays,
            used: ptAbsenceQuota.usedHalfDays,
          })
          .from(ptAbsenceQuota)
          .where(
            and(
              inArray(ptAbsenceQuota.employeeId, requesters),
              eq(ptAbsenceQuota.year, year),
              eq(ptAbsenceQuota.quotaTypeCode, "ANNUAL"),
            ),
          ),
  ]);
  const name = new Map(employees.map((e) => [e.id, fullName(e)]));
  const numberOf = new Map(employees.map((e) => [e.id, e.employee_number]));
  const balances = new Map(
    quotas.map((q) => [q.employeeId, `${formatDays(q.entitled - q.used)} days left`]),
  );

  return (
    <>
      <PageHeader
        title="Approvals"
        subtitle={
          isHr
            ? "Every leave request waiting on a decision."
            : "Leave requests from the people who report to you."
        }
      />

      <Card>
        {pending.length === 0 ? (
          <EmptyState icon={<Inbox />} title="Nothing waiting">
            Requests appear here as soon as someone submits one.
          </EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Employee</Th>
                <Th>Leave</Th>
                <Th>Dates</Th>
                <Th numeric>Days</Th>
                <Th>Balance</Th>
                <Th>Reason</Th>
                <Th>
                  <span className="sr-only">Decision</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {pending.map((r) => (
                <Tr key={r.id}>
                  <Td>
                    <TwoLine
                      value={name.get(r.employeeId) ?? "—"}
                      sub={numberOf.get(r.employeeId)}
                    />
                  </Td>
                  <Td>
                    <span className="text-secondary">
                      {r.typeName}
                      {r.isPaid ? "" : " (unpaid)"}
                    </span>
                  </Td>
                  <Td>
                    <span className="tabular text-secondary">
                      {formatDateRange(r.fromDate, r.toDate)}
                    </span>
                  </Td>
                  <Td numeric>{r.payrollDays}</Td>
                  <Td>
                    <span className="text-[13px] text-muted">
                      {balances.get(r.employeeId) ?? "no quota"}
                    </span>
                  </Td>
                  <Td>
                    <span className="text-secondary">
                      {r.reason ?? <span className="text-decor">&mdash;</span>}
                    </span>
                  </Td>
                  <Td className="text-right whitespace-nowrap">
                    <DecisionButtons
                      id={r.id}
                      describe={`${name.get(r.employeeId) ?? "This employee"}, ${r.payrollDays} day${r.payrollDays === 1 ? "" : "s"}, ${formatDateRange(r.fromDate, r.toDate)}`}
                    />
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {decided.length > 0 ? (
        <div className="mt-6">
          <Card>
            <div className="px-6 pt-5 pb-3">
              <h2 className="text-[15px] font-semibold text-ink">Recently decided</h2>
            </div>
            <Table>
              <thead>
                <tr>
                  <Th>Employee</Th>
                  <Th>Leave</Th>
                  <Th>Dates</Th>
                  <Th numeric>Days</Th>
                  <Th>Outcome</Th>
                </tr>
              </thead>
              <tbody>
                {decided.map((r) => (
                  <Tr key={r.id}>
                    <Td>{name.get(r.employeeId) ?? "—"}</Td>
                    <Td>
                      <span className="text-secondary">{r.typeName}</span>
                    </Td>
                    <Td>
                      <span className="tabular text-secondary">
                        {formatDateRange(r.fromDate, r.toDate)}
                      </span>
                    </Td>
                    <Td numeric>{r.payrollDays}</Td>
                    <Td>
                      <Status
                        tone={
                          r.status === "Approved"
                            ? "done"
                            : r.status === "Rejected"
                              ? "problem"
                              : "neutral"
                        }
                      >
                        {r.status}
                      </Status>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </Card>
        </div>
      ) : null}
    </>
  );
}
