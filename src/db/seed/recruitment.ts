import { and, eq } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import * as s from "../schema";

type Db = LibSQLDatabase<typeof s>;

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

const DESCRIPTION = `You will be the first point of contact for our Bengaluru campus's people: joining formalities, employee records, leave and attendance questions, and the paperwork behind every hire and exit.

You will work closely with the HR administrator and the department managers, keep our records accurate in the HRMS, and help run the monthly payroll inputs and the yearly appraisal cycle.

This is a hands-on role for someone who likes order, is good with people, and wants to grow in HR operations.`;

/**
 * An open, published requisition for the vacant HR executive position, with
 * three candidates across the workflow: one who has just applied on the
 * careers page, one part-way through interview rounds with a round still to
 * come, and one approved and offered, ready for hire conversion.
 *
 * Idempotent, and it brings a database seeded before the workflow existed up
 * to date: the role gets its description, and the rounds their interviewers.
 */
export async function seedRecruitment(db: Db): Promise<string[]> {
  const notes: string[] = [];
  const createdAt = s.now();

  const vacant = await db.query.omPosition.findFirst({ where: eq(s.omPosition.code, "PS0004") });
  if (!vacant) {
    notes.push("  no PS0004 position, so no requisition seeded");
    return notes;
  }

  // Interviewers and the hiring manager are seeded people.
  const byNumber = async (n: string) => (await db.query.paEmployee.findFirst({ where: eq(s.paEmployee.employeeNumber, n) }))?.id ?? null;
  const ravi = await byNumber("EMP1000");
  const arjun = await byNumber("EMP1001");

  const role = {
    title: "HR executive",
    description: DESCRIPTION,
    qualifications: "A degree in any discipline; an MBA or PG diploma in HR is a plus\nWorking knowledge of Indian labour law and statutory compliance (PF, ESI, gratuity)",
    skills: "Clear written and spoken English, and Kannada or Hindi\nComfortable with spreadsheets and HR software\nDiscreet with confidential information",
    experienceMinYears: 2,
    experienceMaxYears: 5,
    employmentType: "Full-time",
    workMode: "On site",
    location: "Bengaluru campus",
    budgetMinPaise: 5_500_000,
    budgetMaxPaise: 7_500_000,
    hiringManagerEmployeeId: ravi,
    isPublished: true,
    updatedAt: createdAt,
  };

  const existing = await db.query.rcRequisition.findFirst({ where: eq(s.rcRequisition.code, "REQ0001") });
  let requisitionId: number;
  if (existing) {
    requisitionId = existing.id;
    if (!existing.description) {
      await db
        .update(s.rcRequisition)
        .set({ ...role, isPublished: existing.status === "Open" })
        .where(eq(s.rcRequisition.id, existing.id));
    }
  } else {
    const [created] = await db
      .insert(s.rcRequisition)
      .values({
        code: "REQ0001",
        positionCode: vacant.code,
        orgUnitCode: vacant.orgUnitCode,
        jobCode: vacant.jobCode,
        openings: 1,
        priority: "High",
        postedDate: day(-21),
        targetCloseDate: day(30),
        status: "Open",
        createdAt,
        ...role,
      })
      .returning({ id: s.rcRequisition.id });
    requisitionId = created.id;
  }

  type Round = {
    round: string;
    interviewerId: number | null;
    interviewer: string;
    date: string;
    time: string;
    done?: { rating: number; recommendation: "Advance" | "Hold" | "Reject"; feedback: string };
  };

  const candidates: {
    code: string;
    fullName: string;
    email: string;
    phone: string;
    source: string;
    employer: string;
    years: number;
    notice: number;
    stage: s.PipelineStage;
    applied: string;
    channel: "Careers page" | "Added by HR";
    coverNote: string | null;
    rounds: Round[];
    selected?: string;
    offeredPaise?: number;
  }[] = [
    {
      code: "CAND0001",
      fullName: "Kavya Iyer",
      email: "kavya.iyer@example.com",
      phone: "+91 98765 43210",
      source: "LinkedIn",
      employer: "Brigade Facilities",
      years: 4,
      notice: 30,
      stage: "Offered",
      applied: day(-18),
      channel: "Added by HR",
      coverNote: null,
      rounds: [
        {
          round: "Functional round",
          interviewerId: ravi,
          interviewer: "Ravi Kumar",
          date: day(-12),
          time: "11:00",
          done: { rating: 4, recommendation: "Advance", feedback: "Knows PF and ESI filings well and has run joining formalities for a 300-person site.\n\nClear and calm when walked through a difficult exit case." },
        },
        {
          round: "Culture round",
          interviewerId: arjun,
          interviewer: "Arjun Mehta",
          date: day(-8),
          time: "15:00",
          done: { rating: 5, recommendation: "Advance", feedback: "Warm, organised, asks good questions. Would work well with the plant managers." },
        },
      ],
      selected: "Both panels recommend; strongest on statutory compliance.",
      offeredPaise: 6_800_000,
    },
    {
      code: "CAND0002",
      fullName: "Rohan Verma",
      email: "rohan.verma@example.com",
      phone: "+91 98765 11111",
      source: "Referral",
      employer: "Tata Consultancy Services",
      years: 3,
      notice: 60,
      stage: "Interviewing",
      applied: day(-9),
      channel: "Added by HR",
      coverNote: null,
      rounds: [
        {
          round: "Functional round",
          interviewerId: ravi,
          interviewer: "Ravi Kumar",
          date: day(-3),
          time: "14:30",
          done: { rating: 3, recommendation: "Hold", feedback: "Solid on records and leave administration. Less exposure to statutory filings; worth a second opinion on depth." },
        },
        { round: "Culture round", interviewerId: arjun, interviewer: "Arjun Mehta", date: day(2), time: "11:30" },
      ],
    },
    {
      code: "CAND0003",
      fullName: "Meera Pillai",
      email: "meera.pillai@example.com",
      phone: "+91 98765 22222",
      source: "Careers page",
      employer: "Manipal Hospitals",
      years: 2,
      notice: 30,
      stage: "Applied",
      applied: day(-1),
      channel: "Careers page",
      coverNote: "I have spent two years in hospital HR, running onboarding for nursing staff across three shifts. I would like to move into a manufacturing setting, and the Bengaluru campus is close to home.",
      rounds: [],
    },
  ];

  for (const c of candidates) {
    await db
      .insert(s.rcCandidate)
      .values({
        code: c.code,
        fullName: c.fullName,
        email: c.email,
        phone: c.phone,
        source: c.source,
        resumeLink: null,
        currentEmployer: c.employer,
        experienceYears: c.years,
        noticePeriodDays: c.notice,
        createdAt,
      })
      .onConflictDoNothing();

    const candidate = await db.query.rcCandidate.findFirst({ where: eq(s.rcCandidate.code, c.code) });
    if (!candidate) continue;
    if (candidate.currentEmployer === null) {
      await db
        .update(s.rcCandidate)
        .set({ currentEmployer: c.employer, experienceYears: c.years, noticePeriodDays: c.notice, source: c.source })
        .where(eq(s.rcCandidate.id, candidate.id));
    }

    let app = await db.query.rcApplication.findFirst({
      where: and(eq(s.rcApplication.candidateId, candidate.id), eq(s.rcApplication.requisitionId, requisitionId)),
    });
    if (!app) {
      [app] = await db
        .insert(s.rcApplication)
        .values({
          candidateId: candidate.id,
          requisitionId,
          stage: c.stage,
          appliedDate: c.applied,
          channel: c.channel,
          coverNote: c.coverNote,
          selectedAt: c.selected ? `${day(-6)}T10:00:00.000Z` : null,
          selectedBy: c.selected ? "Priya Sharma" : null,
          selectionNote: c.selected ?? null,
          offeredSalaryPaise: c.offeredPaise ?? null,
          offeredAt: c.offeredPaise ? `${day(-5)}T10:00:00.000Z` : null,
        })
        .returning();

      const moves: [string | null, string, string][] = [[null, "Applied", c.applied]];
      if (c.stage !== "Applied") moves.push(["Applied", "Interviewing", c.applied]);
      if (c.selected) moves.push(["Interviewing", "Selected", day(-6)]);
      if (c.offeredPaise) moves.push(["Selected", "Offered", day(-5)]);
      await db.insert(s.rcApplicationStageHistory).values(
        moves.map(([from, to, on]) => ({
          applicationId: app!.id,
          fromStage: from,
          toStage: to,
          changedBy: from === null && c.channel === "Careers page" ? "Careers page" : "Priya Sharma",
          changedAt: `${on}T10:00:00.000Z`,
          note: to === "Selected" ? (c.selected ?? null) : null,
        })),
      );
    } else if (app.channel !== c.channel || app.coverNote !== c.coverNote) {
      await db.update(s.rcApplication).set({ channel: c.channel, coverNote: c.coverNote }).where(eq(s.rcApplication.id, app.id));
    }

    // Rounds: added where missing, and older ones given their interviewer.
    const have = await db.select().from(s.rcInterview).where(eq(s.rcInterview.applicationId, app.id));
    for (const r of c.rounds) {
      const found = have.find((h) => h.round === r.round) ?? (r === c.rounds[0] ? have[0] : undefined);
      if (found) {
        if (found.interviewerEmployeeId === null && r.interviewerId) {
          await db.update(s.rcInterview).set({ interviewerEmployeeId: r.interviewerId, round: r.round }).where(eq(s.rcInterview.id, found.id));
        }
        continue;
      }
      await db.insert(s.rcInterview).values({
        applicationId: app.id,
        round: r.round,
        interviewer: r.interviewer,
        interviewerEmployeeId: r.interviewerId,
        scheduledDate: r.date,
        scheduledTime: r.time,
        durationMinutes: 60,
        mode: r.done ? "On site" : "Video call",
        location: r.done ? "Room 3B, Bengaluru campus" : "https://meet.example.com/hr-exec-round-2",
        status: r.done ? "Completed" : "Scheduled",
        rating: r.done?.rating ?? null,
        recommendation: r.done?.recommendation ?? null,
        feedback: r.done?.feedback ?? null,
        completedAt: r.done ? `${r.date}T${r.time}:00.000Z` : null,
        completedBy: r.done ? r.interviewer : null,
        createdAt,
      });
    }
  }

  notes.push(`  1 open requisition against ${vacant.code}, published on the careers page`);
  notes.push("  3 candidates — one new from the careers page, one mid-interviews, one offered");
  return notes;
}
