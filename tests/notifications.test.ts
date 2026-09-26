import { afterEach, describe, expect, it } from "vitest";
import { rawClient } from "@/lib/db";
import { submitLeaveRequest, decideLeaveRequest } from "@/app/actions/time";
import { saveNotificationPrefs, markAllRead } from "@/app/actions/notifications";
import { processJobs } from "@/lib/jobs/runner";
import { notify, unreadCount } from "@/lib/notifications";
import { form } from "./support/fixtures";
import { actAs, createPerson, giveQuota, type Person } from "./support/people";

/**
 * Who is told what when leave moves: the manager when it is asked for, the
 * employee when it is decided — once each, in the inbox and in the outbox,
 * however many times the work behind it runs.
 */

afterEach(() => actAs(null));

async function notificationsFor(userId: number) {
  const r = await rawClient().execute({
    sql: "SELECT kind, title, link, read_at FROM app_notification WHERE user_id = ? ORDER BY id",
    args: [userId],
  });
  return r.rows;
}

async function outboxFor(email: string) {
  const r = await rawClient().execute({
    sql: "SELECT subject, status, attempts FROM app_outbox WHERE recipient = ? ORDER BY id",
    args: [email],
  });
  return r.rows;
}

/** A manager, one report with a login and an email, and a 2027 annual quota. */
async function team(days = 10): Promise<{ manager: Person; report: Person; quotaId: number }> {
  const manager = await createPerson({ roles: ["MANAGER", "EMPLOYEE"] });
  const report = await createPerson({ reportsTo: manager.position });
  const quotaId = await giveQuota(report.employeeId, "ANNUAL", 2027, days);
  return { manager, report, quotaId };
}

/** The report asks for 1–2 Feb 2027, two working days. */
async function ask(report: Person, from = "2027-02-01", to = "2027-02-02"): Promise<number> {
  actAs(report.session);
  const result = await submitLeaveRequest({}, form({ absenceTypeCode: "0200", fromDate: from, toDate: to, reason: "Family visit" }));
  actAs(null);
  expect(result.error).toBeUndefined();
  const r = await rawClient().execute({
    sql: "SELECT id FROM pt_leave_request WHERE employee_id = ? ORDER BY id DESC LIMIT 1",
    args: [report.employeeId],
  });
  return Number(r.rows[0].id);
}

async function quotaUsed(quotaId: number): Promise<number> {
  const r = await rawClient().execute({
    sql: "SELECT used_half_days FROM pt_it2006_absence_quota WHERE id = ?",
    args: [quotaId],
  });
  return Number(r.rows[0].used_half_days);
}

describe("leave notifications", () => {
  it("tells the manager when leave is asked for", async () => {
    const { manager, report } = await team();
    await ask(report);

    const inbox = await notificationsFor(manager.userId);
    expect(inbox).toHaveLength(1);
    expect(inbox[0].kind).toBe("leave.submitted");
    expect(String(inbox[0].title)).toContain("asked for leave");
    expect(inbox[0].link).toBe("/time/approvals");
    expect(await outboxFor(manager.email)).toHaveLength(1);
  });

  it("tells the employee once, in the inbox and by one email, however often the job runs", async () => {
    const { report } = await team();
    const requestId = await ask(report);

    const decided = await decideLeaveRequest({}, form({ id: requestId, decision: "Approved" }));
    expect(decided).toEqual({ ok: true });

    const inbox = await notificationsFor(report.userId);
    expect(inbox).toHaveLength(1);
    expect(inbox[0].kind).toBe("leave.decided");
    expect(String(inbox[0].title)).toMatch(/was approved$/);

    // The delivery job runs twice, and the event is replayed: still one email.
    await processJobs(5_000);
    await processJobs(5_000);
    await notify([
      { userId: report.userId, kind: "leave.decided", title: "again", dedupeKey: `leave.decided:${requestId}` },
    ]);
    const mail = await outboxFor(report.email);
    expect(mail).toHaveLength(1);
    expect(mail[0].status).toBe("recorded");
    expect(Number(mail[0].attempts)).toBe(1);
    expect(await notificationsFor(report.userId)).toHaveLength(1);
  });

  it("respects a person's preferences", async () => {
    const { report } = await team();
    actAs(report.session);
    // Everything off by email, leave decisions off in the inbox too.
    await saveNotificationPrefs({}, form({ "leave.submitted:inApp": "on", "payslip.ready:inApp": "on" }));
    actAs(null);

    const requestId = await ask(report);
    await decideLeaveRequest({}, form({ id: requestId, decision: "Rejected", decisionNote: "Release week" }));

    expect(await notificationsFor(report.userId)).toHaveLength(0);
    expect(await outboxFor(report.email)).toHaveLength(0);
  });

  it("counts unread notifications until they are marked read", async () => {
    const { report } = await team();
    await decideLeaveRequest({}, form({ id: await ask(report), decision: "Approved" }));
    expect(await unreadCount(report.userId)).toBe(1);

    actAs(report.session);
    await markAllRead();
    expect(await unreadCount(report.userId)).toBe(0);
  });
});

describe("deciding leave", () => {
  it("takes the days once, however often it is approved", async () => {
    const { report, quotaId } = await team();
    const requestId = await ask(report);

    expect(await decideLeaveRequest({}, form({ id: requestId, decision: "Approved" }))).toEqual({ ok: true });
    const again = await decideLeaveRequest({}, form({ id: requestId, decision: "Approved" }));
    expect(again.error).toMatch(/already approved/);

    expect(await quotaUsed(quotaId)).toBe(4); // two days, in half days
    const absences = await rawClient().execute({
      sql: "SELECT COUNT(*) AS n FROM pt_it2001_absence WHERE source_request_id = ?",
      args: [requestId],
    });
    expect(Number(absences.rows[0].n)).toBe(1);
  });

  it("refuses to overdraw the balance and leaves the request pending", async () => {
    const { report, quotaId } = await team(1);
    const requestId = await ask(report);

    const result = await decideLeaveRequest({}, form({ id: requestId, decision: "Approved" }));
    expect(result.error).toBe("That needs 2 days, but only 1 day remains.");
    expect(await quotaUsed(quotaId)).toBe(0);

    const r = await rawClient().execute({ sql: "SELECT status FROM pt_leave_request WHERE id = ?", args: [requestId] });
    expect(r.rows[0].status).toBe("Pending");
    expect(await notificationsFor(report.userId)).toHaveLength(0);
  });

  it("lets a manager decide for their own reports only", async () => {
    const { manager, report } = await team();
    const outsider = await createPerson({ roles: ["MANAGER", "EMPLOYEE"] });
    const requestId = await ask(report);

    actAs(outsider.session);
    const refused = await decideLeaveRequest({}, form({ id: requestId, decision: "Approved" }));
    expect(refused.error).toMatch(/people who report to you/);

    actAs(manager.session);
    expect(await decideLeaveRequest({}, form({ id: requestId, decision: "Approved" }))).toEqual({ ok: true });
  });

  it("never lets anyone decide their own request", async () => {
    const { manager } = await team();
    await giveQuota(manager.employeeId, "ANNUAL", 2027, 10);
    const requestId = await ask(manager);

    actAs(manager.session);
    const result = await decideLeaveRequest({}, form({ id: requestId, decision: "Approved" }));
    expect(result.error).toMatch(/cannot decide your own/);
  });

  it("logs the decision, the quota and the absence together", async () => {
    const { report } = await team();
    const requestId = await ask(report);
    await decideLeaveRequest({}, form({ id: requestId, decision: "Approved" }));

    const r = await rawClient().execute({
      sql: `SELECT entity, action, actor_name FROM app_change_log
            WHERE subject_employee_id = ? ORDER BY id`,
      args: [report.employeeId],
    });
    const entries = r.rows.map((e) => `${e.entity}:${e.action}`);
    expect(entries).toEqual([
      "pt_leave_request:create",
      "pt_leave_request:update",
      "pt_it2006_absence_quota:update",
      "pt_it2001_absence:create",
    ]);
    expect(r.rows[1].actor_name).toBe("hr.admin");
  });
});
