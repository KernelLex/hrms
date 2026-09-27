import "server-only";
import type { InStatement } from "@libsql/client";
import { rawClient } from "@/lib/db";
import { today } from "@/db/schema/_shared";
import { formatMonth } from "@/lib/dates";
import { queueEmailStatement, renderEmail } from "@/lib/email";
import { requeueStatement } from "@/lib/jobs/queue";
import { payslipPasswordHint } from "@/lib/payslip-password";
import { payslipFileName } from "@/lib/documents/payslip-pdf";

/**
 * Payslips by email: one message per person, the payslip attached as a PDF
 * protected with their password. The outbox holds a description of the
 * attachment, not the file, so it never keeps a copy of anyone's pay: the
 * PDF is made when the message is sent, or opened on the Outbox screen.
 */

/** Each employee's email: the official one, or else a personal one on record. */
export async function employeeEmails(employeeIds: number[]): Promise<Map<number, string>> {
  if (employeeIds.length === 0) return new Map();
  const r = await rawClient().execute({
    sql: `SELECT employee_id, value FROM pa_it0105_communication
          WHERE comm_type IN ('Email (official)', 'Email (personal)') AND valid_from <= ? AND valid_to >= ?
            AND employee_id IN (${employeeIds.map(() => "?").join(", ")})
          ORDER BY comm_type = 'Email (official)' DESC`,
    args: [today(), today(), ...employeeIds],
  });
  const out = new Map<number, string>();
  for (const row of r.rows) if (!out.has(Number(row.employee_id))) out.set(Number(row.employee_id), String(row.value));
  return out;
}

type Target = {
  resultId: number;
  runId: number;
  employeeId: number;
  employeeNumber: string;
  firstName: string | null;
  dateOfBirth: string | null;
  year: number;
  month: number;
  offCycleReason: string | null;
};

async function targets(resultIds: number[]): Promise<Target[]> {
  if (resultIds.length === 0) return [];
  const r = await rawClient().execute({
    sql: `SELECT r.id, r.run_id, r.employee_id, e.employee_number, pd.first_name, pd.date_of_birth, p.year, p.month,
                 run.run_type, run.reason
          FROM py_payroll_result r
          JOIN py_payroll_run run ON run.id = r.run_id
          JOIN py_payroll_period p ON p.id = run.period_id
          JOIN pa_employee e ON e.id = r.employee_id
          LEFT JOIN pa_it0002_personal_data pd ON pd.employee_id = e.id AND pd.valid_from <= ? AND pd.valid_to >= ?
          WHERE r.id IN (${resultIds.map(() => "?").join(", ")})`,
    args: [today(), today(), ...resultIds],
  });
  return r.rows.map((x) => ({
    resultId: Number(x.id),
    runId: Number(x.run_id),
    employeeId: Number(x.employee_id),
    employeeNumber: String(x.employee_number),
    firstName: x.first_name === null ? null : String(x.first_name),
    dateOfBirth: x.date_of_birth === null ? null : String(x.date_of_birth),
    year: Number(x.year),
    month: Number(x.month),
    offCycleReason: x.run_type === "Off-cycle" ? (x.reason === null ? "Off-cycle payment" : String(x.reason)) : null,
  }));
}

/** Who has said no to payslip emails, among these employees' sign-ins. */
async function optedOut(employeeIds: number[]): Promise<Set<number>> {
  if (employeeIds.length === 0) return new Set();
  const r = await rawClient().execute({
    sql: `SELECT u.employee_id FROM sec_app_user u JOIN app_notification_pref p ON p.user_id = u.id
          WHERE p.kind = 'payslip.ready' AND p.email = 0 AND u.employee_id IN (${employeeIds.map(() => "?").join(", ")})`,
    args: employeeIds,
  });
  return new Set(r.rows.map((x) => Number(x.employee_id)));
}

/**
 * The outbox rows for these payslips' emails. On posting, each is sent
 * once (the dedupe key is the payslip) and only to people who have not
 * turned payslip emails off; a resend is deliberate, so it always goes and
 * is its own message.
 */
export async function payslipEmailStatements(
  resultIds: number[],
  opts: { resend?: boolean } = {},
): Promise<{ statements: InStatement[]; emailed: Set<number>; withoutEmail: number[] }> {
  const list = await targets(resultIds);
  const ids = list.map((t) => t.employeeId);
  const [emails, out] = await Promise.all([employeeEmails(ids), opts.resend ? Promise.resolve(new Set<number>()) : optedOut(ids)]);
  const statements: InStatement[] = [];
  const emailed = new Set<number>();
  const withoutEmail: number[] = [];
  const stamp = Date.now();

  for (const t of list) {
    const to = emails.get(t.employeeId);
    if (!to) {
      withoutEmail.push(t.employeeId);
      continue;
    }
    if (out.has(t.employeeId)) continue;
    const month = formatMonth(t.year, t.month);
    const message = renderEmail({
      title: t.offCycleReason ? `Your off-cycle payslip for ${month}` : `Your payslip for ${month}`,
      body: `It is attached as a PDF. ${payslipPasswordHint(t)} You can also open it in HRMS at any time.`,
      link: `/payroll/payslip/${t.resultId}`,
      action: "Open in HRMS",
    });
    statements.push(
      queueEmailStatement(
        opts.resend ? `payslip.email:${t.resultId}:resend:${stamp}` : `payslip.email:${t.resultId}`,
        { to, ...message },
        { kind: "payslip.email", resultId: t.resultId, employeeId: t.employeeId, resend: Boolean(opts.resend) },
        [{ type: "payslip", resultId: t.resultId, fileName: payslipFileName(t), protected: true }],
      ),
    );
    emailed.add(t.employeeId);
  }
  if (statements.length > 0) statements.push(requeueStatement("outbox.deliver", null, "outbox.deliver"));
  return { statements, emailed, withoutEmail };
}
