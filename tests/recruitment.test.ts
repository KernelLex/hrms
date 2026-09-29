import { randomUUID } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { rawClient } from "@/lib/db";
import { OPEN_ENDED } from "@/db/schema";
import { PERMISSION_DENIED } from "@/lib/access";
import {
  convertToEmployee,
  createApplication,
  deleteInterview,
  makeOffer,
  recordInterviewFeedback,
  rejectApplication,
  saveCandidate,
  saveRequisition,
  scheduleInterview,
  selectCandidate,
  setInterviewStatus,
  setRequisitionPublished,
  takeToInterview,
} from "@/app/actions/recruitment";
import { applyForJob } from "@/app/actions/careers";
import { getInterview, publishedRoles } from "@/lib/repositories/recruitment";
import { GET as documentRoute } from "@/app/api/documents/[id]/route";
import { form } from "./support/fixtures";
import { actAs, createPerson, type Person } from "./support/people";
import { apiClient, call } from "./support/api";

/**
 * The recruitment workflow, end to end: a requisition that describes the
 * role and is published; candidates applying on the public careers page;
 * screening; several interview rounds with different interviewers, times and
 * notes; the decision; the offer; and the hire.
 */

// Each careers-page applicant comes from an address of their own, unless a
// test says otherwise.
let address = "203.0.113.1";
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": address }),
  cookies: async () => ({ get: () => undefined }),
}));

const uid = () => randomUUID().slice(0, 6).toUpperCase();
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const DESCRIPTION = "You will run the payroll inputs for two plants, keep the records straight, and answer people's questions.";

async function vacantPosition(): Promise<string> {
  const code = `PR${uid()}`;
  await rawClient().execute({
    sql: `INSERT INTO om_position (code, title, org_unit_code, job_code, reports_to_code, is_manager, is_vacant, valid_from, valid_to, is_active)
          VALUES (?, 'Payroll analyst', 'OU0002', 'JB0001', 'PS0001', 0, 1, '2024-01-01', ?, 1)`,
    args: [code, OPEN_ENDED],
  });
  return code;
}

async function openRequisition(extra: Record<string, string> = {}): Promise<string> {
  const r = await saveRequisition(
    {},
    form({
      positionCode: await vacantPosition(),
      title: "Payroll analyst",
      description: DESCRIPTION,
      qualifications: "B.Com or equivalent",
      skills: "Excel\nIndian payroll",
      experienceMinYears: 2,
      experienceMaxYears: 5,
      employmentType: "Full-time",
      workMode: "Hybrid",
      location: "Bengaluru",
      budgetMin: 50000,
      budgetMax: 70000,
      openings: 1,
      priority: "High",
      postedDate: day(0),
      status: "Open",
      isPublished: "on",
      ...extra,
    }),
  );
  expect(r.error).toBeUndefined();
  return r.code!;
}

const pdf = (name = "resume.pdf") => new File([new TextEncoder().encode("%PDF-1.4\n% a resume\n%%EOF")], name, { type: "application/pdf" });

function applicationForm(code: string, email: string, extra: Record<string, string | File> = {}) {
  const f = form({ code, fullName: "Asha Nair", email, phone: "+91 98450 00000", experienceYears: 3, noticePeriodDays: 30, consent: "on", coverNote: "Hello." });
  f.set("resume", pdf());
  for (const [k, v] of Object.entries(extra)) f.set(k, v);
  return f;
}

async function one(sql: string, args: (string | number)[]) {
  return (await rawClient().execute({ sql, args })).rows[0] as unknown as Record<string, unknown> | undefined;
}

let interviewerA: Person;
let interviewerB: Person;

beforeAll(async () => {
  interviewerA = await createPerson({ roles: ["EMPLOYEE"] });
  interviewerB = await createPerson({ roles: ["EMPLOYEE"] });
});

afterEach(() => actAs(null));

describe("a requisition", () => {
  it("describes the role, and is on the careers page only when published", async () => {
    const code = await openRequisition();
    const listed = (await publishedRoles()).find((r) => r.code === code);
    expect(listed).toMatchObject({ title: "Payroll analyst", workMode: "Hybrid", experienceMinYears: 2, experienceMaxYears: 5, budgetMinPaise: 5_000_000 });

    expect((await setRequisitionPublished({}, form({ code, publish: "0" }))).ok).toBe(true);
    expect((await publishedRoles()).some((r) => r.code === code)).toBe(false);
  });

  it("needs a description candidates can read before it is published, and a vacant position", async () => {
    const short = await saveRequisition({}, form({ positionCode: await vacantPosition(), title: "X", description: "Too short.", openings: 1, postedDate: day(0), isPublished: "on" }));
    expect(short.error).toMatch(/description/);
    const filled = await saveRequisition({}, form({ positionCode: "PS0001", title: "IT manager", openings: 1, postedDate: day(0) }));
    expect(filled.error).toMatch(/filled/);
  });
});

describe("the careers page", () => {
  it("takes an application: the candidate, their resume, and word to recruiters and to them", async () => {
    const code = await openRequisition();
    const email = `asha.${uid().toLowerCase()}@example.com`;
    address = "203.0.113.10";
    expect(await applyForJob({}, applicationForm(code, email))).toEqual({ ok: true });

    const candidate = await one("SELECT * FROM rc_candidate WHERE email = ?", [email]);
    expect(candidate).toMatchObject({ full_name: "Asha Nair", source: "Careers page", experience_years: 3 });
    const application = await one("SELECT * FROM rc_application WHERE candidate_id = ?", [Number(candidate!.id)]);
    expect(application).toMatchObject({ stage: "Applied", channel: "Careers page", cover_note: "Hello." });
    const resume = await one("SELECT * FROM app_document WHERE owner_type = 'candidate' AND owner_id = ? AND kind = 'Resume'", [Number(candidate!.id)]);
    expect(resume?.content_type).toBe("application/pdf");

    const told = await one("SELECT COUNT(*) AS n FROM app_notification WHERE kind = 'application.received' AND link = ?", [`/recruitment/applications/${application!.id}`]);
    expect(Number(told!.n)).toBeGreaterThan(0);
    const ack = await one("SELECT recipient, subject FROM app_outbox WHERE dedupe_key = ?", [`careers.received:${application!.id}`]);
    expect(ack).toMatchObject({ recipient: email, subject: "We have your application for Payroll analyst" });
  });

  it("keeps one record per person, and one application per role", async () => {
    const [first, second] = [await openRequisition(), await openRequisition()];
    const email = `ravi.${uid().toLowerCase()}@example.com`;
    address = "203.0.113.11";
    expect((await applyForJob({}, applicationForm(first, email))).ok).toBe(true);
    expect((await applyForJob({}, applicationForm(first, email))).error).toMatch(/already applied/);
    expect((await applyForJob({}, applicationForm(second, email))).ok).toBe(true);
    const people = await one("SELECT COUNT(*) AS n FROM rc_candidate WHERE email = ?", [email]);
    expect(Number(people!.n)).toBe(1);
  });

  it("refuses what it cannot use, and leaves nothing half-made", async () => {
    const code = await openRequisition();
    const email = `noah.${uid().toLowerCase()}@example.com`;
    address = "203.0.113.12";
    expect((await applyForJob({}, applicationForm(code, email, { consent: "" }))).error).toMatch(/Agree/);
    const text = new File(["just text"], "resume.pdf", { type: "application/pdf" });
    expect((await applyForJob({}, applicationForm(code, email, { resume: text }))).error).toMatch(/PDF or Word/);
    expect(await one("SELECT id FROM rc_candidate WHERE email = ?", [email])).toBeUndefined();

    await setRequisitionPublished({}, form({ code, publish: "0" }));
    expect((await applyForJob({}, applicationForm(code, email))).error).toMatch(/no longer taking applications/);
  });

  it("gives a bot nothing, and slows a flood from one address", async () => {
    const code = await openRequisition();
    address = "203.0.113.13";
    const bot = `bot.${uid().toLowerCase()}@example.com`;
    expect(await applyForJob({}, applicationForm(code, bot, { website: "http://spam.example" }))).toEqual({ ok: true });
    expect(await one("SELECT id FROM rc_candidate WHERE email = ?", [bot])).toBeUndefined();

    address = "203.0.113.14";
    const results = [];
    for (let i = 0; i < 9; i++) results.push(await applyForJob({}, applicationForm(await openRequisition(), `flood${i}.${uid().toLowerCase()}@example.com`)));
    expect(results.slice(0, 8).every((r) => r.ok)).toBe(true);
    expect(results[8].error).toMatch(/try again tomorrow/);
  });
});

/** A candidate HR adds, applied to a fresh requisition. */
async function hrApplication(): Promise<{ id: number; requisition: string }> {
  const requisition = await openRequisition();
  const email = `cand.${uid().toLowerCase()}@example.com`;
  expect((await saveCandidate({}, form({ fullName: "Kiran Rao", email, source: "Referral" }))).ok).toBe(true);
  const candidate = await one("SELECT id FROM rc_candidate WHERE email = ?", [email]);
  const req = await one("SELECT id FROM rc_requisition WHERE code = ?", [requisition]);
  const created = await createApplication({}, form({ candidateId: Number(candidate!.id), requisitionId: Number(req!.id) }));
  return { id: created.id!, requisition };
}

const stageOf = async (id: number) => one("SELECT stage, rejected_at, rejected_reason, rejected_by FROM rc_application WHERE id = ?", [id]);

describe("screening", () => {
  it("rejects a profile, always with a reason", async () => {
    const { id } = await hrApplication();
    expect((await rejectApplication({}, form({ id }))).error).toMatch(/why/);
    expect((await rejectApplication({}, form({ id, reason: "Not enough payroll experience" }))).ok).toBe(true);
    expect(await stageOf(id)).toMatchObject({ stage: "Applied", rejected_reason: "Not enough payroll experience", rejected_by: "Priya Sharma" });
    expect((await takeToInterview({}, form({ id }))).error).toMatch(/rejected/);
  });

  it("takes a profile to interview, once", async () => {
    const { id } = await hrApplication();
    expect((await takeToInterview({}, form({ id }))).ok).toBe(true);
    expect((await stageOf(id))?.stage).toBe("Interviewing");
    expect((await takeToInterview({}, form({ id }))).error).toMatch(/already been screened/);
  });
});

describe("interview rounds", () => {
  const round = (id: number, who: Person, date: string, time: string, extra: Record<string, string | number> = {}) =>
    scheduleInterview({}, form({ applicationId: id, round: "Technical round", interviewerEmployeeId: who.employeeId, scheduledDate: date, scheduledTime: time, durationMinutes: 60, mode: "Video call", ...extra }));
  const notes = (interviewId: number, rating = 4, recommendation = "Advance") =>
    recordInterviewFeedback({}, form({ id: interviewId, rating, recommendation, feedback: "Clear on payroll cut-offs." }));

  it("run with different interviewers and times, each recording their own notes, until the candidate is approved and hired", async () => {
    const { id, requisition } = await hrApplication();
    expect((await round(id, interviewerA, day(1), "10:00")).error).toMatch(/interview first/);
    await takeToInterview({}, form({ id }));

    const first = await round(id, interviewerA, day(1), "10:00", { round: "Technical round 1" });
    const second = await round(id, interviewerB, day(2), "14:00", { round: "Hiring manager round", mode: "On site", location: "Room 3B" });
    expect(first.ok && second.ok).toBe(true);

    // Each interviewer is told.
    const told = await one("SELECT title, link FROM app_notification WHERE user_id = ? AND kind = 'interview.assigned' ORDER BY id DESC", [interviewerA.userId]);
    expect(told).toMatchObject({ title: "Interview with Kiran Rao: Technical round 1", link: `/recruitment/interviews/${first.id}` });

    // One interviewer, two rounds at once: refused.
    const other = await hrApplication();
    await takeToInterview({}, form({ id: other.id }));
    expect((await round(other.id, interviewerA, day(1), "10:30")).error).toMatch(/already has an interview at 10:00/);

    expect((await selectCandidate({}, form({ id }))).error).toMatch(/at least one/);

    // Notes are the interviewer's own to record.
    actAs(interviewerB.session);
    expect((await notes(first.id!)).error).toMatch(/not assigned to you/);
    actAs(interviewerA.session);
    expect((await notes(first.id!)).ok).toBe(true);
    actAs(null);

    expect((await selectCandidate({}, form({ id }))).error).toMatch(/still scheduled/);
    actAs(interviewerB.session);
    expect((await notes(second.id!, 5)).ok).toBe(true);
    actAs(null);

    const recorded = await getInterview(second.id!);
    expect(recorded).toMatchObject({ status: "Completed", rating: 5, recommendation: "Advance", location: "Room 3B", mode: "On site" });

    expect((await selectCandidate({}, form({ id, note: "Both recommend" }))).ok).toBe(true);
    expect((await stageOf(id))?.stage).toBe("Selected");
    actAs(interviewerA.session);
    expect((await notes(first.id!, 2)).error).toMatch(/decision/);
    actAs(null);

    expect((await makeOffer({}, form({ id }))).error).toMatch(/salary/);
    expect((await makeOffer({}, form({ id, offeredSalary: "72,000" }))).ok).toBe(true);
    const offered = await one("SELECT stage, offered_salary_paise FROM rc_application WHERE id = ?", [id]);
    expect(offered).toMatchObject({ stage: "Offered", offered_salary_paise: 7_200_000 });

    const hired = await convertToEmployee({}, form({ applicationId: id, hireDate: day(14), salary: 72000 }));
    expect(hired.employeeId).toBeGreaterThan(0);
    const closed = await one("SELECT status, is_published FROM rc_requisition WHERE code = ?", [requisition]);
    expect(closed).toMatchObject({ status: "Closed", is_published: 0 });

    // Converting a candidate starts onboarding, the same as hiring on the screen.
    const checklist = await one("SELECT * FROM pa_checklist WHERE employee_id = ?", [hired.employeeId!]);
    expect(checklist).toBeTruthy();
  });

  it("are refused to someone who neither runs recruitment nor interviews", async () => {
    const outsider = await createPerson({ roles: [] });
    actAs(outsider.session);
    await expect(recordInterviewFeedback({}, form({ id: 1 }))).rejects.toThrow(PERMISSION_DENIED);
  });

  it("can be cancelled or marked a no-show, but a round with notes stays on the record", async () => {
    const { id } = await hrApplication();
    await takeToInterview({}, form({ id }));
    const planned = await round(id, interviewerA, day(5), "09:00");
    expect((await setInterviewStatus({}, form({ id: planned.id!, status: "No-show" }))).ok).toBe(true);
    expect((await getInterview(planned.id!))?.status).toBe("No-show");
    expect((await notes(planned.id!)).error).toMatch(/no-show/);

    const held = await round(id, interviewerB, day(6), "09:00");
    actAs(interviewerB.session);
    await notes(held.id!);
    actAs(null);
    expect((await deleteInterview({}, form({ id: held.id! }))).error).toMatch(/stays on the record/);
    expect((await deleteInterview({}, form({ id: planned.id! }))).ok).toBe(true);
  });

  it("let an interviewer open their own candidate's resume, and no one else's", async () => {
    const code = await openRequisition();
    address = "203.0.113.20";
    const mine = `mine.${uid().toLowerCase()}@example.com`;
    const theirs = `theirs.${uid().toLowerCase()}@example.com`;
    await applyForJob({}, applicationForm(code, mine));
    await applyForJob({}, applicationForm(code, theirs));
    const app = await one("SELECT a.id, a.candidate_id FROM rc_application a JOIN rc_candidate c ON c.id = a.candidate_id WHERE c.email = ?", [mine]);
    await takeToInterview({}, form({ id: Number(app!.id) }));
    await round(Number(app!.id), interviewerB, day(9), "16:00");

    const resumeOf = async (email: string) =>
      Number((await one("SELECT d.id FROM app_document d JOIN rc_candidate c ON c.id = d.owner_id WHERE d.owner_type = 'candidate' AND c.email = ?", [email]))!.id);
    const open = (id: number) => documentRoute(new Request(`http://localhost/api/documents/${id}`), { params: Promise.resolve({ id: String(id) }) } as never);
    actAs(interviewerB.session);
    expect((await open(await resumeOf(mine))).status).toBe(200);
    expect((await open(await resumeOf(theirs))).status).toBe(404);
  });
});

describe("the API", () => {
  it("shows requisitions and applications with their rounds, never the notes, and pay only with pay:read", async () => {
    const plain = await apiClient(["recruitment:read"]);
    const withPay = await apiClient(["recruitment:read", "pay:read"]);
    const reqs = (await call("GET", "/requisitions?limit=200&published=true", { token: plain.token })).body as { data: Record<string, unknown>[] };
    expect(reqs.data.length).toBeGreaterThan(0);
    expect(reqs.data[0]).toHaveProperty("title");
    expect(reqs.data[0]).not.toHaveProperty("budget");
    const paid = (await call("GET", "/requisitions?limit=1", { token: withPay.token })).body as { data: Record<string, unknown>[] };
    expect(paid.data[0]).toHaveProperty("budget");

    const apps = (await call("GET", "/applications?limit=200&stage=Hired", { token: plain.token })).body as { data: Record<string, unknown>[] };
    const hired = apps.data.find((a) => (a.interviews as unknown[]).length > 0)!;
    expect(hired).toMatchObject({ outcome: "hired", stage: "Hired" });
    expect(hired.employee_id).toBeGreaterThan(0);
    expect(hired).not.toHaveProperty("offered_salary");
    expect(JSON.stringify(apps)).not.toContain("Clear on payroll cut-offs");
  });
});
