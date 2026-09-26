import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { rawClient } from "@/lib/db";
import { submitLeaveRequest, decideLeaveRequest, cancelLeaveRequest } from "@/app/actions/time";
import { saveFlow } from "@/app/actions/access";
import { decideApproval, saveDelegation, endDelegation } from "@/app/actions/approvals";
import { accessFor } from "@/lib/access";
import { escalateOverdue, requestFor, waitingFor } from "@/lib/workflow/engine";
import { applicableSteps, describeStep, type StepDef } from "@/lib/workflow/processes";
import { todayInIndia } from "@/lib/dates";
import { form } from "./support/fixtures";
import { actAs, createPerson, giveQuota, type Person } from "./support/people";

/**
 * The approval engine through leave: a configurable route, delegation that
 * records on whose behalf, escalation, and withdrawal.
 */

afterEach(() => actAs(null));

const ONE_STEP = [{ approverType: "reporting_manager" }];
const MANAGER_THEN_HR = [
  { approverType: "reporting_manager" },
  { approverType: "role", approverRole: "HR_ADMIN", conditionMin: 5 },
];

async function setFlow(steps: object[]) {
  actAs(null);
  const result = await saveFlow({}, form({ process: "leave", steps: JSON.stringify(steps) }));
  expect(result).toEqual({ ok: true });
}

async function team(): Promise<{ manager: Person; report: Person; hr: Person }> {
  const manager = await createPerson({ roles: ["MANAGER", "EMPLOYEE"] });
  const report = await createPerson({ reportsTo: manager.position });
  const hr = await createPerson({ roles: ["HR_ADMIN"] });
  await giveQuota(report.employeeId, "ANNUAL", 2027, 20);
  return { manager, report, hr };
}

async function ask(report: Person, from: string, to: string): Promise<number> {
  actAs(report.session);
  const result = await submitLeaveRequest({}, form({ absenceTypeCode: "0200", fromDate: from, toDate: to }));
  actAs(null);
  expect(result.error).toBeUndefined();
  const r = await rawClient().execute({
    sql: "SELECT id FROM pt_leave_request WHERE employee_id = ? ORDER BY id DESC LIMIT 1",
    args: [report.employeeId],
  });
  return Number(r.rows[0].id);
}

async function statusOf(leaveId: number) {
  const r = await rawClient().execute({ sql: "SELECT status FROM pt_leave_request WHERE id = ?", args: [leaveId] });
  return String(r.rows[0].status);
}

async function assignees(leaveId: number): Promise<number[]> {
  const request = (await requestFor("pt_leave_request", leaveId))!;
  const r = await rawClient().execute({
    sql: "SELECT user_id FROM wf_assignee WHERE request_id = ? AND step_order = ? ORDER BY user_id",
    args: [request.id, request.currentStep],
  });
  return r.rows.map((a) => Number(a.user_id));
}

beforeAll(() => setFlow(ONE_STEP));
afterAll(() => setFlow(ONE_STEP));

describe("the route", () => {
  it("chooses steps by the request's facts", () => {
    const steps: StepDef[] = [
      { stepOrder: 1, approverType: "reporting_manager", approverRole: null, approverUserId: null, conditionField: null, conditionMin: null, escalateAfterDays: null },
      { stepOrder: 2, approverType: "role", approverRole: "HR_ADMIN", approverUserId: null, conditionField: "days", conditionMin: 5, escalateAfterDays: 3 },
    ];
    expect(applicableSteps(steps, { days: 2 }).map((s) => s.stepOrder)).toEqual([1]);
    expect(applicableSteps(steps, { days: 5 }).map((s) => s.stepOrder)).toEqual([1]);
    expect(applicableSteps(steps, { days: 6 }).map((s) => s.stepOrder)).toEqual([1, 2]);
    expect(describeStep("leave", steps[1], { role: "HR administrator" })).toBe(
      "Anyone holding HR administrator, when more than 5 working days; HR is added after 3 days",
    );
  });

  it("sends leave over five days to the manager, then HR", async () => {
    await setFlow(MANAGER_THEN_HR);
    const { manager, report, hr } = await team();
    // 1–8 Feb 2027 is six working days.
    const long = await ask(report, "2027-02-01", "2027-02-08");
    expect(await assignees(long)).toEqual([manager.userId]);

    actAs(manager.session);
    expect(await decideLeaveRequest({}, form({ id: long, decision: "Approved" }))).toEqual({ ok: true });
    expect(await statusOf(long)).toBe("Pending");
    expect(await assignees(long)).toContain(hr.userId);

    // The manager's approval does not decide it twice.
    const again = await decideLeaveRequest({}, form({ id: long, decision: "Approved" }));
    expect(again.error).toBe("This request is not waiting for you.");

    actAs(hr.session);
    const waiting = await waitingFor(await accessFor(hr.session), []);
    expect(waiting.some((w) => w.subjectId === String(long))).toBe(true);
    expect(await decideLeaveRequest({}, form({ id: long, decision: "Approved" }))).toEqual({ ok: true });
    expect(await statusOf(long)).toBe("Approved");

    // Two days goes to the manager alone.
    actAs(null);
    const short = await ask(report, "2027-03-01", "2027-03-02");
    actAs(manager.session);
    expect(await decideLeaveRequest({}, form({ id: short, decision: "Approved" }))).toEqual({ ok: true });
    expect(await statusOf(short)).toBe("Approved");
    await setFlow(ONE_STEP);
  });

  it("keeps a request on the version it started on", async () => {
    const { manager, report } = await team();
    const leave = await ask(report, "2027-04-05", "2027-04-13"); // one step, started now
    await setFlow(MANAGER_THEN_HR);
    actAs(manager.session);
    await decideLeaveRequest({}, form({ id: leave, decision: "Approved" }));
    expect(await statusOf(leave)).toBe("Approved");
    await setFlow(ONE_STEP);
  });
});

describe("while the manager is away", () => {
  it("lets a delegate decide, and records on whose behalf", async () => {
    const { manager, report } = await team();
    const colleague = await createPerson({ roles: ["MANAGER", "EMPLOYEE"] });
    const leave = await ask(report, "2027-05-03", "2027-05-04");

    actAs(manager.session);
    const today = todayInIndia();
    expect(await saveDelegation({}, form({ toUserId: colleague.userId, fromDate: today, toDate: "2099-12-31" }))).toEqual({ ok: true });

    const waiting = await waitingFor(await accessFor(colleague.session), []);
    const row = waiting.find((w) => w.subjectId === String(leave))!;
    expect(row.onBehalfOfName).toBe(manager.session.displayName);

    actAs(colleague.session);
    const request = (await requestFor("pt_leave_request", leave))!;
    expect(await decideApproval({}, form({ requestId: request.id, decision: "Approved" }))).toEqual({ ok: true });

    const action = await rawClient().execute({
      sql: "SELECT actor_name, on_behalf_of_user_id, on_behalf_of_name FROM wf_action WHERE request_id = ? AND decision = 'Approved'",
      args: [request.id],
    });
    expect(action.rows[0].actor_name).toBe(colleague.session.username);
    expect(Number(action.rows[0].on_behalf_of_user_id)).toBe(manager.userId);
    expect(action.rows[0].on_behalf_of_name).toBe(manager.session.displayName);
    const decided = await rawClient().execute({ sql: "SELECT decided_by_employee_id FROM pt_leave_request WHERE id = ?", args: [leave] });
    expect(Number(decided.rows[0].decided_by_employee_id)).toBe(colleague.employeeId);
  });

  it("stops the moment the hand-over ends", async () => {
    const { manager, report } = await team();
    const colleague = await createPerson({ roles: ["EMPLOYEE"] });
    const leave = await ask(report, "2027-06-07", "2027-06-08");
    actAs(manager.session);
    await saveDelegation({}, form({ toUserId: colleague.userId, fromDate: todayInIndia(), toDate: "2099-12-31" }));
    const d = await rawClient().execute({ sql: "SELECT id FROM wf_delegation WHERE from_user_id = ? ORDER BY id DESC", args: [manager.userId] });
    expect(await endDelegation({}, form({ id: Number(d.rows[0].id) }))).toEqual({ ok: true });

    actAs(colleague.session);
    const refused = await decideLeaveRequest({}, form({ id: leave, decision: "Approved" }));
    expect(refused.error).toBe("This request is not waiting for you.");
  });

  it("refuses a hand-over to yourself or in the past", async () => {
    const { manager } = await team();
    actAs(manager.session);
    expect((await saveDelegation({}, form({ toUserId: manager.userId, fromDate: "2030-01-01", toDate: "2030-01-02" }))).error).toMatch(/other than yourself/);
    expect((await saveDelegation({}, form({ toUserId: 1, fromDate: "2020-01-01", toDate: "2020-01-02" }))).error).toMatch(/already over/);
  });
});

describe("escalation and withdrawal", () => {
  it("adds HR once a step has waited too long", async () => {
    await setFlow([{ approverType: "reporting_manager", escalateAfterDays: 2 }]);
    const { manager, report } = await team();
    const leave = await ask(report, "2027-07-05", "2027-07-06");
    const request = (await requestFor("pt_leave_request", leave))!;
    await rawClient().execute({
      sql: "UPDATE wf_request SET step_started_at = ? WHERE id = ?",
      args: [new Date(Date.now() - 3 * 86_400_000).toISOString(), request.id],
    });

    expect(await escalateOverdue()).toBeGreaterThanOrEqual(1);
    expect(await escalateOverdue()).toBe(0); // once per step
    const after = await assignees(leave);
    expect(after).toContain(manager.userId);
    expect(after).toContain(1); // the seeded HR administrator
    const escalated = await rawClient().execute({
      sql: "SELECT COUNT(*) AS n FROM wf_action WHERE request_id = ? AND decision = 'Escalated'",
      args: [request.id],
    });
    expect(Number(escalated.rows[0].n)).toBe(1);
    await setFlow(ONE_STEP);
  });

  it("withdraws the approval when the employee cancels", async () => {
    const { manager, report } = await team();
    const leave = await ask(report, "2027-08-02", "2027-08-03");
    actAs(report.session);
    expect(await cancelLeaveRequest({}, form({ id: leave }))).toEqual({ ok: true });
    expect((await requestFor("pt_leave_request", leave))!.status).toBe("Cancelled");
    const waiting = await waitingFor(await accessFor(manager.session), []);
    expect(waiting.some((w) => w.subjectId === String(leave))).toBe(false);
  });

  it("put leave that was already pending onto the engine", async () => {
    // The seed's pending request from Arjun, waiting for Ravi, his manager.
    const r = await rawClient().execute(
      `SELECT u.username FROM wf_request r
       JOIN pt_leave_request lr ON lr.id = CAST(r.subject_id AS INTEGER)
       JOIN wf_assignee a ON a.request_id = r.id AND a.step_order = r.current_step
       JOIN sec_app_user u ON u.id = a.user_id
       JOIN sec_app_user me ON me.employee_id = lr.employee_id AND me.username = 'arjun.mehta'
       WHERE r.process = 'leave'`,
    );
    expect(r.rows.map((u) => String(u.username))).toContain("ravi.kumar");
  });
});
