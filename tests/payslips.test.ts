import { afterEach, describe, expect, it } from "vitest";
import { PDFDocument } from "@cantoo/pdf-lib";
import { rawClient } from "@/lib/db";
import { runPayroll } from "@/lib/engines/payroll";
import { processJobs } from "@/lib/jobs/runner";
import { getPayslip } from "@/lib/repositories/payslips";
import { renderAttachment } from "@/lib/email-attachments";
import { payslipPassword } from "@/lib/payslip-password";
import { deriveEvents } from "@/lib/api/events";
import { resendPayslip, setPeriodEmail, setPeriodStatus } from "@/app/actions/payroll";
import { GET as payslipPdf } from "@/app/api/payroll/payslip/[id]/pdf/route";
import { form } from "./support/fixtures";
import { actAs } from "./support/people";
import { createArea, createPeriod, hireForPayroll, postPeriod } from "./support/payroll-fixtures";

/**
 * Payslips: the year to date, the PDF, and one email per person when a
 * month is posted.
 */

afterEach(() => actAs(null));

const rupees = (n: number) => n * 100;

async function person(area: string, opts: { email?: string; dob?: string; first?: string } = {}) {
  const id = await hireForPayroll({ area, hireDate: "2025-01-01", pay: [{ from: "2025-01-01", amountRupees: 60_000 }] });
  const now = new Date().toISOString();
  await rawClient().execute({
    sql: "UPDATE pa_it0002_personal_data SET first_name = ?, date_of_birth = ? WHERE employee_id = ?",
    args: [opts.first ?? "Ishaan", opts.dob ?? "1993-08-21", id],
  });
  const exists = await rawClient().execute({ sql: "SELECT 1 FROM pa_it0002_personal_data WHERE employee_id = ?", args: [id] });
  if (exists.rows.length === 0) {
    await rawClient().execute({
      sql: `INSERT INTO pa_it0002_personal_data (employee_id, valid_from, valid_to, seq, created_by, created_at, first_name, last_name, date_of_birth)
            VALUES (?, '2025-01-01', '9999-12-31', 1, 'test', ?, ?, 'Test', ?)`,
      args: [id, now, opts.first ?? "Ishaan", opts.dob ?? "1993-08-21"],
    });
  }
  if (opts.email) {
    await rawClient().execute({
      sql: `INSERT INTO pa_it0105_communication (employee_id, comm_type, value, valid_from, valid_to, seq, created_by, created_at)
            VALUES (?, 'Email (official)', ?, '2025-01-01', '9999-12-31', 1, 'test', ?)`,
      args: [id, opts.email, now],
    });
  }
  return id;
}

async function resultOf(runId: number, employeeId: number): Promise<number> {
  const r = await rawClient().execute({ sql: "SELECT id FROM py_payroll_result WHERE run_id = ? AND employee_id = ?", args: [runId, employeeId] });
  return Number(r.rows[0].id);
}

describe("the year to date", () => {
  it("is the sum of that financial year's payslips, and nothing before April", async () => {
    const area = await createArea();
    const id = await person(area);
    const months: { runId: number; month: number; year: number }[] = [];
    for (const [year, month] of [[2026, 3], [2026, 4], [2026, 5], [2026, 6]] as const) {
      const periodId = await createPeriod(area, year, month);
      const run = await runPayroll({ periodId, runBy: "test" });
      await postPeriod(periodId);
      months.push({ runId: run.runId, month, year });
      if (month === 5) {
        await rawClient().execute({
          sql: `INSERT INTO py_it0015_additional_payment (employee_id, wage_type_code, amount_paise, payment_date, created_at)
                VALUES (?, 'BONUS', ?, '2026-05-20', ?)`,
          args: [id, rupees(25_000), new Date().toISOString()],
        });
        const off = await runPayroll({ periodId, runBy: "test", runType: "Off-cycle", employeeIds: [id], reason: "Bonus", payDate: "2026-05-25" });
        months.push({ runId: off.runId, month, year });
      }
    }

    const june = await getPayslip(await resultOf(months[months.length - 1].runId, id));
    expect(june?.financialYear).toBe("2026-27");
    const inYear = await rawClient().execute({
      sql: `SELECT r.id, r.gross_paise, r.deductions_paise, r.net_paise FROM py_payroll_result r
            WHERE r.employee_id = ? AND r.run_id IN (${months.slice(1).map(() => "?").join(", ")})`,
      args: [id, ...months.slice(1).map((m) => m.runId)],
    });
    const sum = (k: string) => inYear.rows.reduce((s, r) => s + Number(r[k]), 0);
    expect(june!.ytd).toMatchObject({ grossPaise: sum("gross_paise"), deductionsPaise: sum("deductions_paise"), netPaise: sum("net_paise"), payslips: 4 });

    // Line by line too: the bonus is in the year's earnings though not on June's payslip.
    const bonus = june!.ytd.lines.find((l) => l.wageTypeCode === "BONUS");
    expect(bonus?.amountPaise).toBe(rupees(25_000));
    expect(june!.lines.find((l) => l.wageTypeCode === "BONUS")).toBeUndefined();
    const basicYtd = june!.ytd.lines.find((l) => l.wageTypeCode === "BASIC")!.amountPaise;
    const basicLines = await rawClient().execute({
      sql: `SELECT SUM(l.amount_paise) AS n FROM py_payroll_result_line l WHERE l.wage_type_code = 'BASIC'
              AND l.result_id IN (${inYear.rows.map(() => "?").join(", ")})`,
      args: inYear.rows.map((r) => Number(r.id)),
    });
    expect(basicYtd).toBe(Number(basicLines.rows[0].n));

    // April's year to date is April alone.
    const april = await getPayslip(await resultOf(months[1].runId, id));
    expect(april!.ytd.payslips).toBe(1);
    expect(april!.ytd.netPaise).toBe(april!.netPaise);
  });
});

describe("posting a month", () => {
  it("emails each person their payslip once, as a PDF only their password opens", async () => {
    const area = await createArea();
    const withEmail = await person(area, { email: "asha@example.test", first: "Asha", dob: "1994-02-09" });
    const noEmail = await person(area, { first: "Ravi" });
    const periodId = await createPeriod(area, 2026, 8);
    const run = await runPayroll({ periodId, runBy: "test" });

    expect((await setPeriodStatus({}, form({ id: periodId, status: "Posted" }))).ok).toBe(true);
    await processJobs();
    await processJobs(); // a second pass sends nothing twice

    const mails = await rawClient().execute({
      sql: "SELECT id, recipient, subject, attachments FROM app_outbox WHERE channel = 'email' AND dedupe_key LIKE 'payslip.email:%' AND recipient = 'asha@example.test'",
      args: [],
    });
    expect(mails.rows).toHaveLength(1);
    expect(String(mails.rows[0].subject)).toBe("Your payslip for August 2026");
    const [spec] = JSON.parse(String(mails.rows[0].attachments));
    expect(spec).toMatchObject({ type: "payslip", protected: true });

    const file = await renderAttachment(spec);
    const bytes = file!.bytes;
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
    await expect(PDFDocument.load(bytes)).rejects.toThrow(/encrypted/);
    const p = await getPayslip(spec.resultId);
    expect(payslipPassword(p!)).toBe("ASHA0902");
    const opened = await PDFDocument.load(bytes, { password: "ASHA0902" });
    expect(opened.getPageCount()).toBe(1);

    // Published, logged, and an event for the ERP.
    const published = await rawClient().execute({ sql: "SELECT published_at FROM py_payroll_result WHERE run_id = ?", args: [run.runId] });
    expect(published.rows.every((r) => r.published_at !== null)).toBe(true);
    await deriveEvents();
    const events = await rawClient().execute({
      sql: "SELECT COUNT(*) AS n FROM int_event WHERE type = 'payslip.published' AND subject IN (?, ?)",
      args: [`payslips/${await resultOf(run.runId, withEmail)}`, `payslips/${await resultOf(run.runId, noEmail)}`],
    });
    expect(Number(events.rows[0].n)).toBe(2);

    // A deliberate resend is a second message.
    expect((await resendPayslip({}, form({ resultId: spec.resultId }))).ok).toBe(true);
    const again = await rawClient().execute({ sql: "SELECT COUNT(*) AS n FROM app_outbox WHERE recipient = 'asha@example.test'", args: [] });
    expect(Number(again.rows[0].n)).toBe(2);
    expect((await resendPayslip({}, form({ resultId: await resultOf(run.runId, noEmail) }))).error).toMatch(/no email address/);
  });

  it("emails nothing when the period says not to", async () => {
    const area = await createArea();
    await person(area, { email: "noemail@example.test" });
    const periodId = await createPeriod(area, 2026, 9);
    await runPayroll({ periodId, runBy: "test" });
    expect((await setPeriodEmail({}, form({ id: periodId, emailPayslips: "0" }))).ok).toBe(true);
    await setPeriodStatus({}, form({ id: periodId, status: "Posted" }));
    await processJobs();
    const mails = await rawClient().execute({ sql: "SELECT COUNT(*) AS n FROM app_outbox WHERE recipient = 'noemail@example.test'", args: [] });
    expect(Number(mails.rows[0].n)).toBe(0);
  });
});

describe("the PDF download", () => {
  it("is for the employee once published, and for payroll", async () => {
    const area = await createArea();
    const id = await person(area);
    const periodId = await createPeriod(area, 2026, 10);
    const run = await runPayroll({ periodId, runBy: "test" });
    const resultId = await resultOf(run.runId, id);
    const get = () => payslipPdf(new Request("http://localhost/x"), { params: Promise.resolve({ id: String(resultId) }) } as never);

    const hr = await get();
    expect(hr.status).toBe(200);
    expect(hr.headers.get("content-type")).toBe("application/pdf");

    // Their own sign-in, with the ordinary employee role.
    const username = `self.${id}`;
    const user = await rawClient().execute({
      sql: "INSERT INTO sec_app_user (username, password_hash, display_name, employee_id, is_active, created_at) VALUES (?, 'x', 'Self', ?, 1, ?) RETURNING id",
      args: [username, id, new Date().toISOString()],
    });
    const userId = Number(user.rows[0].id);
    await rawClient().execute({ sql: "INSERT INTO sec_user_role (user_id, role_code) VALUES (?, 'EMPLOYEE')", args: [userId] });
    const self = { userId, username, displayName: "Self", roles: ["EMPLOYEE" as const], employeeId: id };
    actAs(self);
    expect((await get()).status).toBe(404);
    await postPeriod(periodId);
    expect((await get()).status).toBe(200);
    actAs({ ...self, employeeId: id + 100000 });
    expect((await get()).status).toBe(404);
  });
});
