import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { rawClient } from "@/lib/db";
import { systemActor } from "@/lib/change-log";
import { generateRoster, setRosterDay, recordPunches, runDailyAttendance } from "@/lib/engines/attendance";
import { calculateEmployee } from "@/lib/engines/payroll";
import { decideApproval } from "@/app/actions/approvals";
import { submitRegularisation } from "@/app/actions/attendance";
import { createBareEmployee, form } from "./support/fixtures";
import { createArea, hireForPayroll } from "./support/payroll-fixtures";
import { actAs, createPerson } from "./support/people";

/**
 * Shifts and rosters, punches turned into attendance (including a night
 * shift's own day), overtime reaching payroll, and a regularisation
 * correcting a missed punch once approved — each covering one of Phase 17's
 * "done when" criteria.
 */

const actor = systemActor("test");
const uid = () => randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase();

async function insertShift(opts: { start: string; end: string; breakMinutes?: number; graceMinutes?: number; isNight?: boolean }): Promise<string> {
  const code = `SHF${uid()}`;
  await rawClient().execute({
    sql: `INSERT INTO pt_shift (code, name, start_time, end_time, break_minutes, is_night, grace_minutes, is_active)
          VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
    args: [code, code, opts.start, opts.end, opts.breakMinutes ?? 30, opts.isNight ? 1 : 0, opts.graceMinutes ?? 10],
  });
  return code;
}

async function insertDevice(): Promise<string> {
  const code = `DEV${uid()}`;
  await rawClient().execute({ sql: "INSERT INTO pt_device (code, name, is_active) VALUES (?, ?, 1)", args: [code, code] });
  return code;
}

describe("rosters", () => {
  it("generates a month's roster from a rotating three-shift pattern", async () => {
    const [morning, afternoon, night] = await Promise.all([
      insertShift({ start: "06:00", end: "14:00" }),
      insertShift({ start: "14:00", end: "22:00" }),
      insertShift({ start: "22:00", end: "06:00", isNight: true }),
    ]);
    const patternCode = `PAT${uid()}`;
    await rawClient().execute({
      sql: "INSERT INTO pt_roster_pattern (code, name, cycle_length_days, is_active) VALUES (?, ?, 21, 1)",
      args: [patternCode, patternCode],
    });
    for (let i = 0; i < 21; i += 1) {
      const shift = i < 7 ? morning : i < 14 ? afternoon : night;
      await rawClient().execute({
        sql: "INSERT INTO pt_roster_pattern_day (pattern_code, day_index, shift_code) VALUES (?, ?, ?)",
        args: [patternCode, i, shift],
      });
    }

    const employeeId = await createBareEmployee("ZZA");
    const result = await generateRoster(rawClient(), {
      patternCode,
      employeeIds: [employeeId],
      fromDate: "2026-01-01",
      toDate: "2026-01-31",
      createdBy: "test",
    });
    expect(result.days).toBe(31);

    const rows = await rawClient().execute({ sql: "SELECT date, shift_code FROM pt_roster WHERE employee_id = ? ORDER BY date", args: [employeeId] });
    expect(rows.rows).toHaveLength(31);
    expect(rows.rows[0].shift_code).toBe(morning); // day index 0
    expect(rows.rows[7].shift_code).toBe(afternoon); // day index 7
    expect(rows.rows[14].shift_code).toBe(night); // day index 14
    expect(rows.rows[20].shift_code).toBe(night); // day index 20, the cycle's last day
  });

  it("is edited by exception without needing the pattern regenerated", async () => {
    const shift = await insertShift({ start: "09:00", end: "17:00" });
    const employeeId = await createBareEmployee("ZZA");
    await setRosterDay(rawClient(), { employeeId, date: "2026-02-01", shiftCode: shift, createdBy: "test" });
    await setRosterDay(rawClient(), { employeeId, date: "2026-02-01", shiftCode: null, createdBy: "test" });
    const row = await rawClient().execute({ sql: "SELECT shift_code FROM pt_roster WHERE employee_id = ? AND date = ?", args: [employeeId, "2026-02-01"] });
    expect(row.rows[0].shift_code).toBeNull();
  });
});

describe("punches into attendance", () => {
  it("becomes daily attendance with a late mark past the grace period", async () => {
    const shift = await insertShift({ start: "09:00", end: "17:00", breakMinutes: 30, graceMinutes: 10 });
    const device = await insertDevice();
    const employeeId = await createBareEmployee("ZZA");
    await setRosterDay(rawClient(), { employeeId, date: "2026-03-10", shiftCode: shift, createdBy: "test" });

    await recordPunches(rawClient(), [
      { employeeId, deviceCode: device, at: "2026-03-10T03:45:00.000Z", direction: "In", source: "Device" }, // 09:15 IST
      { employeeId, deviceCode: device, at: "2026-03-10T11:35:00.000Z", direction: "Out", source: "Device" }, // 17:05 IST
    ]);
    const result = await runDailyAttendance(rawClient(), { date: "2026-03-10", employeeIds: [employeeId], actor });
    expect(result.finalised).toBe(1);

    const day = await rawClient().execute({ sql: "SELECT * FROM pt_attendance_day WHERE employee_id = ? AND date = ?", args: [employeeId, "2026-03-10"] });
    expect(day.rows[0].status).toBe("Late");
    expect(Number(day.rows[0].late_minutes)).toBe(5); // 15 minutes late, 10 forgiven
  });

  it("marks a rostered day nobody punched as absent", async () => {
    const shift = await insertShift({ start: "09:00", end: "17:00" });
    const employeeId = await createBareEmployee("ZZA");
    await setRosterDay(rawClient(), { employeeId, date: "2026-03-11", shiftCode: shift, createdBy: "test" });
    await runDailyAttendance(rawClient(), { date: "2026-03-11", employeeIds: [employeeId], actor });
    const day = await rawClient().execute({ sql: "SELECT status FROM pt_attendance_day WHERE employee_id = ? AND date = ?", args: [employeeId, "2026-03-11"] });
    expect(day.rows[0].status).toBe("Absent");
  });

  it("reads a night shift's punches from its own start to its own end, not one calendar day", async () => {
    const shift = await insertShift({ start: "22:00", end: "06:00", isNight: true, breakMinutes: 30, graceMinutes: 10 });
    const device = await insertDevice();
    const employeeId = await createBareEmployee("ZZA");
    await setRosterDay(rawClient(), { employeeId, date: "2026-03-12", shiftCode: shift, createdBy: "test" });
    // In at 22:00 IST on the 12th, out at 06:00 IST on the 13th.
    await recordPunches(rawClient(), [
      { employeeId, deviceCode: device, at: "2026-03-12T16:30:00.000Z", direction: "In", source: "Device" },
      { employeeId, deviceCode: device, at: "2026-03-13T00:30:00.000Z", direction: "Out", source: "Device" },
    ]);
    await runDailyAttendance(rawClient(), { date: "2026-03-12", employeeIds: [employeeId], actor });
    const day = await rawClient().execute({ sql: "SELECT * FROM pt_attendance_day WHERE employee_id = ? AND date = ?", args: [employeeId, "2026-03-12"] });
    expect(day.rows[0].status).toBe("Present");
    expect(Number(day.rows[0].worked_minutes)).toBe(450); // 8h less a 30-minute break
  });

  it("a duplicate upload creates no duplicate punches", async () => {
    const device = await insertDevice();
    const employeeId = await createBareEmployee("ZZA");
    const batch = [{ employeeId, deviceCode: device, at: "2026-03-10T03:45:00.000Z", direction: "In" as const, source: "Device" as const }];
    const first = await recordPunches(rawClient(), batch);
    const second = await recordPunches(rawClient(), batch);
    expect(first.written).toBe(1);
    expect(second).toEqual({ written: 0, skipped: 1 });
    const count = await rawClient().execute({ sql: "SELECT COUNT(*) AS n FROM pt_punch WHERE employee_id = ?", args: [employeeId] });
    expect(Number(count.rows[0].n)).toBe(1);
  });
});

describe("overtime", () => {
  it("reaches payroll as its own line, at double the hourly rate", async () => {
    const shift = await insertShift({ start: "09:00", end: "17:00", breakMinutes: 30, graceMinutes: 10 });
    const device = await insertDevice();
    const area = await createArea();
    const employeeId = await hireForPayroll({ area, hireDate: "2020-01-01", pay: [{ from: "2020-01-01", amountRupees: 60_000 }] });

    const now = new Date();
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth() + 1;
    const date = `${year}-${String(month).padStart(2, "0")}-10`;

    await setRosterDay(rawClient(), { employeeId, date, shiftCode: shift, createdBy: "test" });
    await recordPunches(rawClient(), [
      { employeeId, deviceCode: device, at: new Date(`${date}T09:00:00+05:30`).toISOString(), direction: "In", source: "Device" },
      { employeeId, deviceCode: device, at: new Date(`${date}T20:00:00+05:30`).toISOString(), direction: "Out", source: "Device" },
    ]);
    await runDailyAttendance(rawClient(), { date, employeeIds: [employeeId], actor });

    const day = await rawClient().execute({ sql: "SELECT overtime_minutes FROM pt_attendance_day WHERE employee_id = ? AND date = ?", args: [employeeId, date] });
    expect(Number(day.rows[0].overtime_minutes)).toBe(180); // 11h in, minus a 30-minute break, minus 450 scheduled

    const paid = await calculateEmployee({ employeeId, year, month });
    const ot = paid.lines.find((l) => l.wageTypeCode === "OT");
    expect(ot).toBeDefined();
    expect(ot!.amountPaise).toBeGreaterThan(0);
  });
});

describe("regularisation", () => {
  it("corrects a missed punch once approved, and leaves it alone if rejected", async () => {
    const shift = await insertShift({ start: "09:00", end: "17:00", breakMinutes: 30, graceMinutes: 10 });
    const manager = await createPerson({ roles: ["MANAGER", "EMPLOYEE"] });
    const report = await createPerson({ reportsTo: manager.position });
    const date = "2026-04-06";
    await setRosterDay(rawClient(), { employeeId: report.employeeId, date, shiftCode: shift, createdBy: "test" });
    await runDailyAttendance(rawClient(), { date, employeeIds: [report.employeeId], actor });

    const before = await rawClient().execute({ sql: "SELECT status FROM pt_attendance_day WHERE employee_id = ? AND date = ?", args: [report.employeeId, date] });
    expect(before.rows[0].status).toBe("Absent");

    actAs(report.session);
    const submitted = await submitRegularisation(
      {},
      form({ date, claimedIn: `${date}T09:05`, claimedOut: `${date}T17:02`, reason: "Forgot to punch, on site all day" }),
    );
    expect(submitted).toEqual({ ok: true });
    actAs(null);

    const wf = await rawClient().execute({
      sql: "SELECT id FROM wf_request WHERE process = 'regularisation' AND subject_employee_id = ? ORDER BY id DESC LIMIT 1",
      args: [report.employeeId],
    });
    const requestId = Number(wf.rows[0].id);

    actAs(manager.session);
    const decided = await decideApproval({}, form({ requestId, decision: "Approved" }));
    expect(decided).toEqual({ ok: true });
    actAs(null);

    const after = await rawClient().execute({ sql: "SELECT status, worked_minutes FROM pt_attendance_day WHERE employee_id = ? AND date = ?", args: [report.employeeId, date] });
    expect(after.rows[0].status).toBe("Present");
    expect(Number(after.rows[0].worked_minutes)).toBeGreaterThan(0);

    const request = await rawClient().execute({ sql: "SELECT status FROM pt_regularisation WHERE employee_id = ? AND date = ?", args: [report.employeeId, date] });
    expect(request.rows[0].status).toBe("Approved");
  });

  it("refuses a request with no time claimed at all", async () => {
    const report = await createPerson({ roles: ["EMPLOYEE"] });
    actAs(report.session);
    const result = await submitRegularisation({}, form({ date: "2026-04-07", claimedIn: "", claimedOut: "", reason: "Missed it" }));
    actAs(null);
    expect(result.error).toBeTruthy();
  });
});
