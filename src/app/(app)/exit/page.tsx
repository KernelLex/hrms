import { requirePage } from "@/lib/access";
import { rawClient } from "@/lib/db";
import { formatINR } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { Card, CardHeader, PageHeader, Status, Notice, Table, Th, Tr, Td } from "@/components/ui";
import { RequestExitForm } from "./form";
import { WithdrawExit } from "./cancel";
import { ExitInterviewForm } from "./interview";

const STATUS_TONE = { Pending: "waiting", Approved: "action", Rejected: "problem", Withdrawn: "neutral", Settled: "done" } as const;

const one = async (sql: string, args: (string | number)[] = []) => (await rawClient().execute({ sql, args })).rows[0] as Record<string, unknown> | undefined;
const all = async (sql: string, args: (string | number)[] = []) => (await rawClient().execute({ sql, args })).rows as unknown as Record<string, unknown>[];

/** Employee self-service: resign, follow it to a decision, and once settled, the statement and the exit interview. */
export default async function ExitPage() {
  const session = await requirePage(["self.exit"]);

  if (!session.employeeId) {
    return (
      <>
        <PageHeader title="Exit" subtitle="Resign, and follow it through to your settlement." />
        <Notice>This sign-in is not linked to an employee record, so there is nothing to show here.</Notice>
      </>
    );
  }

  const employeeId = session.employeeId;
  const exit = await one("SELECT * FROM pa_exit WHERE employee_id = ? ORDER BY id DESC LIMIT 1", [employeeId]);
  const open = exit && ["Pending", "Approved", "Settled"].includes(String(exit.status));

  const settlement = exit && String(exit.status) === "Settled" ? await one("SELECT * FROM py_settlement WHERE exit_id = ?", [Number(exit.id)]) : undefined;
  const lines = settlement ? await all("SELECT * FROM py_settlement_line WHERE settlement_id = ? ORDER BY sort_order", [Number(settlement.id)]) : [];
  const interview = exit ? await one("SELECT 1 FROM pa_exit_interview WHERE exit_id = ?", [Number(exit.id)]) : undefined;

  return (
    <>
      <PageHeader title="Exit" subtitle="Resign, and follow it through to your settlement." />

      {!open ? <RequestExitForm /> : null}

      {exit && open ? (
        <div className={open ? "" : "mt-6"}>
          <Card>
            <CardHeader title={`${exit.exit_type} — last day ${formatDate(String(exit.requested_last_day))}`} />
            <div className="px-6 pb-5 text-[14px] text-secondary">
              <div className="flex items-center gap-3">
                <Status tone={STATUS_TONE[String(exit.status) as keyof typeof STATUS_TONE] ?? "neutral"}>{String(exit.status)}</Status>
                {exit.reason ? <span>&ldquo;{String(exit.reason)}&rdquo;</span> : null}
              </div>
              {String(exit.status) === "Approved" ? (
                <p className="mt-2">Your last day is {formatDate(String(exit.approved_last_day))}. Clearance tasks have been assigned, and your settlement will be paid on or shortly after that day.</p>
              ) : null}
              {String(exit.status) === "Pending" ? <div className="mt-3"><WithdrawExit id={Number(exit.id)} /></div> : null}
            </div>
          </Card>
        </div>
      ) : null}

      {settlement && lines.length > 0 ? (
        <div className="mt-6">
          <Card>
            <CardHeader title="Your settlement" description={`Paid ${formatDate(String(settlement.paid_at).slice(0, 10))}.`} />
            <Table>
              <thead>
                <tr>
                  <Th>Component</Th>
                  <Th>Basis</Th>
                  <Th numeric>Amount</Th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <Tr key={Number(l.id)}>
                    <Td>{String(l.component)}</Td>
                    <Td>
                      <span className="text-secondary">{String(l.basis)}</span>
                    </Td>
                    <Td numeric>{formatINR(Number(l.amount_paise))}</Td>
                  </Tr>
                ))}
                <Tr>
                  <Td className="font-medium text-ink">Net</Td>
                  <Td />
                  <Td numeric className="font-medium text-ink">
                    {formatINR(lines.reduce((s, l) => s + Number(l.amount_paise), 0))}
                  </Td>
                </Tr>
              </tbody>
            </Table>
          </Card>
        </div>
      ) : null}

      {exit && String(exit.status) === "Settled" && !interview ? (
        <div className="mt-6">
          <ExitInterviewForm exitId={Number(exit.id)} />
        </div>
      ) : null}
    </>
  );
}
