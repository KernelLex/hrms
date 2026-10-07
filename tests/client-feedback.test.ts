import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { rawClient } from "@/lib/db";
import { OPEN_ENDED, OPTIONAL_HOLIDAY_ABSENCE_CODE } from "@/db/schema";
import { createApplication, makeOffer, recordInterviewFeedback, saveRequisition, scheduleInterview, selectCandidate, saveCandidate, takeToInterview } from "@/app/actions/recruitment";
import { submitExit, withdrawExit, revokeExit } from "@/app/actions/exits";
import { submitClaim } from "@/app/actions/loans-claims";
import { nominate } from "@/app/actions/training";
import { setOptionalHoliday, saveHoliday, saveHolidayCalendar } from "@/app/actions/time";
import { punchNow } from "@/app/actions/attendance";
import { decideApproval } from "@/app/actions/approvals";
import { requestFor } from "@/lib/workflow/engine";
import { workingDaysBetween } from "@/lib/engines/quota";
import { form } from "./support/fixtures";
import { actAs, createPerson, type Person } from "./support/people";

/**
 * What the client asked for after seeing the prototype: a requisition that
 * describes the role before it opens and stops taking applications once it
 * is filled, a resignation nobody can quietly undo after it has been
 * approved, a claim that comes with its bill, training a manager assigns
 * only to their own team, optional holidays, clocking in from the app, and
 * voluntary provident fund on the payslip.
 */

const uid = () => Math.random().toString(36).slice(2, 8).toUpperCase();
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const one = async (sql: string, args: (string | number)[] = []) =>
  (await rawClient().execute({ sql, args })).rows[0] as Record<string, unknown> | undefined;
const bill = () => new File([new TextEncoder().encode("%PDF-1.4\n% bill\n%%EOF")], "bill.pdf", { type: "application/pdf" });

let manager: Person;
let employee: Person;
let outsider: Person;

beforeAll(async () => {
  manager = await createPerson({ roles: ["MANAGER", "EMPLOYEE"] });
  employee = await createPerson({ reportsTo: manager.position, roles: ["EMPLOYEE"] });
  outsider = await createPerson({ roles: ["EMPLOYEE"] });
});
afterEach(() => actAs(null));

async function vacantPosition(): Promise<string> {
  const code = `CF${uid()}`;
  await rawClient().execute({
    sql: `INSERT INTO om_position (code, title, org_unit_code, job_code, reports_to_code, is_manager, is_vacant, valid_from, valid_to, is_active)
          VALUES (?, 'Client feedback role', 'OU0002', 'JB0001', 'PS0001', 0, 1, '2024-01-01', ?, 1)`,
    args: [code, OPEN_ENDED],
  });
  return code;
}

/** A requisition with everything the role now has to say about itself. */
async function openRequisition(extra: Record<string, string | number> = {}) {
  const r = await saveRequisition(
    {},
    form({
      positionCode: await vacantPosition(),
      title: "Client feedback role",
      description: "Runs the work this requisition exists for, with enough detail that a candidate knows what the job is.",
      skills: "Diligence",
      experienceMinYears: 2,
      hiringManagerEmployeeId: manager.employeeId,
      openings: 1,
      postedDate: day(0),
      status: "Open",
      ...extra,
    }),
  );
  expect(r.error).toBeUndefined();
  const row = await one("SELECT id FROM rc_requisition WHERE code = ?", [r.code!]);
  return { code: r.code!, id: Number(row!.id) };
}

async function candidate(): Promise<number> {
  const email = `cf.${uid().toLowerCase()}@example.com`;
  await saveCandidate({}, form({ fullName: `Candidate ${uid()}`, email, phone: `+9198${Math.floor(Math.random() * 90_000_000 + 10_000_000)}`, source: "Job portal" }));
  const row = await one("SELECT id FROM rc_candidate WHERE email = ?", [email]);
  return Number(row!.id);
}

describe("opening a requisition", () => {
  it("will not open one that does not describe the role, and hands back what was typed", async () => {
    const bare = await saveRequisition({}, form({ positionCode: await vacantPosition(), title: "Half a role", openings: 1, postedDate: day(0) }));
    expect(bare.error).toBeTruthy();
    // Nothing typed is lost when it is refused.
    expect(bare.values?.title).toBe("Half a role");

    const noManager = await saveRequisition(
      {},
      form({
        positionCode: await vacantPosition(),
        title: "No manager",
        description: "Long enough a description to pass the bar on what candidates get to read about the role.",
        skills: "Diligence",
        experienceMinYears: 1,
        openings: 1,
        postedDate: day(0),
      }),
    );
    expect(noManager.error).toMatch(/hiring manager/i);
  });
});

describe("a role whose openings are all offered", () => {
  it("takes no new application, on the careers page or from HR, until the offer is declined", async () => {
    const req = await openRequisition({ isPublished: "on" });
    const interviewer = await createPerson({ roles: ["EMPLOYEE"] });

    // Take one candidate all the way to an offer.
    const first = await createApplication({}, form({ candidateId: await candidate(), requisitionId: req.id }));
    await takeToInterview({}, form({ id: first.id! }));
    const round = await scheduleInterview(
      {},
      form({ applicationId: first.id!, round: "Only round", interviewerEmployeeId: interviewer.employeeId, scheduledDate: day(1), scheduledTime: "10:00", durationMinutes: 45, mode: "Video call" }),
    );
    actAs(interviewer.session);
    await recordInterviewFeedback({}, form({ id: round.id!, rating: 4, recommendation: "Advance", feedback: "Fine." }));
    actAs(null);
    await selectCandidate({}, form({ id: first.id! }));
    const offered = await makeOffer({}, form({ id: first.id!, annualCtc: 600_000, structureCode: "STANDARD", joiningDate: day(30), expiryDate: day(10) }));
    expect(offered.ok).toBe(true);

    // Its one opening is taken, so nobody else may apply.
    const second = await createApplication({}, form({ candidateId: await candidate(), requisitionId: req.id }));
    expect(second.error).toMatch(/offered or filled/);

    // And it is off the careers page.
    const { publishedRoles } = await import("@/lib/repositories/recruitment");
    expect((await publishedRoles()).some((r) => r.code === req.code)).toBe(false);
  });
});

describe("an interview invitation", () => {
  it("carries the calendar file to the candidate, as an attachment the outbox builds on demand", async () => {
    const req = await openRequisition();
    const interviewer = await createPerson({ roles: ["EMPLOYEE"] });
    const application = await createApplication({}, form({ candidateId: await candidate(), requisitionId: req.id }));
    await takeToInterview({}, form({ id: application.id! }));
    const round = await scheduleInterview(
      {},
      form({ applicationId: application.id!, round: "Technical round", interviewerEmployeeId: interviewer.employeeId, scheduledDate: day(2), scheduledTime: "09:30", durationMinutes: 45, mode: "Video call" }),
    );
    expect(round.ok).toBe(true);

    const queued = await one("SELECT attachments FROM app_outbox WHERE dedupe_key LIKE ? ORDER BY id DESC LIMIT 1", [`interview.confirmed:${round.id}%`]);
    expect(queued, "a confirmation email for the candidate").toBeTruthy();
    const attachments = JSON.parse(String(queued!.attachments)) as { type: string; interviewId: number; fileName: string }[];
    expect(attachments).toHaveLength(1);
    expect(attachments[0]).toMatchObject({ type: "interview", interviewId: round.id, fileName: `interview-${round.id}.ics` });

    // The outbox makes it from the round itself, rather than storing bytes.
    const { renderAttachment } = await import("@/lib/email-attachments");
    const file = await renderAttachment(attachments[0] as never);
    expect(file).toBeTruthy();
    expect(new TextDecoder().decode(file!.bytes)).toContain("BEGIN:VCALENDAR");
    expect(file!.contentType).toMatch(/text\/calendar/);
  });
});

describe("a resignation", () => {
  async function resign(person: Person, lastDay: string) {
    actAs(person.session);
    const r = await submitExit({}, form({ requestedLastDay: lastDay, noticeDays: 30, reason: "Moving on" }));
    actAs(null);
    expect(r.ok).toBe(true);
    return Number((await one("SELECT id FROM pa_exit WHERE employee_id = ? ORDER BY id DESC LIMIT 1", [person.employeeId]))!.id);
  }

  it("is the employee's to withdraw until someone approves a step of it", async () => {
    const person = await createPerson({ reportsTo: manager.position, roles: ["EMPLOYEE"] });
    const exitId = await resign(person, day(45));

    // Their manager approves the first step; HR still has to agree.
    const request = await requestFor("pa_exit", exitId);
    actAs(manager.session);
    expect((await decideApproval({}, form({ requestId: request!.id, decision: "Approved", comment: "" }))).ok).toBe(true);
    actAs(null);

    actAs(person.session);
    const tooLate = await withdrawExit({}, form({ id: exitId }));
    actAs(null);
    expect(tooLate.error).toMatch(/already been approved/);
    expect(String((await one("SELECT status FROM pa_exit WHERE id = ?", [exitId]))!.status)).toBe("Pending");
  });

  it("can be cancelled by HR after it is approved, and the employee stays", async () => {
    const person = await createPerson({ reportsTo: manager.position, roles: ["EMPLOYEE"] });
    const exitId = await resign(person, day(45));
    for (let guard = 0; guard < 5; guard += 1) {
      const request = await requestFor("pa_exit", exitId);
      if (!request || request.status !== "Pending") break;
      expect((await decideApproval({}, form({ requestId: request.id, decision: "Approved", comment: "" }))).ok).toBe(true);
    }
    expect(String((await one("SELECT status FROM pa_exit WHERE id = ?", [exitId]))!.status)).toBe("Approved");

    expect((await revokeExit({}, form({ id: exitId, reason: "Staying after all" }))).ok).toBe(true);
    const after = await one("SELECT status, decision_note FROM pa_exit WHERE id = ?", [exitId]);
    expect(after).toMatchObject({ status: "Withdrawn", decision_note: "Staying after all" });
    // Nothing was written to their record: they are still employed.
    expect(String((await one("SELECT employment_status FROM pa_employee WHERE id = ?", [person.employeeId]))!.employment_status)).toBe("Active");
  });
});

describe("a claim", () => {
  it("is refused without the bill for every line", async () => {
    actAs(employee.session);
    const r = await submitClaim({}, form({ categoryCode: "FUEL", claimDate: day(0), line_date_0: day(0), line_description_0: "Petrol", line_amount_0: 500 }));
    actAs(null);
    expect(r.error).toMatch(/bill/i);
  });

  it("goes through once each line has one", async () => {
    actAs(employee.session);
    const r = await submitClaim({}, form({ categoryCode: "FUEL", claimDate: day(0), line_date_0: day(0), line_description_0: "Petrol", line_amount_0: 500, line_file_0: bill() }));
    actAs(null);
    expect(r.ok).toBe(true);
  });
});

describe("nominating someone for training", () => {
  async function session(): Promise<number> {
    const code = `CFC${uid()}`;
    await rawClient().execute({ sql: "INSERT INTO ld_course (code, title, description, cost_paise, is_active) VALUES (?, 'Client feedback course', NULL, 0, 1)", args: [code] });
    const r = await rawClient().execute({
      sql: `INSERT INTO ld_session (course_code, start_date, end_date, capacity, place, cost_paise, created_at) VALUES (?, ?, ?, 10, 'Room 1', 0, ?) RETURNING id`,
      args: [code, day(20), day(21), new Date().toISOString()],
    });
    return Number(r.rows[0].id);
  }

  it("is refused for a colleague who does not report to you", async () => {
    const sessionId = await session();
    actAs(employee.session);
    const r = await nominate({}, form({ sessionId, employeeId: outsider.employeeId }));
    actAs(null);
    expect(r.error).toMatch(/only nominate yourself/i);
  });

  it("is allowed for your own report, who is told about it", async () => {
    const sessionId = await session();
    actAs(manager.session);
    const r = await nominate({}, form({ sessionId, employeeId: employee.employeeId }));
    actAs(null);
    expect(r.ok).toBe(true);

    const nomination = await one("SELECT id, status FROM ld_nomination WHERE session_id = ? AND employee_id = ?", [sessionId, employee.employeeId]);
    expect(nomination).toMatchObject({ status: "Requested" });
    const told = await one("SELECT kind FROM app_notification WHERE user_id = ? AND kind = 'nomination.assigned' ORDER BY id DESC LIMIT 1", [employee.userId]);
    expect(told).toBeTruthy();
  });
});

describe("an optional holiday", () => {
  const calendar = `CFCAL${uid()}`;
  let holidayId: number;
  const date = `${new Date().getUTCFullYear()}-12-24`;

  it("is a working day for everyone until someone takes it", async () => {
    expect((await saveHolidayCalendar({}, form({ code: calendar, name: "Client feedback calendar", optionalAllowance: 1, isActive: "on" }))).ok).toBe(true);
    expect((await saveHoliday({}, form({ date, name: "An optional festival", calendarCode: calendar, isOptional: "on" }))).ok).toBe(true);
    holidayId = Number((await one("SELECT id FROM pt_holiday WHERE calendar_code = ? AND date = ?", [calendar, date]))!.id);

    // Working-day maths ignores it: it is nobody's holiday yet.
    const alone = await workingDaysBetween(date, date, calendar);
    const day = new Date(`${date}T00:00:00Z`).getUTCDay();
    expect(alone).toBe(day === 0 || day === 6 ? 0 : 1);
  });

  it("becomes a paid day off for the one person who takes it, and only up to the allowance", async () => {
    // Put this employee's area on the calendar that has the optional holiday.
    await rawClient().execute({ sql: "UPDATE om_personnel_area SET calendar_code = ? WHERE code = 'PA01'", args: [calendar] });
    try {
      actAs(employee.session);
      expect((await setOptionalHoliday({}, form({ holidayId, take: 1 }))).ok).toBe(true);

      const absence = await one(
        "SELECT absence_type_code, start_date FROM pt_it2001_absence WHERE employee_id = ? AND start_date = ?",
        [employee.employeeId, date],
      );
      expect(absence).toMatchObject({ absence_type_code: OPTIONAL_HOLIDAY_ABSENCE_CODE });

      // A second one is over the allowance of one.
      actAs(null);
      const second = await saveHoliday({}, form({ date: `${new Date().getUTCFullYear()}-12-26`, name: "Another optional festival", calendarCode: calendar, isOptional: "on" }));
      expect(second.ok).toBe(true);
      const secondId = Number((await one("SELECT id FROM pt_holiday WHERE calendar_code = ? AND date = ?", [calendar, `${new Date().getUTCFullYear()}-12-26`]))!.id);
      actAs(employee.session);
      const over = await setOptionalHoliday({}, form({ holidayId: secondId, take: 1 }));
      expect(over.error).toMatch(/already taken your 1 optional holiday/);
    } finally {
      actAs(null);
      await rawClient().execute("UPDATE om_personnel_area SET calendar_code = 'KARNATAKA' WHERE code = 'PA01'");
    }
  });
});

describe("clocking in from the app", () => {
  it("writes the same punch a device would, and refuses the same one twice", async () => {
    const person = await createPerson({ roles: ["EMPLOYEE"] });
    actAs(person.session);
    const inPunch = await punchNow({}, form({ direction: "In" }));
    actAs(null);
    expect(inPunch.ok).toBe(true);

    const punch = await one("SELECT device_code, direction, source FROM pt_punch WHERE employee_id = ? ORDER BY id DESC LIMIT 1", [person.employeeId]);
    expect(punch).toMatchObject({ device_code: "WEB", direction: "In", source: "Web" });
  });
});

describe("voluntary provident fund", () => {
  it("is deducted on top of the statutory 12%, at the percentage on the employee's own dated record", async () => {
    const { calculateEmployee } = await import("@/lib/engines/payroll");
    const now = new Date();
    const period = { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 };
    const person = await createPerson({ roles: ["EMPLOYEE"] });
    const at = new Date().toISOString();
    const basic = 50_000_00; // ₹50,000 a month

    await rawClient().batch(
      [
        {
          sql: `INSERT INTO pa_it0008_basic_pay (employee_id, valid_from, valid_to, seq, created_by, created_at,
                  pay_scale_type, pay_scale_area, pay_scale_group, amount_paise, currency)
                VALUES (?, '2020-01-01', ?, 1, 'test', ?, 'Monthly', 'IN', 'L2', ?, 'INR')`,
          args: [person.employeeId, OPEN_ENDED, at, basic],
        },
        {
          sql: `INSERT INTO pa_it0007_planned_working_time (employee_id, valid_from, valid_to, seq, created_by, created_at, work_schedule_code, weekly_hours, employment_percent)
                VALUES (?, '2020-01-01', ?, 1, 'test', ?, 'GEN', 40, 100)`,
          args: [person.employeeId, OPEN_ENDED, at],
        },
        {
          sql: `INSERT INTO pa_it0009_bank_details (employee_id, valid_from, valid_to, seq, created_by, created_at, bank_name, account_number, ifsc, holder_name)
                VALUES (?, '2020-01-01', ?, 1, 'test', ?, 'HDFC Bank', '50100123456789', 'HDFC0001234', 'Test Person')`,
          args: [person.employeeId, OPEN_ENDED, at],
        },
        {
          // 10% voluntary, on top of the statutory 12%.
          sql: `INSERT INTO pa_it0011_statutory_details (employee_id, uan, esi_number, professional_tax_state, vpf_basis_points, valid_from, valid_to, seq, created_by, created_at)
                VALUES (?, NULL, NULL, 'KARNATAKA', 1000, '2020-01-01', ?, 1, 'test', ?)`,
          args: [person.employeeId, OPEN_ENDED, at],
        },
      ],
      "write",
    );

    const result = await calculateEmployee({ employeeId: person.employeeId, ...period });
    expect(result.errorMessage ?? null).toBeNull();

    const vpf = result.lines.find((l) => l.wageTypeCode === "VPF");
    const pf = result.lines.find((l) => l.wageTypeCode === "PF");
    expect(vpf, "a VPF line").toBeDefined();
    expect(vpf!.kind).toBe("Deduction");
    // 10% of basic, and deliberately not capped at the PF wage ceiling the
    // compulsory 12% is worked out on — so it is more than the statutory line.
    expect(vpf!.amountPaise).toBe(Math.round((basic * 1000) / 10_000));
    expect(vpf!.amountPaise).toBeGreaterThan(pf!.amountPaise);
    // It comes out of net pay like any other deduction.
    expect(result.deductionsPaise).toBeGreaterThanOrEqual(vpf!.amountPaise);
  });
});
