import { eq, and } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import * as s from "../schema";

type Db = LibSQLDatabase<typeof s>;

/**
 * An active cycle with goals and appraisals part-way through, so calibration
 * and the increment screens have something to work on rather than starting
 * empty.
 */
export async function seedPerformance(db: Db): Promise<string[]> {
  const notes: string[] = [];
  const createdAt = s.now();
  const year = new Date().getUTCFullYear();

  await db
    .insert(s.pmAppraisalTemplate)
    .values([
      { code: "STANDARD", name: "Standard annual review", description: "Goals, self review, manager review.", isActive: true },
      { code: "PROBATION", name: "Probation review", description: "Shorter review at the end of probation.", isActive: true },
      { code: "SALES", name: "Sales incentive review", description: "Weighted towards quota attainment.", isActive: true },
    ])
    .onConflictDoNothing();

  const cycleName = `Annual appraisal FY${year - 1}-${String(year % 100).padStart(2, "0")}`;
  let cycle = await db.query.pmAppraisalCycle.findFirst({
    where: eq(s.pmAppraisalCycle.name, cycleName),
  });

  if (!cycle) {
    const [created] = await db
      .insert(s.pmAppraisalCycle)
      .values({
        name: cycleName,
        periodLabel: `FY${year - 1}-${String(year % 100).padStart(2, "0")} (Apr-Mar)`,
        startDate: `${year - 1}-04-01`,
        endDate: `${year}-03-31`,
        templateCode: "STANDARD",
        status: "Active",
        createdAt,
      })
      .returning();
    cycle = created;
  }

  const employees = await db
    .select()
    .from(s.paEmployee)
    .where(eq(s.paEmployee.employmentStatus, "Active"));

  const goalsByPerson = [
    { category: "Business goal", description: "Deliver the billing module on schedule", weight: 40 },
    { category: "Development goal", description: "Complete the cloud certification", weight: 30 },
    { category: "Behavioural competency", description: "Mentor one junior engineer", weight: 30 },
  ];

  for (const e of employees) {
    const existingGoal = await db.query.pmGoal.findFirst({
      where: and(eq(s.pmGoal.cycleId, cycle.id), eq(s.pmGoal.employeeId, e.id)),
    });
    if (!existingGoal) {
      await db.insert(s.pmGoal).values(
        goalsByPerson.map((g) => ({
          cycleId: cycle!.id,
          employeeId: e.id,
          category: g.category,
          description: g.description,
          weightagePercent: g.weight,
          targetDate: `${year}-03-31`,
          createdAt,
        })),
      );
    }

    await db
      .insert(s.pmAppraisal)
      .values({
        cycleId: cycle.id,
        employeeId: e.id,
        status: "Pending self review",
        updatedAt: createdAt,
      })
      .onConflictDoNothing();
  }

  // Ravi's appraisal is complete and calibrated, so PM-04 and PM-05 have data.
  const ravi = await db.query.paEmployee.findFirst({
    where: eq(s.paEmployee.employeeNumber, "EMP1000"),
  });
  if (ravi) {
    const appraisal = await db.query.pmAppraisal.findFirst({
      where: and(
        eq(s.pmAppraisal.cycleId, cycle.id),
        eq(s.pmAppraisal.employeeId, ravi.id),
      ),
    });
    if (appraisal && appraisal.status !== "Completed") {
      await db
        .update(s.pmAppraisal)
        .set({
          selfRating: 4,
          selfComments: "Shipped the platform migration and kept the team steady through it.",
          managerRating: 4,
          managerComments: "Consistently strong delivery, and a calm presence in a hard year.",
          status: "Completed",
          updatedAt: createdAt,
        })
        .where(eq(s.pmAppraisal.id, appraisal.id));

      await db
        .insert(s.pmCalibration)
        .values({
          appraisalId: appraisal.id,
          calibratedRating: 4,
          committeeComments: "Agreed, consistent with peers at this level.",
          status: "Finalised",
          finalisedBy: "seed",
          finalisedAt: createdAt,
        })
        .onConflictDoNothing();
    }
  }

  // Arjun's is waiting on his manager, so the ratings queue is not empty.
  const arjun = await db.query.paEmployee.findFirst({
    where: eq(s.paEmployee.employeeNumber, "EMP1001"),
  });
  if (arjun) {
    const appraisal = await db.query.pmAppraisal.findFirst({
      where: and(
        eq(s.pmAppraisal.cycleId, cycle.id),
        eq(s.pmAppraisal.employeeId, arjun.id),
      ),
    });
    if (appraisal && appraisal.status === "Pending self review") {
      await db
        .update(s.pmAppraisal)
        .set({
          selfRating: 4,
          selfComments: "Delivered module X early and picked up the on-call rota.",
          status: "Pending manager review",
          updatedAt: createdAt,
        })
        .where(eq(s.pmAppraisal.id, appraisal.id));
    }
  }

  notes.push("  3 appraisal templates, 1 active cycle");
  notes.push(`  ${employees.length * 3} goals and ${employees.length} appraisals`);
  notes.push("  1 finalised in calibration, 1 waiting on a manager");
  return notes;
}
