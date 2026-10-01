import { eq } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import * as s from "../schema";

type Db = LibSQLDatabase<typeof s>;

/**
 * A course with a session someone is nominated and approved for, a
 * department budget it fits within, and a certification due to expire soon
 * — so the compliance report and the expiry reminder both have something to
 * show, without waiting for the daily job to find it over several runs.
 */
export async function seedTraining(db: Db): Promise<string[]> {
  const notes: string[] = [];
  const createdAt = s.now();
  const year = new Date().getUTCFullYear();

  await db
    .insert(s.ldCourse)
    .values({ code: "CLOUD-CERT", title: "Cloud practitioner certification", description: "A two-day course covering the fundamentals, with an exam at the end.", costPaise: 1_500_000, isActive: true })
    .onConflictDoNothing();

  let session = await db.query.ldSession.findFirst({ where: eq(s.ldSession.courseCode, "CLOUD-CERT") });
  if (!session) {
    const [created] = await db
      .insert(s.ldSession)
      .values({ courseCode: "CLOUD-CERT", startDate: `${year}-11-10`, endDate: `${year}-11-11`, capacity: 10, place: "Bengaluru campus", costPaise: 1_500_000, createdAt })
      .returning();
    session = created;
  }

  await db
    .insert(s.ldDepartmentBudget)
    .values({ orgUnitCode: "OU0002", year, allocatedPaise: 10_000_000 })
    .onConflictDoNothing();

  const arjun = await db.query.paEmployee.findFirst({ where: eq(s.paEmployee.employeeNumber, "EMP1001") });
  if (arjun) {
    const existing = await db.query.ldNomination.findFirst({ where: eq(s.ldNomination.sessionId, session.id) });
    if (!existing) {
      await db.insert(s.ldNomination).values({ sessionId: session.id, employeeId: arjun.id, status: "Approved", createdBy: "seed", createdAt, decidedBy: "seed", decidedAt: createdAt });
    }

    const certExists = await db.query.ldCertification.findFirst({ where: eq(s.ldCertification.employeeId, arjun.id) });
    if (!certExists) {
      const expiry = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10);
      await db.insert(s.ldCertification).values({ employeeId: arjun.id, name: "Security awareness training", issuer: "Internal", issuedDate: `${year - 1}-11-20`, expiryDate: expiry, createdAt });
    }
  }

  await db
    .insert(s.ldCertificationRequirement)
    .values({ jobCode: "JB0001", name: "Security awareness training" })
    .onConflictDoNothing();

  notes.push("  1 training course with a session, one nomination approved against a department budget");
  notes.push("  a certification due to expire soon, and one job's own certification requirement");
  return notes;
}
