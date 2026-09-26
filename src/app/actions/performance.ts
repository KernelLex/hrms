"use server";

import { revalidatePath } from "next/cache";
import { and, eq, desc, gte, inArray, lte } from "drizzle-orm";
import { db } from "@/lib/db";
import { requireRole, requireSession, hasRole } from "@/lib/auth";
import {
  pmAppraisalCycle,
  pmGoal,
  pmAppraisal,
  pmCalibration,
  pmIncrementRecommendation,
  paBasicPay,
  paEmployee,
  now,
} from "@/db/schema";
import { saveTimeSlice, readAsOf, SLICED_TABLES } from "@/lib/engines/timeslice";
import { listDirectReports } from "@/lib/repositories/employees";
import { toPaise } from "@/lib/money";

export type ActionState = { error?: string; ok?: boolean };

const OK: ActionState = { ok: true };
const fail = (error: string): ActionState => ({ error });
const str = (v: FormDataEntryValue | null) => (typeof v === "string" ? v.trim() : "");
const opt = (v: FormDataEntryValue | null) => {
  const s = str(v);
  return s.length > 0 ? s : null;
};
const num = (v: FormDataEntryValue | null) => Number(str(v));

function revalidatePerformance() {
  revalidatePath("/performance", "layout");
  revalidatePath("/core-hr", "layout");
  revalidatePath("/");
}

function ratingOf(v: FormDataEntryValue | null): number | null {
  const n = num(v);
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
}

/* --------------------------------------------------------- PM-01 cycles */

export async function saveCycle(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  await requireRole("HR_ADMIN");
  const original = opt(form.get("originalCode"));
  const name = str(form.get("name"));
  const startDate = str(form.get("startDate"));
  const endDate = str(form.get("endDate"));

  if (!name) return fail("Enter a cycle name.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return fail("Enter a start date.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate)) return fail("Enter an end date.");
  if (endDate < startDate) return fail("The end date falls before the start date.");

  const values = {
    name,
    periodLabel: str(form.get("periodLabel")) || name,
    startDate,
    endDate,
    templateCode: str(form.get("templateCode")) || "STANDARD",
    status: str(form.get("status")) || "Draft",
  };

  if (original) {
    await db.update(pmAppraisalCycle).set(values).where(eq(pmAppraisalCycle.id, Number(original)));
  } else {
    await db.insert(pmAppraisalCycle).values({ ...values, createdAt: now() });
  }

  revalidatePerformance();
  return OK;
}

export async function deleteCycle(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  await requireRole("HR_ADMIN");
  const id = num(form.get("id"));

  const goals = await db.select({ id: pmGoal.id }).from(pmGoal).where(eq(pmGoal.cycleId, id));
  if (goals.length > 0) {
    return fail(
      `That cycle has ${goals.length} goal${goals.length === 1 ? "" : "s"} against it. Close it instead of deleting it.`,
    );
  }

  await db.delete(pmAppraisalCycle).where(eq(pmAppraisalCycle.id, id));
  revalidatePerformance();
  return OK;
}

/**
 * Opens a cycle and creates an appraisal for every active employee, so the
 * rating screens have rows rather than an empty list someone has to populate
 * by hand.
 */
export async function openCycle(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  await requireRole("HR_ADMIN");
  const id = num(form.get("id"));

  const cycle = await db.query.pmAppraisalCycle.findFirst({
    where: eq(pmAppraisalCycle.id, id),
  });
  if (!cycle) return fail("That cycle no longer exists.");
  if (cycle.status === "Closed") return fail("A closed cycle cannot be reopened.");

  const employees = await db
    .select({ id: paEmployee.id })
    .from(paEmployee)
    .where(eq(paEmployee.employmentStatus, "Active"));

  const updatedAt = now();
  if (employees.length > 0) {
    await db
      .insert(pmAppraisal)
      .values(
        employees.map((e) => ({
          cycleId: id,
          employeeId: e.id,
          status: "Pending self review",
          updatedAt,
        })),
      )
      .onConflictDoNothing();
  }

  await db
    .update(pmAppraisalCycle)
    .set({ status: "Active" })
    .where(eq(pmAppraisalCycle.id, id));

  revalidatePerformance();
  return OK;
}

/* ----------------------------------------------------------- PM-02 goals */

export async function saveGoal(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  await requireRole("HR_ADMIN", "MANAGER");
  const original = opt(form.get("originalCode"));
  const description = str(form.get("description"));
  const weightage = num(form.get("weightagePercent"));

  if (!description) return fail("Describe the goal.");
  if (!Number.isFinite(weightage) || weightage < 0 || weightage > 100) {
    return fail("Weightage is a percentage between 0 and 100.");
  }

  const values = {
    cycleId: num(form.get("cycleId")),
    employeeId: num(form.get("employeeId")),
    category: str(form.get("category")) || "Business goal",
    description,
    weightagePercent: weightage,
    targetDate: opt(form.get("targetDate")),
  };
  if (!values.cycleId || !values.employeeId) {
    return fail("Choose a cycle and an employee.");
  }

  // Weightings across one employee's goals should not exceed 100.
  const siblings = await db
    .select({ id: pmGoal.id, weight: pmGoal.weightagePercent })
    .from(pmGoal)
    .where(and(eq(pmGoal.cycleId, values.cycleId), eq(pmGoal.employeeId, values.employeeId)));
  const others = siblings
    .filter((g) => (original ? g.id !== Number(original) : true))
    .reduce((s, g) => s + g.weight, 0);
  if (others + weightage > 100) {
    return fail(
      `Their goals already total ${others}%. This one would take it to ${others + weightage}%.`,
    );
  }

  if (original) {
    await db.update(pmGoal).set(values).where(eq(pmGoal.id, Number(original)));
  } else {
    await db.insert(pmGoal).values({ ...values, createdAt: now() });
  }

  revalidatePerformance();
  return OK;
}

export async function deleteGoal(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  await requireRole("HR_ADMIN", "MANAGER");
  await db.delete(pmGoal).where(eq(pmGoal.id, num(form.get("id"))));
  revalidatePerformance();
  return OK;
}

/* --------------------------------------------------------- PM-03 ratings */

/** An employee rating themselves. */
export async function saveSelfRating(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireSession();
  const id = num(form.get("id"));

  const appraisal = await db.query.pmAppraisal.findFirst({
    where: eq(pmAppraisal.id, id),
  });
  if (!appraisal) return fail("That appraisal no longer exists.");
  if (session.employeeId !== appraisal.employeeId) {
    return fail("You can only complete your own self review.");
  }
  if (appraisal.status === "Completed") {
    return fail("That appraisal is already complete.");
  }

  const rating = ratingOf(form.get("selfRating"));
  if (!rating) return fail("Choose a rating between 1 and 5.");

  await db
    .update(pmAppraisal)
    .set({
      selfRating: rating,
      selfComments: opt(form.get("selfComments")),
      status: "Pending manager review",
      updatedAt: now(),
    })
    .where(eq(pmAppraisal.id, id));

  revalidatePerformance();
  return OK;
}

/** A manager rating one of their reports. */
export async function saveManagerRating(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireSession();
  if (!hasRole(session, "HR_ADMIN", "MANAGER")) {
    return fail("Only a manager or HR can record a manager rating.");
  }

  const id = num(form.get("id"));
  const appraisal = await db.query.pmAppraisal.findFirst({
    where: eq(pmAppraisal.id, id),
  });
  if (!appraisal) return fail("That appraisal no longer exists.");

  // A manager may only rate their own reports; HR may rate anyone.
  if (!hasRole(session, "HR_ADMIN")) {
    const reports = session.employeeId
      ? await listDirectReports(session.employeeId)
      : [];
    if (!reports.some((r) => r.id === appraisal.employeeId)) {
      return fail("That employee does not report to you.");
    }
  }

  if (appraisal.status === "Pending self review") {
    return fail("Wait for the self review before recording a manager rating.");
  }

  const rating = ratingOf(form.get("managerRating"));
  if (!rating) return fail("Choose a rating between 1 and 5.");

  await db
    .update(pmAppraisal)
    .set({
      managerRating: rating,
      managerComments: opt(form.get("managerComments")),
      status: "Completed",
      updatedAt: now(),
    })
    .where(eq(pmAppraisal.id, id));

  // A completed appraisal enters calibration.
  await db
    .insert(pmCalibration)
    .values({
      appraisalId: id,
      calibratedRating: rating,
      status: "In review",
    })
    .onConflictDoNothing();

  revalidatePerformance();
  return OK;
}

/* ----------------------------------------------------- PM-04 calibration */

export async function saveCalibration(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireRole("HR_ADMIN");
  const appraisalId = num(form.get("appraisalId"));

  const appraisal = await db.query.pmAppraisal.findFirst({
    where: eq(pmAppraisal.id, appraisalId),
  });
  if (!appraisal) return fail("That appraisal no longer exists.");
  if (appraisal.status !== "Completed") {
    return fail("Both ratings must be in before calibration.");
  }

  const rating = ratingOf(form.get("calibratedRating"));
  if (!rating) return fail("Choose a calibrated rating between 1 and 5.");

  const finalise = str(form.get("finalise")) === "1";
  const values = {
    calibratedRating: rating,
    committeeComments: opt(form.get("committeeComments")),
    status: finalise ? "Finalised" : "In review",
    finalisedBy: finalise ? session.username : null,
    finalisedAt: finalise ? now() : null,
  };

  const existing = await db.query.pmCalibration.findFirst({
    where: eq(pmCalibration.appraisalId, appraisalId),
  });
  if (existing) {
    if (existing.status === "Finalised" && !finalise) {
      return fail("A finalised rating cannot be moved back to review.");
    }
    await db.update(pmCalibration).set(values).where(eq(pmCalibration.id, existing.id));
  } else {
    await db.insert(pmCalibration).values({ appraisalId, ...values });
  }

  revalidatePerformance();
  return OK;
}

/* ------------------------------------------------------ PM-05 increments */

/** The default increment each rating earns, in basis points. */
const DEFAULT_INCREMENT: Record<number, number> = {
  1: 0,
  2: 300,
  3: 600,
  4: 900,
  5: 1200,
};

/**
 * Builds a draft increment for every finalised appraisal in a cycle.
 *
 * The current salary is read as of the effective date through the time-slice
 * engine, so the recommendation is based on what the employee will actually be
 * earning then, not on whatever is current today.
 */
export async function generateIncrements(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  await requireRole("HR_ADMIN");
  const cycleId = num(form.get("cycleId"));
  const effectiveDate = str(form.get("effectiveDate"));

  if (!cycleId) return fail("Choose a cycle.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) return fail("Enter an effective date.");

  const finalised = await db
    .select({
      appraisalId: pmAppraisal.id,
      employeeId: pmAppraisal.employeeId,
      calibrated: pmCalibration.calibratedRating,
      status: pmCalibration.status,
    })
    .from(pmAppraisal)
    .innerJoin(pmCalibration, eq(pmCalibration.appraisalId, pmAppraisal.id))
    .where(and(eq(pmAppraisal.cycleId, cycleId), eq(pmCalibration.status, "Finalised")));

  if (finalised.length === 0) {
    return fail("No appraisals in that cycle have been finalised yet.");
  }

  const createdAt = now();
  let created = 0;

  // What already exists for the cycle, and everyone's pay on the effective
  // date, read once each rather than once per person.
  const employeeIds = finalised.map((f) => f.employeeId);
  const [existingRecs, payRows] = await Promise.all([
    db
      .select()
      .from(pmIncrementRecommendation)
      .where(eq(pmIncrementRecommendation.cycleId, cycleId)),
    db
      .select({ employeeId: paBasicPay.employeeId, amount: paBasicPay.amountPaise })
      .from(paBasicPay)
      .where(
        and(
          inArray(paBasicPay.employeeId, employeeIds),
          lte(paBasicPay.validFrom, effectiveDate),
          gte(paBasicPay.validTo, effectiveDate),
        ),
      ),
  ]);
  const existingOf = new Map(existingRecs.map((r) => [r.employeeId, r]));
  const payOf = new Map(payRows.map((p) => [p.employeeId, p.amount]));

  for (const f of finalised) {
    if (!f.calibrated) continue;

    const existing = existingOf.get(f.employeeId);
    // Never overwrite something already approved or pushed.
    if (existing && existing.status !== "Draft") continue;

    const pay = payOf.get(f.employeeId);
    if (pay === undefined) continue;

    const current = Number(pay);
    const bps = DEFAULT_INCREMENT[f.calibrated] ?? 0;
    const newSalary = current + Math.round((current * bps) / 10_000);

    const values = {
      cycleId,
      employeeId: f.employeeId,
      finalRating: f.calibrated,
      currentSalaryPaise: current,
      incrementBasisPoints: bps,
      newSalaryPaise: newSalary,
      effectiveDate,
      status: "Draft",
    };

    if (existing) {
      await db
        .update(pmIncrementRecommendation)
        .set(values)
        .where(eq(pmIncrementRecommendation.id, existing.id));
    } else {
      await db.insert(pmIncrementRecommendation).values({ ...values, createdAt });
    }
    created += 1;
  }

  revalidatePerformance();
  if (created === 0) {
    return fail("Nothing to generate — those employees have no basic pay on that date.");
  }
  return OK;
}

export async function updateIncrement(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  await requireRole("HR_ADMIN");
  const id = num(form.get("id"));
  const percent = Number(str(form.get("incrementPercent")));

  if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
    return fail("An increment is a percentage between 0 and 100.");
  }

  const rec = await db.query.pmIncrementRecommendation.findFirst({
    where: eq(pmIncrementRecommendation.id, id),
  });
  if (!rec) return fail("That recommendation no longer exists.");
  if (rec.status === "Pushed") {
    return fail("That increment has already been written to basic pay.");
  }

  const bps = Math.round(percent * 100);
  await db
    .update(pmIncrementRecommendation)
    .set({
      incrementBasisPoints: bps,
      newSalaryPaise:
        rec.currentSalaryPaise + Math.round((rec.currentSalaryPaise * bps) / 10_000),
      effectiveDate: str(form.get("effectiveDate")) || rec.effectiveDate,
    })
    .where(eq(pmIncrementRecommendation.id, id));

  revalidatePerformance();
  return OK;
}

export async function approveIncrement(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireRole("HR_ADMIN");
  const id = num(form.get("id"));

  const rec = await db.query.pmIncrementRecommendation.findFirst({
    where: eq(pmIncrementRecommendation.id, id),
  });
  if (!rec) return fail("That recommendation no longer exists.");
  if (rec.status !== "Draft") return fail("That increment is not a draft.");

  await db
    .update(pmIncrementRecommendation)
    .set({ status: "Approved", approvedBy: session.username, approvedAt: now() })
    .where(eq(pmIncrementRecommendation.id, id));

  revalidatePerformance();
  return OK;
}

/**
 * The second cross-module transaction: an approved increment becomes a new
 * basic-pay record.
 *
 * It goes through the time-slice engine rather than updating the salary in
 * place, so the old figure is delimited rather than destroyed — the employee's
 * pay history stays truthful, and the next payroll run picks the new one up
 * because it reads whatever is valid in the period.
 */
export async function pushIncrementsToPayroll(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireRole("HR_ADMIN");
  const cycleId = num(form.get("cycleId"));

  const approved = await db
    .select()
    .from(pmIncrementRecommendation)
    .where(
      and(
        eq(pmIncrementRecommendation.cycleId, cycleId),
        eq(pmIncrementRecommendation.status, "Approved"),
      ),
    );

  if (approved.length === 0) {
    return fail("No approved increments are waiting in that cycle.");
  }

  const cycle = await db.query.pmAppraisalCycle.findFirst({
    where: eq(pmAppraisalCycle.id, cycleId),
  });

  let pushed = 0;
  for (const rec of approved) {
    const current = await readAsOf<Record<string, string | number | null>>(
      SLICED_TABLES.basicPay,
      rec.employeeId,
      rec.effectiveDate,
    );

    await saveTimeSlice({
      table: SLICED_TABLES.basicPay,
      employeeId: rec.employeeId,
      validFrom: rec.effectiveDate,
      data: {
        pay_scale_type: (current?.pay_scale_type as string) ?? "Monthly salaried",
        pay_scale_area: (current?.pay_scale_area as string) ?? null,
        pay_scale_group: (current?.pay_scale_group as string) ?? null,
        amount_paise: rec.newSalaryPaise,
        currency: (current?.currency as string) ?? "INR",
        source_ref: cycle ? `Increment — ${cycle.name}` : "Performance increment",
      },
      createdBy: session.username,
    });

    // Record which basic-pay row this produced, for traceability.
    const written = await db.query.paBasicPay.findFirst({
      where: and(
        eq(paBasicPay.employeeId, rec.employeeId),
        eq(paBasicPay.validFrom, rec.effectiveDate),
      ),
      orderBy: [desc(paBasicPay.id)],
    });

    await db
      .update(pmIncrementRecommendation)
      .set({ status: "Pushed", pushedAt: now(), basicPayId: written?.id ?? null })
      .where(eq(pmIncrementRecommendation.id, rec.id));

    pushed += 1;
  }

  revalidatePerformance();
  if (pushed === 0) return fail("Nothing could be pushed.");
  return OK;
}

/** Converts rupees typed by a user into the stored paise figure. */
export async function setIncrementSalary(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  await requireRole("HR_ADMIN");
  const id = num(form.get("id"));
  const amount = Number(str(form.get("newSalary")));
  if (!Number.isFinite(amount) || amount <= 0) return fail("Enter a salary above zero.");

  const rec = await db.query.pmIncrementRecommendation.findFirst({
    where: eq(pmIncrementRecommendation.id, id),
  });
  if (!rec) return fail("That recommendation no longer exists.");
  if (rec.status === "Pushed") return fail("That increment has already been written.");

  const newSalary = toPaise(amount);
  const bps =
    rec.currentSalaryPaise > 0
      ? Math.round(((newSalary - rec.currentSalaryPaise) / rec.currentSalaryPaise) * 10_000)
      : 0;

  await db
    .update(pmIncrementRecommendation)
    .set({ newSalaryPaise: newSalary, incrementBasisPoints: bps })
    .where(eq(pmIncrementRecommendation.id, id));

  revalidatePerformance();
  return OK;
}
