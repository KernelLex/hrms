import { eq } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import * as s from "../schema";

type Db = LibSQLDatabase<typeof s>;

/**
 * An open requisition against the vacant HR executive position, with three
 * candidates spread across the pipeline — one of them at the offer stage, so
 * hire conversion has something real to convert.
 */
export async function seedRecruitment(db: Db): Promise<string[]> {
  const notes: string[] = [];
  const createdAt = s.now();
  const today = new Date().toISOString().slice(0, 10);

  const vacant = await db.query.omPosition.findFirst({
    where: eq(s.omPosition.isVacant, true),
  });
  if (!vacant) {
    notes.push("  no vacant position, so no requisition seeded");
    return notes;
  }

  const existing = await db.query.rcRequisition.findFirst({
    where: eq(s.rcRequisition.code, "REQ0001"),
  });

  const requisitionId =
    existing?.id ??
    (
      await db
        .insert(s.rcRequisition)
        .values({
          code: "REQ0001",
          positionCode: vacant.code,
          orgUnitCode: vacant.orgUnitCode,
          jobCode: vacant.jobCode,
          openings: 1,
          priority: "High",
          postedDate: today,
          targetCloseDate: null,
          status: "Open",
          createdAt,
        })
        .returning({ id: s.rcRequisition.id })
    )[0].id;

  const candidates = [
    { code: "CAND0001", fullName: "Kavya Iyer", email: "kavya.iyer@example.com", phone: "+91 98765 43210", source: "LinkedIn", stage: "Offered" as const },
    { code: "CAND0002", fullName: "Rohan Verma", email: "rohan.verma@example.com", phone: "+91 98765 11111", source: "Referral", stage: "Interviewed" as const },
    { code: "CAND0003", fullName: "Meera Pillai", email: "meera.pillai@example.com", phone: "+91 98765 22222", source: "Job portal", stage: "Applied" as const },
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
        createdAt,
      })
      .onConflictDoNothing();

    const candidate = await db.query.rcCandidate.findFirst({
      where: eq(s.rcCandidate.code, c.code),
    });
    if (!candidate) continue;

    const app = await db.query.rcApplication.findFirst({
      where: eq(s.rcApplication.candidateId, candidate.id),
    });
    if (app) continue;

    const [created] = await db
      .insert(s.rcApplication)
      .values({
        candidateId: candidate.id,
        requisitionId,
        stage: c.stage,
        appliedDate: today,
        offeredSalaryPaise: c.stage === "Offered" ? 6_800_000 : null,
      })
      .returning({ id: s.rcApplication.id });

    await db.insert(s.rcApplicationStageHistory).values({
      applicationId: created.id,
      fromStage: null,
      toStage: c.stage,
      changedBy: "seed",
      changedAt: createdAt,
    });

    if (c.stage === "Interviewed" || c.stage === "Offered") {
      await db.insert(s.rcInterview).values({
        applicationId: created.id,
        round: "Technical round 1",
        interviewer: "Ravi Kumar",
        scheduledDate: today,
        scheduledTime: "14:30",
        mode: "Video call",
        rating: c.stage === "Offered" ? 4 : 3,
        feedback:
          c.stage === "Offered"
            ? "Strong on fundamentals, clear communicator."
            : "Solid, wants a second opinion on depth.",
        createdAt,
      });
    }
  }

  notes.push(`  1 open requisition against ${vacant.code}`);
  notes.push("  3 candidates — one applied, one interviewed, one offered");
  return notes;
}
