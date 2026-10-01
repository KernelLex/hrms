import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { rawClient } from "@/lib/db";
import { systemActor } from "@/lib/change-log";
import { accrueForPeriod, leaveLiabilityAsOf, dailyRatePaise } from "@/lib/engines/leave-policy";
import { balancesFor, policyFor, calendarFor } from "@/lib/engines/quota";
import { headcountAsOf, trailingMonths } from "@/lib/repositories/reports";
import { backfillHeadcountSnapshots, headcountTrend, runDueSchedules, renderReportCsv } from "@/lib/reports";
import { renderAttachment } from "@/lib/email-attachments";
import { todayInIndia } from "@/lib/dates";

/**
 * Phase 24: the headcount trend against as-of counts computed independently,
 * leave liability against a hand calculation composed from the same trusted
 * primitives `encashLeave` itself uses, and a scheduled report landing with
 * the right attachment.
 */

const uid = () => randomUUID().slice(0, 6).toUpperCase();
const actor = systemActor("test");

async function one(sql: string, args: (string | number)[] = []) {
  return (await rawClient().execute({ sql, args })).rows[0] as unknown as Record<string, unknown> | undefined;
}

describe("the headcount trend", () => {
  it("equals as-of counts computed from the time slices", async () => {
    const today = todayInIndia();
    const months = trailingMonths(today);
    const monthEndOf = (month: string) => {
      const d = new Date(`${month}T00:00:00Z`);
      d.setUTCMonth(d.getUTCMonth() + 1);
      d.setUTCDate(0);
      return d.toISOString().slice(0, 10);
    };

    // A past snapshot, once taken, is never recomputed — correct in
    // production, where nobody backdates a hire after the month has closed,
    // but other test files in this same run do exactly that. Clearing the
    // three most recent months first forces a fresh read, so this test
    // compares against the live state as it stands right now, not whatever
    // it was when an earlier file's own fixtures first triggered a snapshot.
    const recent = months.slice(-3);
    await rawClient().execute({
      sql: `DELETE FROM rp_snapshot WHERE measure = 'headcount' AND dimension = 'ALL' AND month IN (${recent.map(() => "?").join(", ")})`,
      args: recent,
    });

    await backfillHeadcountSnapshots(today);
    const trend = await headcountTrend(today);
    expect(trend.map((t) => t.month)).toEqual(months);

    for (const month of recent) {
      const expected = await headcountAsOf(monthEndOf(month));
      expect(trend.find((t) => t.month === month)!.value).toBe(expected);
    }
  });

  it("picks up a new hire from the month they joined", async () => {
    const today = todayInIndia();
    const currentMonthEnd = (() => {
      const d = new Date(`${today.slice(0, 7)}-01T00:00:00Z`);
      d.setUTCMonth(d.getUTCMonth() + 1);
      d.setUTCDate(0);
      return d.toISOString().slice(0, 10);
    })();
    const before = await headcountAsOf(currentMonthEnd);
    await rawClient().execute({
      sql: `INSERT INTO pa_employee (employee_number, hire_date, employment_status, created_at) VALUES (?, ?, 'Active', ?)`,
      args: [`ZZR${uid()}`, today, new Date().toISOString()],
    });
    const after = await headcountAsOf(currentMonthEnd);
    expect(after).toBe(before + 1);

    await backfillHeadcountSnapshots(today);
    const trend = await headcountTrend(today);
    expect(trend[trend.length - 1].value).toBe(after);
  });
});

describe("leave liability", () => {
  async function hire(hireDate: string): Promise<number> {
    const created = await rawClient().execute({
      sql: `INSERT INTO pa_employee (employee_number, hire_date, employment_status, created_at) VALUES (?, ?, 'Active', ?) RETURNING id`,
      args: [`ZZR${uid()}`, hireDate, new Date().toISOString()],
    });
    return Number(created.rows[0].id);
  }

  it("equals a hand calculation composed from the same primitives encashLeave uses", async () => {
    const employeeId = await hire("2020-01-01");
    await rawClient().execute({
      sql: `INSERT INTO pa_it0008_basic_pay (employee_id, pay_scale_type, pay_scale_group, amount_paise, currency, valid_from, valid_to, seq, created_by, created_at)
            VALUES (?, 'Monthly salaried', 'L1', 6000000, 'INR', '2020-01-01', '9999-12-31', 1, 'test', ?)`,
      args: [employeeId, new Date().toISOString()],
    });
    const today = todayInIndia();
    const year = Number(today.slice(0, 4));
    await accrueForPeriod(rawClient(), { year, month: Number(today.slice(5, 7)), employeeIds: [employeeId], createdBy: "test", actor });

    // By hand: for every quota type with an encashable cap, the smaller of
    // the balance and the cap, at the daily rate — precisely what a cash-out
    // today would pay, without actually paying it.
    const balances = await balancesFor(employeeId, year);
    let expectedPaise = 0;
    for (const b of balances) {
      const policy = await policyFor(employeeId, b.quotaTypeCode, today);
      if (!policy || policy.encashableHalfDaysPerYear <= 0) continue;
      const units = Math.min(b.balanceUnits, policy.encashableHalfDaysPerYear);
      if (units <= 0) continue;
      const calendarCode = await calendarFor(employeeId, today);
      const rate = await dailyRatePaise(employeeId, today, calendarCode);
      expectedPaise += Math.round((rate * units) / 2);
    }
    expect(expectedPaise).toBeGreaterThan(0);

    const liability = await leaveLiabilityAsOf(today);
    const mine = liability.byEmployee.filter((r) => r.employeeId === employeeId);
    const minePaise = mine.reduce((s, r) => s + r.amountPaise, 0);
    expect(minePaise).toBe(expectedPaise);
    expect(liability.totalPaise).toBeGreaterThanOrEqual(minePaise);
  });

  it("is zero for a quota type whose policy does not allow encashment", async () => {
    const employeeId = await hire("2020-01-01");
    const today = todayInIndia();
    const year = Number(today.slice(0, 4));
    await accrueForPeriod(rawClient(), { year, month: Number(today.slice(5, 7)), employeeIds: [employeeId], createdBy: "test", actor });
    const liability = await leaveLiabilityAsOf(today);
    // SICK is seeded with no encashment; this employee contributes nothing for it.
    expect(liability.byEmployee.some((r) => r.employeeId === employeeId && r.quotaTypeCode === "SICK")).toBe(false);
  });
});

describe("scheduled reports", () => {
  it("lands in its recipients' inboxes with the right attachment", async () => {
    const to = `report.${uid().toLowerCase()}@example.com`;
    const created = await rawClient().execute({
      sql: `INSERT INTO rp_schedule (report_name, recipients, created_by, created_at) VALUES ('headcount_trend', ?, 'test', ?) RETURNING id`,
      args: [to, new Date().toISOString()],
    });
    const scheduleId = Number(created.rows[0].id);

    const sent = await runDueSchedules(todayInIndia());
    expect(sent).toBeGreaterThan(0);

    const message = await one("SELECT subject, attachments FROM app_outbox WHERE recipient = ?", [to]);
    expect(message).toBeTruthy();
    const attachments = JSON.parse(String(message!.attachments));
    expect(attachments).toEqual([{ type: "report", reportName: "headcount_trend", scheduleId, fileName: expect.stringContaining("headcount-trend") }]);

    const rendered = await renderAttachment(attachments[0]);
    expect(rendered?.contentType).toBe("text/csv; charset=utf-8");
    expect(Buffer.from(rendered!.bytes).toString("utf-8")).toContain("Month,Headcount");

    // Already sent this month: running again queues nothing new for it.
    const schedule = await one("SELECT last_run_at FROM rp_schedule WHERE id = ?", [scheduleId]);
    expect(schedule!.last_run_at).toBeTruthy();
    await rawClient().execute({ sql: "DELETE FROM app_outbox WHERE recipient = ?", args: [to] });
    await runDueSchedules(todayInIndia());
    const again = await one("SELECT id FROM app_outbox WHERE recipient = ?", [to]);
    expect(again).toBeUndefined();
  });

  it("renders a report that does not exist as nothing, not an error", async () => {
    expect(await renderReportCsv("not_a_real_report")).toBeNull();
  });
});
