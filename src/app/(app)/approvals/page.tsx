import { Inbox } from "lucide-react";
import { rawClient } from "@/lib/db";
import { can, requirePage } from "@/lib/access";
import { recentDecisions, waitingFor, type WaitingRow } from "@/lib/workflow/engine";
import { PROCESSES, PROCESS_CODES, isProcess, type ProcessCode } from "@/lib/workflow/processes";
import { formatDays } from "@/lib/engines/quota";
import { formatDateRange, formatTimestamp, todayInIndia } from "@/lib/dates";
import {
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
  Status,
  Tab,
  Tabs,
  Table,
  Th,
  Tr,
  Td,
  TwoLine,
} from "@/components/ui";
import { DecisionButtons } from "@/app/(app)/time/approvals/decision";
import { CorrectionList } from "./corrections";
import { HeadcountList } from "./headcount";
import { RegularisationList } from "./regularisation";

/**
 * One inbox for everything waiting on this person, across processes, with a
 * tab per process. A request is here if it is assigned to them, assigned to
 * someone they are standing in for, or — for someone who may decide every
 * request in a process — simply waiting.
 */

type LeaveDetail = {
  typeName: string;
  isPaid: boolean;
  fromDate: string;
  toDate: string;
  days: number;
  reason: string | null;
  balance: string | null;
};

async function leaveDetails(rows: WaitingRow[]): Promise<Map<string, LeaveDetail>> {
  const ids = rows.filter((r) => r.process === "leave").map((r) => Number(r.subjectId));
  if (ids.length === 0) return new Map();
  const year = Number(todayInIndia().slice(0, 4));
  const r = await rawClient().execute({
    sql: `SELECT lr.id, lr.from_date, lr.to_date, lr.payroll_days, lr.reason, t.name, t.is_paid,
                 (SELECT q.entitled_half_days - q.used_half_days FROM pt_it2006_absence_quota q
                   WHERE q.employee_id = lr.employee_id AND q.year = ? AND q.quota_type_code = t.quota_type_code) AS left_units
          FROM pt_leave_request lr JOIN pt_absence_type t ON t.code = lr.absence_type_code
          WHERE lr.id IN (${ids.map(() => "?").join(", ")})`,
    args: [year, ...ids],
  });
  return new Map(
    r.rows.map((l) => [
      String(l.id),
      {
        typeName: String(l.name),
        isPaid: Number(l.is_paid) === 1,
        fromDate: String(l.from_date),
        toDate: String(l.to_date),
        days: Number(l.payroll_days),
        reason: l.reason === null ? null : String(l.reason),
        balance: l.left_units === null ? null : `${formatDays(Number(l.left_units))} days left`,
      },
    ]),
  );
}

/** "Step 2 of 2", or nothing for a one-step flow. */
async function stepLabels(rows: WaitingRow[]): Promise<Map<number, string>> {
  const flows = [...new Set(rows.map((r) => r.flowId))];
  if (flows.length === 0) return new Map();
  const r = await rawClient().execute({
    sql: `SELECT flow_id, step_order, condition_field, condition_min FROM wf_step
          WHERE flow_id IN (${flows.map(() => "?").join(", ")}) ORDER BY step_order`,
    args: flows,
  });
  const out = new Map<number, string>();
  for (const row of rows) {
    const steps = r.rows
      .filter((s) => Number(s.flow_id) === row.flowId)
      .filter((s) => s.condition_field === null || (row.facts[String(s.condition_field)] ?? 0) > Number(s.condition_min))
      .map((s) => Number(s.step_order));
    if (steps.length > 1) out.set(row.id, `Step ${steps.indexOf(row.currentStep) + 1} of ${steps.length}`);
  }
  return out;
}

export default async function ApprovalsPage(props: { searchParams: Promise<{ process?: string }> }) {
  const session = await requirePage();
  const requested = (await props.searchParams).process;
  const overrides = PROCESS_CODES.filter((p) => can(session, PROCESSES[p].overridePermission));

  const all = await waitingFor(session, overrides);
  const counts = new Map<ProcessCode, number>();
  for (const r of all) counts.set(r.process, (counts.get(r.process) ?? 0) + 1);
  const process: ProcessCode = isProcess(requested) ? requested : "leave";
  const rows = all.filter((r) => r.process === process);

  const [details, steps, recent] = await Promise.all([
    leaveDetails(rows),
    stepLabels(rows),
    recentDecisions(session.userId),
  ]);

  return (
    <>
      <PageHeader
        title="Approvals"
        subtitle={
          overrides.length > 0
            ? "Everything waiting on a decision, and what you have decided lately."
            : "What is waiting for you, including anything you are approving for someone who is away."
        }
      />
      <Tabs>
        {PROCESS_CODES.map((p) => (
          <Tab key={p} href={`/approvals?process=${p}`} active={p === process} count={counts.get(p) ?? 0}>
            {PROCESSES[p].label}
          </Tab>
        ))}
      </Tabs>

      <Card>
        {rows.length === 0 ? (
          <EmptyState icon={<Inbox />} title="Nothing waiting">
            Requests appear here as soon as they reach you.
          </EmptyState>
        ) : process === "correction" ? (
          <CorrectionList
            rows={rows}
            steps={steps}
            seeBank={can(session, "bank.view")}
            seeDocuments={can(session, "employee.view_all")}
          />
        ) : process === "headcount" ? (
          <HeadcountList rows={rows} steps={steps} />
        ) : process === "regularisation" ? (
          <RegularisationList rows={rows} steps={steps} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Request</Th>
                <Th>Dates</Th>
                <Th numeric>Days</Th>
                <Th>Balance</Th>
                <Th>Waiting on</Th>
                <Th>
                  <span className="sr-only">Decision</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const d = details.get(r.subjectId);
                const who = r.summary.split(":")[0];
                return (
                  <Tr key={r.id}>
                    <Td>
                      <TwoLine
                        value={who}
                        sub={
                          d
                            ? `${d.typeName}${d.isPaid ? "" : " (unpaid)"}${d.reason ? `, "${d.reason}"` : ""}`
                            : r.summary
                        }
                      />
                    </Td>
                    <Td>
                      <span className="tabular text-secondary">
                        {d ? formatDateRange(d.fromDate, d.toDate) : "—"}
                      </span>
                    </Td>
                    <Td numeric>{d?.days ?? "—"}</Td>
                    <Td>
                      <span className="text-[13px] text-muted">{d?.balance ?? "no quota"}</span>
                    </Td>
                    <Td>
                      <TwoLine
                        value={
                          <span className="font-normal text-secondary">
                            {r.onBehalfOfName
                              ? `You, for ${r.onBehalfOfName}`
                              : r.assigneeNames.join(", ") || "—"}
                          </span>
                        }
                        sub={steps.get(r.id)}
                      />
                    </Td>
                    <Td className="text-right whitespace-nowrap">
                      <DecisionButtons
                        id={Number(r.subjectId)}
                        describe={`${who}, ${d ? `${d.days} day${d.days === 1 ? "" : "s"}, ${formatDateRange(d.fromDate, d.toDate)}` : r.summary}`}
                      />
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>

      {recent.length > 0 ? (
        <div className="mt-6">
          <Card>
            <CardHeader title="Recently decided by you" />
            <Table>
              <thead>
                <tr>
                  <Th>Request</Th>
                  <Th>Decision</Th>
                  <Th>When</Th>
                </tr>
              </thead>
              <tbody>
                {recent.map((a) => (
                  <Tr key={`${a.requestId}-${a.at}`}>
                    <Td>
                      <TwoLine
                        value={a.summary.split(":")[0]}
                        sub={a.onBehalfOfName ? `On behalf of ${a.onBehalfOfName}` : PROCESSES[a.process].label}
                      />
                    </Td>
                    <Td>
                      <Status tone={a.decision === "Approved" ? "done" : "problem"}>
                        {a.decision}
                        {a.status === "Pending" ? ", sent on for the next approval" : ""}
                      </Status>
                    </Td>
                    <Td>
                      <span className="tabular text-secondary">{formatTimestamp(a.at)}</span>
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
