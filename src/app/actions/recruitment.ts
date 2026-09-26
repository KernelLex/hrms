"use server";

import { revalidatePath } from "next/cache";
import { and, eq, desc } from "drizzle-orm";
import { z } from "zod";
import { db, rawClient } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import {
  rcRequisition,
  rcCandidate,
  rcApplication,
  rcApplicationStageHistory,
  rcInterview,
  omPosition,
  paEmployee,
  PIPELINE_STAGES,
  OPEN_ENDED,
  now,
} from "@/db/schema";
import { toPaise } from "@/lib/money";
import {
  storeDocument,
  deleteDocument,
  UploadError,
  type StoredDocument,
} from "@/lib/storage";
import { appDocument } from "@/db/schema";
import { todayInIndia } from "@/lib/dates";

export type ActionState = { error?: string; ok?: boolean; employeeId?: number };

const OK: ActionState = { ok: true };
const fail = (error: string): ActionState => ({ error });
const firstIssue = (e: z.ZodError) =>
  e.issues[0]?.message ?? "Check the form and try again.";

const str = (v: FormDataEntryValue | null) => (typeof v === "string" ? v.trim() : "");
const opt = (v: FormDataEntryValue | null) => {
  const s = str(v);
  return s.length > 0 ? s : null;
};
const num = (v: FormDataEntryValue | null) => Number(str(v));

function revalidateRecruitment() {
  revalidatePath("/recruitment", "layout");
  revalidatePath("/core-hr", "layout");
  revalidatePath("/org", "layout");
  revalidatePath("/");
}

/* ----------------------------------------------------- RC-01 requisitions */

export async function saveRequisition(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  await requireRole("HR_ADMIN");
  const original = opt(form.get("originalCode"));
  const positionCode = str(form.get("positionCode"));
  const openings = num(form.get("openings"));

  if (!positionCode) return fail("Choose a position.");
  if (!Number.isInteger(openings) || openings < 1) return fail("Enter at least one opening.");

  const position = await db.query.omPosition.findFirst({
    where: eq(omPosition.code, positionCode),
  });
  if (!position) return fail("That position no longer exists.");

  const postedDate = str(form.get("postedDate"));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(postedDate)) return fail("Enter a posted date.");

  const values = {
    positionCode,
    orgUnitCode: position.orgUnitCode,
    jobCode: position.jobCode,
    openings,
    priority: str(form.get("priority")) || "Medium",
    postedDate,
    targetCloseDate: opt(form.get("targetCloseDate")),
    status: str(form.get("status")) || "Open",
  };

  if (original) {
    await db
      .update(rcRequisition)
      .set(values)
      .where(eq(rcRequisition.code, original));
  } else {
    const [last] = await db
      .select({ code: rcRequisition.code })
      .from(rcRequisition)
      .orderBy(desc(rcRequisition.id))
      .limit(1);
    const next = last ? Number(last.code.replace(/\D/g, "")) + 1 : 1;
    await db.insert(rcRequisition).values({
      ...values,
      code: `REQ${String(next).padStart(4, "0")}`,
      createdAt: now(),
    });
  }

  revalidateRecruitment();
  return OK;
}

export async function deleteRequisition(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  await requireRole("HR_ADMIN");
  const code = str(form.get("code"));

  const req = await db.query.rcRequisition.findFirst({
    where: eq(rcRequisition.code, code),
  });
  if (!req) return fail("That requisition no longer exists.");

  const applications = await db
    .select({ id: rcApplication.id })
    .from(rcApplication)
    .where(eq(rcApplication.requisitionId, req.id));
  if (applications.length > 0) {
    return fail(
      `${code} has ${applications.length} application${applications.length === 1 ? "" : "s"}. Close it instead of deleting it.`,
    );
  }

  await db.delete(rcRequisition).where(eq(rcRequisition.id, req.id));
  revalidateRecruitment();
  return OK;
}

/* -------------------------------------------------------- RC-02 candidates */

const CandidateInput = z.object({
  fullName: z.string().min(1, "Enter the candidate's name."),
  email: z.email("Enter a valid email address."),
  phone: z.string().nullable(),
  source: z.string().min(1),
  // Rendered as a link, so only web addresses: a javascript: URL would run
  // in HR's browser when they clicked it.
  resumeLink: z
    .string()
    .regex(/^https?:\/\/\S+$/i, "A resume link must start with http:// or https://.")
    .nullable(),
});

export async function saveCandidate(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireRole("HR_ADMIN");
  const original = opt(form.get("originalCode"));

  const parsed = CandidateInput.safeParse({
    fullName: str(form.get("fullName")),
    email: str(form.get("email")),
    phone: opt(form.get("phone")),
    source: str(form.get("source")) || "Job portal",
    resumeLink: opt(form.get("resumeLink")),
  });
  if (!parsed.success) return fail(firstIssue(parsed.error));

  if (original) {
    await db
      .update(rcCandidate)
      .set(parsed.data)
      .where(eq(rcCandidate.code, original));
  } else {
    const [last] = await db
      .select({ code: rcCandidate.code })
      .from(rcCandidate)
      .orderBy(desc(rcCandidate.id))
      .limit(1);
    const next = last ? Number(last.code.replace(/\D/g, "")) + 1 : 1;
    const [candidate] = await db
      .insert(rcCandidate)
      .values({
        ...parsed.data,
        code: `CAND${String(next).padStart(4, "0")}`,
        createdAt: now(),
      })
      .returning({ id: rcCandidate.id });

    // Applying is optional, but it is the usual next step.
    const requisitionId = num(form.get("requisitionId"));
    if (requisitionId) {
      await createApplicationFor(candidate.id, requisitionId, session.username);
    }
  }

  revalidateRecruitment();
  return OK;
}

export async function deleteCandidate(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  await requireRole("HR_ADMIN");
  const code = str(form.get("code"));
  const candidate = await db.query.rcCandidate.findFirst({
    where: eq(rcCandidate.code, code),
  });
  if (!candidate) return fail("That candidate no longer exists.");

  const hired = await db
    .select({ id: rcApplication.id })
    .from(rcApplication)
    .where(and(eq(rcApplication.candidateId, candidate.id), eq(rcApplication.stage, "Hired")));
  if (hired.length > 0) {
    return fail("That candidate was hired, so their record is kept for the audit trail.");
  }

  // Documents have no foreign key to their owner, so they go explicitly.
  const documents = await db
    .select()
    .from(appDocument)
    .where(and(eq(appDocument.ownerType, "candidate"), eq(appDocument.ownerId, candidate.id)));
  for (const d of documents) await deleteDocument(d);

  await db.delete(rcCandidate).where(eq(rcCandidate.id, candidate.id));
  revalidateRecruitment();
  return OK;
}

/**
 * Stores a candidate's resume, replacing any earlier one. The new file is
 * saved before the old one is removed, so a failed upload loses nothing.
 */
export async function uploadResume(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireRole("HR_ADMIN");
  const candidateId = num(form.get("candidateId"));
  const candidate = await db.query.rcCandidate.findFirst({
    where: eq(rcCandidate.id, candidateId),
  });
  if (!candidate) return fail("That candidate no longer exists.");

  const file = form.get("file");
  if (!(file instanceof File)) return fail("Choose a file to upload.");

  const earlier = await db
    .select()
    .from(appDocument)
    .where(
      and(
        eq(appDocument.ownerType, "candidate"),
        eq(appDocument.ownerId, candidateId),
        eq(appDocument.kind, "Resume"),
      ),
    );

  let stored: StoredDocument;
  try {
    stored = await storeDocument({
      ownerType: "candidate",
      ownerId: candidateId,
      kind: "Resume",
      file,
      uploadedBy: session.username,
    });
  } catch (err) {
    if (err instanceof UploadError) return fail(err.message);
    throw err;
  }
  for (const d of earlier) if (d.id !== stored.id) await deleteDocument(d);

  revalidateRecruitment();
  return OK;
}

export async function removeResume(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  await requireRole("HR_ADMIN");
  const doc = await db.query.appDocument.findFirst({
    where: and(eq(appDocument.id, num(form.get("documentId"))), eq(appDocument.ownerType, "candidate")),
  });
  if (!doc) return fail("That file has already been removed.");
  await deleteDocument(doc);
  revalidateRecruitment();
  return OK;
}

/* ---------------------------------------------------------- applications */

async function createApplicationFor(
  candidateId: number,
  requisitionId: number,
  by: string,
): Promise<void> {
  const existing = await db.query.rcApplication.findFirst({
    where: and(
      eq(rcApplication.candidateId, candidateId),
      eq(rcApplication.requisitionId, requisitionId),
    ),
  });
  if (existing) return;

  const today = todayInIndia();
  const [application] = await db
    .insert(rcApplication)
    .values({
      candidateId,
      requisitionId,
      stage: "Applied",
      appliedDate: today,
    })
    .returning({ id: rcApplication.id });

  await db.insert(rcApplicationStageHistory).values({
    applicationId: application.id,
    fromStage: null,
    toStage: "Applied",
    changedBy: by,
    changedAt: now(),
  });
}

export async function createApplication(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireRole("HR_ADMIN");
  const candidateId = num(form.get("candidateId"));
  const requisitionId = num(form.get("requisitionId"));
  if (!candidateId || !requisitionId) return fail("Choose a candidate and a requisition.");

  const existing = await db.query.rcApplication.findFirst({
    where: and(
      eq(rcApplication.candidateId, candidateId),
      eq(rcApplication.requisitionId, requisitionId),
    ),
  });
  if (existing) return fail("That candidate has already applied to this requisition.");

  await createApplicationFor(candidateId, requisitionId, session.username);
  revalidateRecruitment();
  return OK;
}

/**
 * RC-03 — move an application along the pipeline.
 *
 * Stages only advance one step at a time, and the move is recorded, so the
 * pipeline is a history rather than a single mutable field.
 */
export async function advanceApplication(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireRole("HR_ADMIN");
  const id = num(form.get("id"));

  const application = await db.query.rcApplication.findFirst({
    where: eq(rcApplication.id, id),
  });
  if (!application) return fail("That application no longer exists.");
  if (application.rejectedAt) return fail("That application was rejected.");

  const index = PIPELINE_STAGES.indexOf(application.stage as (typeof PIPELINE_STAGES)[number]);
  if (index < 0) return fail("That application is in an unknown stage.");
  if (application.stage === "Offered") {
    return fail("Use hire conversion to move an offered candidate to hired.");
  }
  if (index >= PIPELINE_STAGES.length - 1) {
    return fail("That application is already at the final stage.");
  }

  const next = PIPELINE_STAGES[index + 1];
  const offered = str(form.get("offeredSalary"));

  await db
    .update(rcApplication)
    .set({
      stage: next,
      offeredSalaryPaise:
        next === "Offered" && offered ? toPaise(offered) : application.offeredSalaryPaise,
    })
    .where(eq(rcApplication.id, id));

  await db.insert(rcApplicationStageHistory).values({
    applicationId: id,
    fromStage: application.stage,
    toStage: next,
    changedBy: session.username,
    changedAt: now(),
    note: opt(form.get("note")),
  });

  revalidateRecruitment();
  return OK;
}

export async function rejectApplication(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireRole("HR_ADMIN");
  const id = num(form.get("id"));

  const application = await db.query.rcApplication.findFirst({
    where: eq(rcApplication.id, id),
  });
  if (!application) return fail("That application no longer exists.");
  if (application.stage === "Hired") {
    return fail("A hired candidate cannot be rejected.");
  }

  await db
    .update(rcApplication)
    .set({
      rejectedReason: opt(form.get("reason")),
      rejectedAt: now(),
    })
    .where(eq(rcApplication.id, id));

  await db.insert(rcApplicationStageHistory).values({
    applicationId: id,
    fromStage: application.stage,
    toStage: "Rejected",
    changedBy: session.username,
    changedAt: now(),
    note: opt(form.get("reason")),
  });

  revalidateRecruitment();
  return OK;
}

/* ------------------------------------------------------- RC-04 interviews */

export async function saveInterview(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  await requireRole("HR_ADMIN");
  const original = opt(form.get("originalCode"));
  const applicationId = num(form.get("applicationId"));
  const scheduledDate = str(form.get("scheduledDate"));
  const rating = str(form.get("rating"));

  if (!applicationId) return fail("Choose an application.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(scheduledDate)) return fail("Enter a date.");
  if (rating && !["1", "2", "3", "4", "5"].includes(rating)) {
    return fail("A rating is between 1 and 5.");
  }

  const values = {
    applicationId,
    round: str(form.get("round")) || "Screening call",
    interviewer: str(form.get("interviewer")) || "—",
    scheduledDate,
    scheduledTime: opt(form.get("scheduledTime")),
    mode: str(form.get("mode")) || "Video call",
    rating: rating ? Number(rating) : null,
    feedback: opt(form.get("feedback")),
  };

  if (original) {
    await db.update(rcInterview).set(values).where(eq(rcInterview.id, Number(original)));
  } else {
    await db.insert(rcInterview).values({ ...values, createdAt: now() });
  }

  revalidateRecruitment();
  return OK;
}

export async function deleteInterview(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  await requireRole("HR_ADMIN");
  await db.delete(rcInterview).where(eq(rcInterview.id, num(form.get("id"))));
  revalidateRecruitment();
  return OK;
}

/* --------------------------------------------------- RC-05 hire conversion */

/**
 * Turns an offered candidate into an employee.
 *
 * This is the integration point with Core HR, and it deliberately does exactly
 * what the hire action does — employee plus five infotypes, position marked
 * filled — in one transaction. Two ways of creating an employee would drift
 * apart, and one of them would be the one missing an infotype payroll needs.
 */
export async function convertToEmployee(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireRole("HR_ADMIN");

  const applicationId = num(form.get("applicationId"));
  const hireDate = str(form.get("hireDate"));
  const salary = num(form.get("salary"));

  if (!/^\d{4}-\d{2}-\d{2}$/.test(hireDate)) return fail("Enter a hire date.");
  if (!Number.isFinite(salary) || salary <= 0) return fail("Enter the offered salary.");

  const application = await db.query.rcApplication.findFirst({
    where: eq(rcApplication.id, applicationId),
  });
  if (!application) return fail("That application no longer exists.");
  if (application.stage !== "Offered") {
    return fail("Only a candidate at the offered stage can be converted.");
  }

  const [requisition, candidate] = await Promise.all([
    db.query.rcRequisition.findFirst({
      where: eq(rcRequisition.id, application.requisitionId),
    }),
    db.query.rcCandidate.findFirst({ where: eq(rcCandidate.id, application.candidateId) }),
  ]);
  if (!requisition || !candidate) return fail("The requisition or candidate is missing.");

  const position = await db.query.omPosition.findFirst({
    where: eq(omPosition.code, requisition.positionCode),
  });
  if (!position) return fail("That position no longer exists.");
  if (!position.isVacant) {
    return fail(`${position.code} has already been filled.`);
  }

  const [last] = await db
    .select({ n: paEmployee.employeeNumber })
    .from(paEmployee)
    .orderBy(desc(paEmployee.employeeNumber))
    .limit(1);
  const employeeNumber = `EMP${(last ? Number(last.n.replace(/\D/g, "")) : 1000) + 1}`;

  // Split the candidate's name the way the hire form would have.
  const parts = candidate.fullName.trim().split(/\s+/);
  const firstName = parts[0] ?? candidate.fullName;
  const lastName = parts.length > 1 ? parts.slice(1).join(" ") : "—";

  const createdAt = now();
  const client = rawClient();
  const tx = await client.transaction("write");
  let employeeId: number;

  try {
    const inserted = await tx.execute({
      sql: `INSERT INTO pa_employee (employee_number, hire_date, employment_status, created_at)
            VALUES (?, ?, 'Active', ?) RETURNING id`,
      args: [employeeNumber, hireDate, createdAt],
    });
    employeeId = inserted.rows[0].id as number;
    const common = [employeeId, hireDate, OPEN_ENDED, 1, session.username, createdAt];

    await tx.execute({
      sql: `INSERT INTO pa_it0000_action
            (employee_id, valid_from, valid_to, seq, created_by, created_at, action_type, reason)
            VALUES (?,?,?,?,?,?,?,?)`,
      args: [...common, "Hire", `Recruitment ${requisition.code}`],
    });

    await tx.execute({
      sql: `INSERT INTO pa_it0001_org_assignment
            (employee_id, valid_from, valid_to, seq, created_by, created_at,
             company_code, area_code, sub_area_code, org_unit_code, position_code, cost_center)
            VALUES (?,?,?,?,?,?,
             (SELECT company_code FROM om_org_unit WHERE code = ?),
             (SELECT area_code FROM om_org_unit WHERE code = ?),
             NULL, ?, ?, NULL)`,
      args: [
        ...common,
        requisition.orgUnitCode,
        requisition.orgUnitCode,
        requisition.orgUnitCode,
        requisition.positionCode,
      ],
    });

    await tx.execute({
      sql: `INSERT INTO pa_it0002_personal_data
            (employee_id, valid_from, valid_to, seq, created_by, created_at,
             first_name, last_name, date_of_birth, gender, marital_status, nationality)
            VALUES (?,?,?,?,?,?,?,?,NULL,NULL,NULL,NULL)`,
      args: [...common, firstName, lastName],
    });

    await tx.execute({
      sql: `INSERT INTO pa_it0007_planned_working_time
            (employee_id, valid_from, valid_to, seq, created_by, created_at,
             work_schedule_code, weekly_hours, employment_percent)
            VALUES (?,?,?,?,?,?, 'WS01', 40, 100)`,
      args: common,
    });

    await tx.execute({
      sql: `INSERT INTO pa_it0008_basic_pay
            (employee_id, valid_from, valid_to, seq, created_by, created_at,
             pay_scale_type, pay_scale_area, pay_scale_group, amount_paise, currency)
            VALUES (?,?,?,?,?,?, 'Monthly salaried', NULL, NULL, ?, 'INR')`,
      args: [...common, toPaise(salary)],
    });

    await tx.execute({
      sql: `INSERT INTO pa_it0105_communication
            (employee_id, valid_from, valid_to, seq, created_by, created_at, comm_type, value)
            VALUES (?,?,?,?,?,?, 'Email (official)', ?)`,
      args: [...common, candidate.email],
    });

    await tx.execute({
      sql: "UPDATE om_position SET is_vacant = 0 WHERE code = ?",
      args: [requisition.positionCode],
    });

    await tx.execute({
      sql: "UPDATE rc_application SET stage = 'Hired' WHERE id = ?",
      args: [applicationId],
    });

    await tx.execute({
      sql: `INSERT INTO rc_hire_conversion
            (application_id, employee_id, hire_date, offered_salary_paise, converted_by, converted_at)
            VALUES (?,?,?,?,?,?)`,
      args: [applicationId, employeeId, hireDate, toPaise(salary), session.username, createdAt],
    });

    await tx.execute({
      sql: `INSERT INTO rc_application_stage_history
            (application_id, from_stage, to_stage, changed_by, changed_at, note)
            VALUES (?, 'Offered', 'Hired', ?, ?, ?)`,
      args: [applicationId, session.username, createdAt, `Became ${employeeNumber}`],
    });

    // Close the requisition once its openings are filled.
    const hiredCount = await tx.execute({
      sql: `SELECT COUNT(*) AS n FROM rc_application
            WHERE requisition_id = ? AND stage = 'Hired'`,
      args: [requisition.id],
    });
    if (Number(hiredCount.rows[0].n) >= requisition.openings) {
      await tx.execute({
        sql: "UPDATE rc_requisition SET status = 'Closed' WHERE id = ?",
        args: [requisition.id],
      });
    }

    await tx.commit();
  } catch (err) {
    await tx.rollback();
    return fail(
      err instanceof Error
        ? `The conversion could not be completed: ${err.message}`
        : "The conversion could not be completed.",
    );
  }

  revalidateRecruitment();
  return { ok: true, employeeId };
}
