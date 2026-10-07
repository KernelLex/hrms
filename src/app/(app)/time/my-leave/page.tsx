import { requirePage } from "@/lib/access";
import { asc, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { ptLeaveRequest, ptAbsenceType, OPTIONAL_HOLIDAY_ABSENCE_CODE } from "@/db/schema";
import { rawClient } from "@/lib/db";
import { balancesFor, calendarFor, formatDays, ledgerFor } from "@/lib/engines/quota";
import { compOffBalance, forecastBalance } from "@/lib/engines/leave-policy";
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
import { OptionalHolidayButton } from "./optional";
import { formatDate, formatDateRange, todayInIndia } from "@/lib/dates";

/** Employee self-service: balances, a request form, and your own history. */
export default async function MyLeavePage() {
  const session = await requirePage(["self.leave"]);

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

  const [balances, types, requests, compOff, yearEndForecast, ledger] = await Promise.all([
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
    compOffBalance(employeeId),
    forecastBalance(employeeId, "ANNUAL", `${year}-12-31`),
    Promise.all(
      (["ANNUAL", "SICK", "CASUAL"] as const).map(async (code) => ({
        code,
        entries: await ledgerFor(employeeId, code, year),
      })),
    ),
  ]);

  // Optional holidays on this employee's own calendar for the year, and the
  // ones they have already taken (each taken day is a paid absence of its
  // own type, so there is no second place to look).
  const today = todayInIndia();
  const calendarCode = await calendarFor(employeeId, today);
  const [optionalRows, takenRows, calendarRow] = await Promise.all([
    rawClient().execute({
      sql: `SELECT id, date, name FROM pt_holiday
            WHERE calendar_code = ? AND is_optional = 1 AND substr(date, 1, 4) = ?
            ORDER BY date`,
      args: [calendarCode, String(year)],
    }),
    rawClient().execute({
      sql: `SELECT start_date FROM pt_it2001_absence
            WHERE employee_id = ? AND absence_type_code = ? AND substr(start_date, 1, 4) = ?`,
      args: [employeeId, OPTIONAL_HOLIDAY_ABSENCE_CODE, String(year)],
    }),
    rawClient().execute({ sql: "SELECT optional_allowance FROM pt_holiday_calendar WHERE code = ?", args: [calendarCode] }),
  ]);
  const takenDates = new Set(takenRows.rows.map((r) => String(r.start_date)));
  const optionalAllowance = Number(calendarRow.rows[0]?.optional_allowance ?? 0);
  const optionalHolidays = optionalRows.rows.map((r) => ({
    id: Number(r.id),
    date: String(r.date),
    name: String(r.name),
    taken: takenDates.has(String(r.date)),
  }));

  const annual = balances.find((b) => b.quotaTypeCode === "ANNUAL");
  const sick = balances.find((b) => b.quotaTypeCode === "SICK");
  const casual = balances.find((b) => b.quotaTypeCode === "CASUAL");
  const pendingCount = requests.filter((r) => r.status === "Pending").length;
  const quotaTypeNameOf = new Map(balances.map((b) => [b.quotaTypeCode, b.quotaTypeName]));
  const ledgerEntries = ledger
    .flatMap((l) => l.entries.map((e) => ({ ...e, quotaTypeName: quotaTypeNameOf.get(l.code) ?? l.code })))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, 15);

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
          hint={annual ? `of ${formatDays(annual.entitledUnits)} days · ${formatDays(yearEndForecast)} on 31 Dec` : "no quota yet"}
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
          label="Comp-off available"
          value={formatDays(compOff.availableHalfDays)}
          hint={compOff.expiringSoon.length > 0 ? `${formatDays(compOff.expiringSoon.reduce((s, x) => s + x.halfDays, 0))} expiring within 2 weeks` : "earned by working a holiday"}
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

      {optionalHolidays.length > 0 ? (
        <div className="mt-6">
          <Card>
            <div className="px-6 pt-5 pb-3">
              <h2 className="text-[15px] font-semibold text-ink">Optional holidays</h2>
              <p className="mt-1 text-[13px] text-muted">
                Festivals the company leaves to you. You may take{" "}
                {optionalAllowance === 0 ? "none this year" : `${optionalAllowance} of these in ${year}`}, and you have taken{" "}
                {takenDates.size}. A day you take is paid and costs you no leave; the rest are ordinary working days.
              </p>
            </div>
            <Table>
              <thead>
                <tr>
                  <Th>Date</Th>
                  <Th>Festival</Th>
                  <Th>
                    <span className="sr-only">Take</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {optionalHolidays.map((h) => (
                  <Tr key={h.id}>
                    <Td>
                      <span className="tabular font-medium text-ink">{formatDate(h.date)}</span>
                    </Td>
                    <Td>{h.name}</Td>
                    <Td className="text-right">
                      <OptionalHolidayButton holidayId={h.id} taken={h.taken} past={h.date < today} />
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </Card>
        </div>
      ) : null}

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
                        {formatDateRange(r.fromDate, r.toDate)}
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

      <div className="mt-6">
        <Card>
          <div className="px-6 pt-5 pb-3">
            <h2 className="text-[15px] font-semibold text-ink">Why I have what I have</h2>
            <p className="mt-1 text-[13px] text-secondary">
              Every credit and debit behind this year&apos;s balances — accrual, leave taken, a carry-forward, a lapse, an encashment or a manual adjustment.
            </p>
          </div>
          {ledgerEntries.length === 0 ? (
            <EmptyState icon={<CalendarCheck />} title="Nothing posted yet">
              Entries appear once entitlement accrues or leave is approved.
            </EmptyState>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>When</Th>
                  <Th>Quota</Th>
                  <Th>What</Th>
                  <Th numeric>Days</Th>
                  <Th>Note</Th>
                </tr>
              </thead>
              <tbody>
                {ledgerEntries.map((e) => (
                  <Tr key={e.id}>
                    <Td>
                      <span className="tabular text-secondary">{e.createdAt.slice(0, 10)}</span>
                    </Td>
                    <Td>{e.quotaTypeName}</Td>
                    <Td>{e.entryType}</Td>
                    <Td numeric>
                      <span className={`tabular font-medium ${e.halfDays >= 0 ? "text-ink" : "text-secondary"}`}>
                        {e.halfDays >= 0 ? "+" : ""}
                        {formatDays(e.halfDays)}
                      </span>
                    </Td>
                    <Td>
                      <span className="text-secondary">{e.note ?? <span className="text-decor">&mdash;</span>}</span>
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
