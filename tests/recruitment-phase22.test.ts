import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { rawClient } from "@/lib/db";
import { OPEN_ENDED } from "@/db/schema";
import {
  createApplication,
  makeOffer,
  recordInterviewFeedback,
  referCandidate,
  saveCandidate,
  saveRequisition,
  scheduleInterview,
  selectCandidate,
  takeToInterview,
} from "@/app/actions/recruitment";
import { respondToOffer } from "@/app/actions/careers";
import { buildInterviewIcs, payQualifyingReferrals } from "@/lib/recruitment";
import { recruitmentAnalytics } from "@/lib/repositories/recruitment";
import { todayInIndia } from "@/lib/dates";
import { form, createBareEmployee } from "./support/fixtures";
import { actAs, createPerson, type Person } from "./support/people";

/**
 * Phase 22: scorecards required before notes, interview invitations with a
 * downloadable calendar file, a formal offer accepted through its own link
 * — converting to an employee with nobody retyping anything — and a
 * referral bonus paid once, after the qualifying period.
 */

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.50" }),
  cookies: async () => ({ get: () => undefined }),
}));

const uid = () => randomUUID().slice(0, 6).toUpperCase();
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

async function one(sql: string, args: (string | number)[] = []) {
  return (await rawClient().execute({ sql, args })).rows[0] as unknown as Record<string, unknown> | undefined;
}

// A job code of its own, so a scorecard template added for it in one test
// cannot make an unrelated test's round need a scorecard it does not expect.
async function vacantPosition(jobCode = "JB0001"): Promise<string> {
  const code = `PR${uid()}`;
  await rawClient().execute({
    sql: `INSERT INTO om_position (code, title, org_unit_code, job_code, reports_to_code, is_manager, is_vacant, valid_from, valid_to, is_active)
          VALUES (?, 'Field engineer', 'OU0002', ?, 'PS0001', 0, 1, '2024-01-01', ?, 1)`,
    args: [code, jobCode, OPEN_ENDED],
  });
  return code;
}

/** A candidate taken all the way to "Selected", ready for an offer. */
async function selectedApplication(budgetMaxPaise?: number): Promise<{ id: number; interviewer: Person }> {
  const interviewer = await createPerson({ roles: ["EMPLOYEE"] });
  const r = await saveRequisition(
    {},
    form({
      positionCode: await vacantPosition(),
      title: "Field engineer",
      description: "Services and maintains our equipment at client sites across the region.",
      openings: 1,
      postedDate: day(0),
      status: "Open",
      ...(budgetMaxPaise ? { budgetMax: budgetMaxPaise / 100 } : {}),
    }),
  );
  expect(r.ok).toBe(true);
  const email = `cand.${uid().toLowerCase()}@example.com`;
  await saveCandidate({}, form({ fullName: "Devika Rao", email, source: "Job portal" }));
  const candidate = await one("SELECT id FROM rc_candidate WHERE email = ?", [email]);
  const requisition = await one("SELECT id FROM rc_requisition WHERE code = ?", [r.code!]);
  const created = await createApplication({}, form({ candidateId: Number(candidate!.id), requisitionId: Number(requisition!.id) }));
  const id = created.id!;
  await takeToInterview({}, form({ id }));
  const interview = await scheduleInterview({}, form({ applicationId: id, round: "Technical round", interviewerEmployeeId: interviewer.employeeId, scheduledDate: day(1), scheduledTime: "10:00", durationMinutes: 45, mode: "Video call" }));

  // Whatever scorecard the role's job happens to carry, rated top marks —
  // this fixture is about getting to "Selected", not about the scorecard.
  const jobCode = (await one("SELECT job_code FROM rc_requisition WHERE id = ?", [Number(requisition!.id)]))!.job_code as string;
  const criteria = (await rawClient().execute({ sql: "SELECT criterion FROM rc_scorecard_template WHERE job_code = ? AND is_active = 1", args: [jobCode] })).rows;
  const feedback: Record<string, string | number> = { id: interview.id!, rating: 5, recommendation: "Advance", feedback: "Strong on diagnostics." };
  for (const c of criteria) feedback[`sc:${String(c.criterion)}`] = 5;

  actAs(interviewer.session);
  const notes = await recordInterviewFeedback({}, form(feedback));
  actAs(null);
  expect(notes.ok).toBe(true);
  expect((await selectCandidate({}, form({ id }))).ok).toBe(true);
  return { id, interviewer };
}

afterEach(() => actAs(null));

describe("scorecards", () => {
  it("are required before a round's notes are recorded, once the role has one", async () => {
    // A job of its own, so this scorecard cannot affect any other test's job.
    const jobCode = `JBX${uid()}`;
    await rawClient().execute({ sql: "INSERT INTO om_job (code, title, job_group, is_active) VALUES (?, 'Field engineer', 'Operations', 1)", args: [jobCode] });
    const vacant = await vacantPosition(jobCode);
    await rawClient().execute({
      sql: "INSERT INTO rc_scorecard_template (job_code, criterion, weight, sort_order, is_active) VALUES (?, 'Diagnostics', 2, 1, 1)",
      args: [jobCode],
    });

    const r = await saveRequisition({}, form({ positionCode: vacant, title: "Field engineer", description: "Repairs equipment on site for regional clients.", openings: 1, postedDate: day(0), status: "Open" }));
    const interviewer = await createPerson({ roles: ["EMPLOYEE"] });
    const email = `sc.${uid().toLowerCase()}@example.com`;
    await saveCandidate({}, form({ fullName: "Nikhil Shah", email, source: "Job portal" }));
    const candidate = await one("SELECT id FROM rc_candidate WHERE email = ?", [email]);
    const requisition = await one("SELECT id FROM rc_requisition WHERE code = ?", [r.code!]);
    const created = await createApplication({}, form({ candidateId: Number(candidate!.id), requisitionId: Number(requisition!.id) }));
    await takeToInterview({}, form({ id: created.id! }));
    const interview = await scheduleInterview({}, form({ applicationId: created.id!, round: "Technical round", interviewerEmployeeId: interviewer.employeeId, scheduledDate: day(1), scheduledTime: "11:00", durationMinutes: 45, mode: "Video call" }));

    actAs(interviewer.session);
    const missing = await recordInterviewFeedback({}, form({ id: interview.id!, rating: 4, recommendation: "Advance", feedback: "Good." }));
    expect(missing.error).toMatch(/Diagnostics/);

    const ok = await recordInterviewFeedback({}, form({ id: interview.id!, rating: 4, recommendation: "Advance", feedback: "Good.", "sc:Diagnostics": "5" }));
    expect(ok.ok).toBe(true);
    actAs(null);

    const saved = await one("SELECT rating FROM rc_scorecard WHERE interview_id = ? AND criterion = 'Diagnostics'", [interview.id!]);
    expect(saved).toMatchObject({ rating: 5 });
  });
});

describe("interview invitations", () => {
  it("queues a confirmation to the candidate, and builds a calendar file", async () => {
    const { id } = await selectedApplication();
    // Reaching "Selected" already scheduled and completed one round; the
    // candidate's confirmation for it is in the outbox.
    const sent = await one(
      "SELECT recipient FROM app_outbox WHERE dedupe_key LIKE 'interview.confirmed:%' ORDER BY id DESC LIMIT 1",
    );
    expect(sent).toBeTruthy();

    const ics = buildInterviewIcs(
      { id: 999, round: "Technical round", scheduledDate: day(1), scheduledTime: "10:00", durationMinutes: 45, location: "Room 2A", createdAt: new Date().toISOString() },
      "Field engineer",
      "Devika Rao",
    );
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("SUMMARY:Technical round with Devika Rao");
    expect(ics).toContain("LOCATION:Room 2A");
    void id;
  });
});

describe("offers", () => {
  it("accepted through the candidate's own link converts them into an employee, with nothing retyped", async () => {
    const { id } = await selectedApplication();
    const sent = await makeOffer({}, form({ id, annualCtc: "600000", structureCode: "STANDARD", joiningDate: day(10), expiryDate: day(20) }));
    expect(sent.ok).toBe(true);
    const offer = await one("SELECT token FROM rc_offer WHERE application_id = ?", [id]);
    const token = String(offer!.token);

    const result = await respondToOffer({}, form({ token, decision: "accept" }));
    expect(result).toMatchObject({ ok: true, accepted: true });

    const application = await one("SELECT stage FROM rc_application WHERE id = ?", [id]);
    expect(application).toMatchObject({ stage: "Hired" });
    const conversion = await one("SELECT employee_id FROM rc_hire_conversion WHERE application_id = ?", [id]);
    expect(Number(conversion!.employee_id)).toBeGreaterThan(0);

    // Answered once; the link does not work again.
    expect((await respondToOffer({}, form({ token, decision: "accept" }))).error).toMatch(/already/);
  });

  it("declined closes the application, and recruitment is told", async () => {
    const { id } = await selectedApplication();
    await makeOffer({}, form({ id, annualCtc: "600000", structureCode: "STANDARD", joiningDate: day(10), expiryDate: day(20) }));
    const offer = await one("SELECT token FROM rc_offer WHERE application_id = ?", [id]);
    const result = await respondToOffer({}, form({ token: String(offer!.token), decision: "decline" }));
    expect(result).toMatchObject({ ok: true, accepted: false });
    // The application keeps the stage it reached, same as any other rejection.
    const application = await one("SELECT stage, rejected_at FROM rc_application WHERE id = ?", [id]);
    expect(application!.stage).toBe("Offered");
    expect(application!.rejected_at).toBeTruthy();
  });

  it("above the requisition's budgeted band needs recruitment.hire, not just recruitment.manage", async () => {
    const { id } = await selectedApplication(6_000_000);
    const recruiter = await createPerson({ roles: ["RECRUITER"] });
    actAs(recruiter.session);
    const blocked = await makeOffer({}, form({ id, annualCtc: "2000000", structureCode: "STANDARD", joiningDate: day(10), expiryDate: day(20) }));
    expect(blocked.error).toMatch(/band/);
    actAs(null);
    const allowed = await makeOffer({}, form({ id, annualCtc: "2000000", structureCode: "STANDARD", joiningDate: day(10), expiryDate: day(20) }));
    expect(allowed.ok).toBe(true);
  });
});

describe("referrals", () => {
  async function hiredViaReferral(opts: { qualifyingDays: number; hireDaysAgo: number; terminated?: boolean }) {
    const referrer = await createBareEmployee("RF");
    const employeeId = await createBareEmployee("RH");
    if (opts.terminated) {
      await rawClient().execute({ sql: "UPDATE pa_employee SET employment_status = 'Terminated' WHERE id = ?", args: [employeeId] });
    }
    const candidate = await rawClient().execute({
      sql: "INSERT INTO rc_candidate (code, full_name, email, source, created_at) VALUES (?, 'Referred Candidate', ?, 'Referral', ?) RETURNING id",
      args: [`CANDX${uid()}`, `ref.${uid().toLowerCase()}@example.com`, new Date().toISOString()],
    });
    const candidateId = Number(candidate.rows[0].id);
    const vacant = await vacantPosition();
    const req = await rawClient().execute({
      sql: `INSERT INTO rc_requisition (code, position_code, org_unit_code, job_code, openings, posted_date, status, created_at)
            SELECT ?, code, org_unit_code, job_code, 1, ?, 'Closed', ? FROM om_position WHERE code = ? RETURNING id`,
      args: [`REQX${uid()}`, day(-100), new Date().toISOString(), vacant],
    });
    const requisitionId = Number(req.rows[0].id);
    const application = await rawClient().execute({
      sql: "INSERT INTO rc_application (candidate_id, requisition_id, stage, applied_date, channel) VALUES (?, ?, 'Hired', ?, 'Added by HR') RETURNING id",
      args: [candidateId, requisitionId, day(-100)],
    });
    const applicationId = Number(application.rows[0].id);
    const hireDate = day(-opts.hireDaysAgo);
    await rawClient().execute({
      sql: "INSERT INTO rc_hire_conversion (application_id, employee_id, hire_date, offered_salary_paise, converted_by, converted_at) VALUES (?, ?, ?, 1000000, 'test', ?)",
      args: [applicationId, employeeId, hireDate, new Date().toISOString()],
    });
    const referral = await rawClient().execute({
      sql: "INSERT INTO rc_referral (referrer_employee_id, candidate_id, bonus_paise, qualifying_days, status, created_at) VALUES (?, ?, 500000, ?, 'Pending', ?) RETURNING id",
      args: [referrer, candidateId, opts.qualifyingDays, new Date().toISOString()],
    });
    return { referralId: Number(referral.rows[0].id), referrer, employeeId };
  }

  it("is paid once, after the qualifying period — and not again", async () => {
    const { referralId, referrer } = await hiredViaReferral({ qualifyingDays: 90, hireDaysAgo: 95 });
    const paid = await payQualifyingReferrals(todayInIndia());
    expect(paid).toBeGreaterThan(0);
    const after = await one("SELECT status, additional_payment_id FROM rc_referral WHERE id = ?", [referralId]);
    expect(after!.status).toBe("Paid");
    const payment = await one("SELECT employee_id, wage_type_code, amount_paise FROM py_it0015_additional_payment WHERE id = ?", [Number(after!.additional_payment_id)]);
    expect(payment).toMatchObject({ employee_id: referrer, wage_type_code: "REFERRAL", amount_paise: 500000 });

    await payQualifyingReferrals(todayInIndia());
    const count = await one("SELECT COUNT(*) AS n FROM py_it0015_additional_payment WHERE employee_id = ? AND wage_type_code = 'REFERRAL'", [referrer]);
    expect(Number(count!.n)).toBe(1);
  });

  it("is not paid before the qualifying period ends", async () => {
    const { referralId } = await hiredViaReferral({ qualifyingDays: 90, hireDaysAgo: 10 });
    await payQualifyingReferrals(todayInIndia());
    expect((await one("SELECT status FROM rc_referral WHERE id = ?", [referralId]))!.status).toBe("Pending");
  });

  it("is forfeited, not paid, when the hire did not stay", async () => {
    const { referralId } = await hiredViaReferral({ qualifyingDays: 30, hireDaysAgo: 40, terminated: true });
    await payQualifyingReferrals(todayInIndia());
    expect((await one("SELECT status, additional_payment_id FROM rc_referral WHERE id = ?", [referralId]))).toMatchObject({ status: "Forfeited", additional_payment_id: null });
  });
});

describe("referring someone", () => {
  it("lets any employee refer a candidate for an open role", async () => {
    const employee = await createPerson({ roles: ["EMPLOYEE"] });
    const r = await saveRequisition({}, form({ positionCode: await vacantPosition(), title: "Field engineer", description: "Repairs equipment on site for regional clients.", openings: 1, postedDate: day(0), status: "Open", isPublished: "on" }));
    const requisition = await one("SELECT id FROM rc_requisition WHERE code = ?", [r.code!]);

    actAs(employee.session);
    const email = `friend.${uid().toLowerCase()}@example.com`;
    const result = await referCandidate({}, form({ fullName: "A Friend", email, requisitionId: Number(requisition!.id) }));
    actAs(null);
    expect(result.ok).toBe(true);

    const candidate = await one("SELECT id FROM rc_candidate WHERE email = ?", [email]);
    const referral = await one("SELECT referrer_employee_id, status FROM rc_referral WHERE candidate_id = ?", [Number(candidate!.id)]);
    expect(referral).toMatchObject({ referrer_employee_id: employee.employeeId, status: "Pending" });
    const application = await one("SELECT id FROM rc_application WHERE candidate_id = ?", [Number(candidate!.id)]);
    expect(application).toBeTruthy();

    // Referred twice: refused, not a second referral.
    actAs(employee.session);
    const twice = await referCandidate({}, form({ fullName: "A Friend", email }));
    actAs(null);
    expect(twice.error).toMatch(/already been referred/);
  });
});

describe("duplicate detection", () => {
  it("catches the same person by phone as well as email", async () => {
    const phone = `+91 90000 ${Math.floor(Math.random() * 100000)}`;
    const first = `first.${uid().toLowerCase()}@example.com`;
    const second = `second.${uid().toLowerCase()}@example.com`;
    expect((await saveCandidate({}, form({ fullName: "Phone Match", email: first, phone, source: "Job portal" }))).ok).toBe(true);
    const dup = await saveCandidate({}, form({ fullName: "Phone Match Two", email: second, phone, source: "Job portal" }));
    expect(dup.error).toMatch(/already has that email address or phone number/);
  });
});

describe("recruitment analytics", () => {
  it("equal hand counts on the applications and offers created here", async () => {
    const before = await recruitmentAnalytics();
    const beforeAccepted = before.offersByStatus.find((b) => b.label === "Accepted")?.value ?? 0;
    const beforeDeclined = before.offersByStatus.find((b) => b.label === "Declined")?.value ?? 0;

    const accepted = await selectedApplication();
    await makeOffer({}, form({ id: accepted.id, annualCtc: "600000", structureCode: "STANDARD", joiningDate: day(10), expiryDate: day(20) }));
    const acceptedToken = String((await one("SELECT token FROM rc_offer WHERE application_id = ?", [accepted.id]))!.token);
    await respondToOffer({}, form({ token: acceptedToken, decision: "accept" }));

    const declined = await selectedApplication();
    await makeOffer({}, form({ id: declined.id, annualCtc: "600000", structureCode: "STANDARD", joiningDate: day(10), expiryDate: day(20) }));
    const declinedToken = String((await one("SELECT token FROM rc_offer WHERE application_id = ?", [declined.id]))!.token);
    await respondToOffer({}, form({ token: declinedToken, decision: "decline" }));

    const after = await recruitmentAnalytics();
    const afterAccepted = after.offersByStatus.find((b) => b.label === "Accepted")?.value ?? 0;
    const afterDeclined = after.offersByStatus.find((b) => b.label === "Declined")?.value ?? 0;
    expect(afterAccepted).toBe(beforeAccepted + 1);
    expect(afterDeclined).toBe(beforeDeclined + 1);
    // A decline keeps the stage it was offered at, same as any other rejection.
    const dropOff = after.dropOffByStage.find((b) => b.label === "Offered");
    expect(dropOff?.value ?? 0).toBeGreaterThan(0);
  });
});
