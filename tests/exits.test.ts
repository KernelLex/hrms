import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { rawClient } from "@/lib/db";
import { submitExit, settleExitAction } from "@/app/actions/exits";
import { decideApproval } from "@/app/actions/approvals";
import { requestFor } from "@/lib/workflow/engine";
import { gratuityYears, computeGratuity, GRATUITY_CAP_PAISE, noticeShortfallDays, noticePayPaise } from "@/lib/engines/exits";
import { settleExit, processExitsDue } from "@/lib/services/exits";
import { deriveEvents } from "@/lib/api/events";
import { systemActor } from "@/lib/change-log";
import { issueLetter } from "@/lib/services/letters";
import { actAs, createPerson, giveQuota, type Person } from "./support/people";
import { form } from "./support/fixtures";
import { createArea, createPeriod } from "./support/payroll-fixtures";

/**
 * Exits and the full and final settlement: gratuity under the 240-day rule,
 * an exit approved then settled in one off-cycle run that pays salary to the
 * last day, leave encashment, a notice shortfall, gratuity and the
 * outstanding loan together, sign-in disabled, and employee.exited derived.
 *
 * `createPerson` always hires as of 2020-01-01, which by any test-run date is
 * already past the five-year mark — every test employee here is gratuity
 * -eligible without needing its own hire date.
 */

const rupees = (n: number) => n * 100;
const one = async (sql: string, args: (string | number)[] = []) => (await rawClient().execute({ sql, args })).rows[0] as Record<string, unknown> | undefined;
const all = async (sql: string, args: (string | number)[] = []) => (await rawClient().execute({ sql, args })).rows as unknown as Record<string, unknown>[];

let manager: Person;

beforeAll(async () => {
  manager = await createPerson({ roles: ["MANAGER", "EMPLOYEE"] });
});
afterEach(() => actAs(null));

/** Decides every step still pending, as HR — the test default session — until the request is final. */
async function decideAllSteps(subjectType: string, subjectId: number, decision: "Approved" | "Rejected"): Promise<void> {
  for (let guard = 0; guard < 5; guard += 1) {
    const request = await requestFor(subjectType, subjectId);
    if (!request || request.status !== "Pending") return;
    const r = await decideApproval({}, form({ requestId: request.id, decision, comment: "" }));
    if (!r.ok) throw new Error(r.error);
  }
  throw new Error("The request did not finish after 5 decisions.");
}

async function givePay(employeeId: number, amountRupees: number): Promise<void> {
  await rawClient().execute({
    sql: `INSERT INTO pa_it0008_basic_pay (employee_id, pay_scale_type, pay_scale_group, amount_paise, currency, valid_from, valid_to, seq, created_by, created_at)
          VALUES (?, 'Monthly salaried', 'L1', ?, 'INR', '2020-01-01', '9999-12-31', 1, 'test', ?)`,
    args: [employeeId, rupees(amountRupees), new Date().toISOString()],
  });
}

/**
 * A person who can sign in and resign, moved into a personnel area of their
 * own with a period already locked for `lastDay`'s month — an off-cycle
 * settlement run needs one locked, the same as any other off-cycle pay, and
 * a fresh area keeps this test's run from touching any other test's people.
 */
async function payableEmployee(lastDay: string): Promise<Person> {
  const employee = await createPerson({ reportsTo: manager.position, roles: ["EMPLOYEE"] });
  const area = await createArea();
  await rawClient().execute({ sql: "UPDATE pa_it0001_org_assignment SET area_code = ? WHERE employee_id = ?", args: [area, employee.employeeId] });
  await createPeriod(area, Number(lastDay.slice(0, 4)), Number(lastDay.slice(5, 7)));
  // Payroll refuses to calculate anyone without bank details (PY-03) — createPerson does not set them up.
  await rawClient().execute({
    sql: `INSERT INTO pa_it0009_bank_details (employee_id, bank_name, account_number, ifsc, valid_from, valid_to, seq, created_by, created_at)
          VALUES (?, 'Test Bank', ?, 'TEST0000001', '2020-01-01', '9999-12-31', 1, 'test', ?)`,
    args: [employee.employeeId, `ACC${employee.employeeId}`, new Date().toISOString()],
  });
  return employee;
}

describe("gratuity", () => {
  it("counts a full year once 240 days have passed in the year after it", () => {
    // Four full years, then 250 days into the fifth — over the 240-day line.
    expect(gratuityYears("2020-01-01", "2024-09-07")).toBe(5);
    // Four full years, then 150 days into the fifth — under it.
    expect(gratuityYears("2020-01-01", "2024-05-30")).toBe(4);
  });

  it("is paid once eligible, and not before", () => {
    const basic = rupees(80_000);
    expect(computeGratuity(basic, 4)).toEqual({ eligible: false, amountPaise: 0 });
    const paid = computeGratuity(basic, 5);
    expect(paid.eligible).toBe(true);
    expect(paid.amountPaise).toBe(Math.round(((basic * 15) / 26) * 5));
  });

  it("caps at ₹20 lakh", () => {
    const paid = computeGratuity(rupees(10_00_000), 20); // would be far over uncapped
    expect(paid.amountPaise).toBe(GRATUITY_CAP_PAISE);
  });
});

describe("notice pay", () => {
  it("is nothing once the notice period is served in full", () => {
    expect(noticeShortfallDays(30, "2026-01-01", "2026-02-01")).toBe(0); // 31 days, over 30
  });

  it("is the shortfall at the monthly basic over 30 days", () => {
    expect(noticeShortfallDays(30, "2026-01-01", "2026-01-11")).toBe(20); // 10 days served, 20 short
    expect(noticePayPaise(rupees(60_000), 20)).toBe(Math.round((rupees(60_000) * 20) / 30));
  });
});

describe("an exit end to end", () => {
  it("runs from resignation to a settlement that pays salary to the last day, leave, gratuity and the loan together", async () => {
    const requestedLastDay = new Date().toISOString().slice(0, 10); // today: no notice shortfall, to keep this test's focus on the other components
    const employee = await payableEmployee(requestedLastDay);
    await givePay(employee.employeeId, 60_000);

    // Give them a loan to recover, and a quota balance to encash.
    await rawClient().execute({
      sql: `INSERT INTO py_loan (employee_id, loan_type, principal_paise, annual_rate_basis_points, tenure_months, emi_paise, start_date, status, requested_by, requested_at, decided_at)
            VALUES (?, 'Personal', ?, 0, 12, ?, '2026-01-01', 'Active', 'test', ?, ?)`,
      args: [employee.employeeId, rupees(24_000), rupees(2_000), new Date().toISOString(), new Date().toISOString()],
    });
    const loan = await one("SELECT id FROM py_loan WHERE employee_id = ? AND status = 'Active'", [employee.employeeId]);
    await rawClient().execute({
      sql: `INSERT INTO py_loan_schedule (loan_id, installment_no, due_date, opening_balance_paise, principal_paise, interest_paise, closing_balance_paise, perquisite_value_paise)
            VALUES (?, 1, '2026-02-01', ?, ?, 0, 0, 0)`,
      args: [Number(loan!.id), rupees(24_000), rupees(24_000)],
    });

    const year = Number(requestedLastDay.slice(0, 4));
    await giveQuota(employee.employeeId, "ANNUAL", year, 10);

    actAs(employee.session);
    const submitted = await submitExit({}, form({ exitType: "Resignation", requestedLastDay, reason: "New opportunity", noticeDays: 0 }));
    expect(submitted.ok).toBe(true);
    actAs(null);

    const exit = await one("SELECT * FROM pa_exit WHERE employee_id = ? ORDER BY id DESC LIMIT 1", [employee.employeeId]);
    expect(exit!.status).toBe("Pending");
    await decideAllSteps("pa_exit", Number(exit!.id), "Approved");
    const approved = await one("SELECT * FROM pa_exit WHERE id = ?", [Number(exit!.id)]);
    expect(approved!.status).toBe("Approved");
    expect(approved!.approved_last_day).toBe(requestedLastDay);

    const settled = await settleExit(systemActor("test"), Number(exit!.id));
    if (!settled.ok) throw new Error(settled.error);
    expect(settled.value.runId).not.toBeNull();

    const finished = await one("SELECT * FROM pa_exit WHERE id = ?", [Number(exit!.id)]);
    expect(finished!.status).toBe("Settled");
    expect(finished!.exited_at).not.toBeNull();

    const terminatedEmployee = await one("SELECT employment_status, termination_date FROM pa_employee WHERE id = ?", [employee.employeeId]);
    expect(terminatedEmployee!.employment_status).toBe("Terminated");
    expect(terminatedEmployee!.termination_date).toBe(requestedLastDay);

    const user = await one("SELECT is_active FROM sec_app_user WHERE employee_id = ?", [employee.employeeId]);
    expect(Number(user!.is_active)).toBe(0);

    const settlement = await one("SELECT * FROM py_settlement WHERE exit_id = ?", [Number(exit!.id)]);
    expect(settlement!.status).toBe("Paid");
    const lines = await all("SELECT * FROM py_settlement_line WHERE settlement_id = ? ORDER BY sort_order", [Number(settlement!.id)]);
    const components = lines.map((l) => String(l.component));
    expect(components).toContain("Salary to last day");
    expect(components).toContain("Leave encashment");
    expect(components).toContain("Gratuity"); // more than 5 years' service
    expect(components).toContain("Loan recovery");

    const closedLoan = await one("SELECT status FROM py_loan WHERE id = ?", [Number(loan!.id)]);
    expect(closedLoan!.status).toBe("Closed");

    const offboarding = await one("SELECT id FROM pa_checklist WHERE employee_id = ? AND event = 'offboarding'", [employee.employeeId]);
    expect(offboarding).toBeTruthy();

    await deriveEvents();
    const events = await all("SELECT type FROM int_event WHERE subject = ?", [`employees/${employee.employeeId}`]);
    const types = events.map((e) => String(e.type));
    expect(types).toContain("employee.resigned");
    expect(types).toContain("employee.exited");
    const settlementEvents = await all("SELECT type FROM int_event WHERE subject = ?", [`settlements/${Number(settlement!.id)}`]);
    expect(settlementEvents.map((e) => String(e.type))).toContain("settlement.paid");

    // Settling again does nothing — it is not paid twice.
    const again = await settleExit(systemActor("test"), Number(exit!.id));
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.value.runId).toBeNull();
    const linesAgain = await all("SELECT * FROM py_settlement_line WHERE settlement_id = ?", [Number(settlement!.id)]);
    expect(linesAgain).toHaveLength(lines.length);

    // Relieving and experience letters reuse the existing letter machinery, seeded in phase 20.
    const relieving = await one("SELECT id FROM pa_letter_template WHERE kind = 'Relieving' AND is_active = 1");
    const issued = await issueLetter(systemActor("test"), { employeeId: employee.employeeId, templateId: Number(relieving!.id), issueDate: requestedLastDay }, "test");
    expect(issued.ok).toBe(true);
  });

  it("recovers a notice shortfall as a deduction, unless HR waives it", async () => {
    const lastDay = new Date().toISOString().slice(0, 10);
    const employee = await payableEmployee(lastDay);
    await givePay(employee.employeeId, 30_000);
    actAs(employee.session);
    await submitExit({}, form({ exitType: "Resignation", requestedLastDay: lastDay, reason: "", noticeDays: 60 })); // asked for today, 60 days' notice: a full shortfall
    actAs(null);
    const exit = await one("SELECT * FROM pa_exit WHERE employee_id = ? ORDER BY id DESC LIMIT 1", [employee.employeeId]);
    await decideAllSteps("pa_exit", Number(exit!.id), "Approved");

    const settled = await settleExit(systemActor("test"), Number(exit!.id));
    if (!settled.ok) throw new Error(settled.error);
    const settlement = await one("SELECT id FROM py_settlement WHERE exit_id = ?", [Number(exit!.id)]);
    const lines = await all("SELECT * FROM py_settlement_line WHERE settlement_id = ?", [Number(settlement!.id)]);
    const notice = lines.find((l) => l.component === "Notice pay recovery");
    expect(notice).toBeTruthy();
    expect(Number(notice!.amount_paise)).toBeLessThan(0); // a recovery, not a payment
  });

  it("is run automatically by the daily job once the last day has come", async () => {
    const employee = await payableEmployee("2026-01-15");
    await givePay(employee.employeeId, 40_000);
    actAs(employee.session);
    await submitExit({}, form({ exitType: "Resignation", requestedLastDay: "2026-01-15", reason: "", noticeDays: 0 }));
    actAs(null);
    const exit = await one("SELECT * FROM pa_exit WHERE employee_id = ? ORDER BY id DESC LIMIT 1", [employee.employeeId]);
    await decideAllSteps("pa_exit", Number(exit!.id), "Approved");

    const settledCount = await processExitsDue("2026-01-20"); // well after the last day
    expect(settledCount).toBeGreaterThanOrEqual(1);
    const finished = await one("SELECT status FROM pa_exit WHERE id = ?", [Number(exit!.id)]);
    expect(finished!.status).toBe("Settled");
  });

  it("refuses the manual settle trigger without payroll.run", async () => {
    const session = await createPerson({ roles: ["EMPLOYEE"] });
    actAs(session.session);
    await expect(settleExitAction({}, form({ id: 999999 }))).rejects.toThrow("You do not have permission to do that.");
    actAs(null);
  });
});
