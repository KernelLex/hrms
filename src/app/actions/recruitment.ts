"use server";

import { revalidatePath } from "next/cache";
import { and, eq, desc } from "drizzle-orm";
import { z } from "zod";
import { db, rawClient } from "@/lib/db";
import { requireAnyPermission, requirePermission, can } from "@/lib/access";
import {
  actorOf,
  audited,
  changeStatement,
  recordCreated,
  recordDeleted,
  subjectOf,
  type Actor,
} from "@/lib/change-log";
import {
  rcRequisition,
  rcCandidate,
  rcApplication,
  rcInterview,
  omPosition,
  paEmployee,
  OPEN_ENDED,
  EMPLOYMENT_TYPES,
  WORK_MODES,
  RECOMMENDATIONS,
  now,
} from "@/db/schema";
import { toPaise } from "@/lib/money";
import { documentSummary } from "@/lib/document-kinds";
import {
  storeDocument,
  deleteDocument,
  UploadError,
  type StoredDocument,
} from "@/lib/storage";
import { appDocument } from "@/db/schema";
import { todayInIndia } from "@/lib/dates";
import {
  announceInterview,
  applicationStatements,
  employeeName,
  interviewClash,
  stageStatements,
} from "@/lib/recruitment";

export type ActionState = { error?: string; ok?: boolean; employeeId?: number; code?: string; id?: number };

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
/** A whole number from an optional field: null when blank, NaN when not a number. */
const optInt = (v: FormDataEntryValue | null) => {
  const s = str(v);
  return s ? (/^\d+$/.test(s) ? Number(s) : Number.NaN) : null;
};

function revalidateRecruitment() {
  revalidatePath("/recruitment", "layout");
  revalidatePath("/careers", "layout");
  revalidatePath("/core-hr", "layout");
  revalidatePath("/org", "layout");
  revalidatePath("/");
}

/* ----------------------------------------------------- RC-01 requisitions */

const RequisitionInput = z
  .object({
    positionCode: z.string().min(1, "Choose a position."),
    title: z.string().min(1, "Give the role a title candidates will recognise.").max(120),
    description: z.string().max(8000).nullable(),
    qualifications: z.string().max(4000).nullable(),
    skills: z.string().max(2000).nullable(),
    experienceMinYears: z.number().int("Experience is in whole years.").min(0).max(50).nullable(),
    experienceMaxYears: z.number().int("Experience is in whole years.").min(0).max(50).nullable(),
    employmentType: z.enum(EMPLOYMENT_TYPES),
    workMode: z.enum(WORK_MODES),
    location: z.string().max(200).nullable(),
    budgetMinPaise: z.number().int().positive("A budget is above zero.").nullable(),
    budgetMaxPaise: z.number().int().positive("A budget is above zero.").nullable(),
    hiringManagerEmployeeId: z.number().int().positive().nullable(),
    openings: z.number().int("Enter at least one opening.").min(1, "Enter at least one opening.").max(500),
    priority: z.enum(["High", "Medium", "Low"]),
    postedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a posted date."),
    targetCloseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    status: z.enum(["Open", "On hold", "Closed"]),
    isPublished: z.boolean(),
  })
  .refine((v) => v.experienceMinYears === null || v.experienceMaxYears === null || v.experienceMinYears <= v.experienceMaxYears, {
    message: "The least experience cannot be more than the most.",
  })
  .refine((v) => v.budgetMinPaise === null || v.budgetMaxPaise === null || v.budgetMinPaise <= v.budgetMaxPaise, {
    message: "The lower budget cannot be above the higher one.",
  })
  .refine((v) => !v.targetCloseDate || v.targetCloseDate >= v.postedDate, {
    message: "The target close date is before the posted date.",
  })
  .refine((v) => !v.isPublished || (v.description && v.description.length >= 40), {
    message: "A published role needs a description candidates can read: a few sentences at least.",
  })
  .refine((v) => !v.isPublished || v.status === "Open", {
    message: "Only an open requisition can be on the careers page.",
  });

const rupeesToPaise = (v: FormDataEntryValue | null) => {
  const s = str(v).replace(/,/g, "");
  if (!s) return null;
  return /^\d+(\.\d{1,2})?$/.test(s) ? toPaise(Number(s)) : Number.NaN;
};

/**
 * Opens or changes a requisition: the position it fills, and the role as
 * candidates will read it on the careers page when published.
 */
export async function saveRequisition(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const actor = actorOf(await requirePermission("recruitment.manage"));
  const original = opt(form.get("originalCode"));

  const parsed = RequisitionInput.safeParse({
    positionCode: str(form.get("positionCode")),
    title: str(form.get("title")),
    description: opt(form.get("description")),
    qualifications: opt(form.get("qualifications")),
    skills: opt(form.get("skills")),
    experienceMinYears: optInt(form.get("experienceMinYears")),
    experienceMaxYears: optInt(form.get("experienceMaxYears")),
    employmentType: str(form.get("employmentType")) || "Full-time",
    workMode: str(form.get("workMode")) || "On site",
    location: opt(form.get("location")),
    budgetMinPaise: rupeesToPaise(form.get("budgetMin")),
    budgetMaxPaise: rupeesToPaise(form.get("budgetMax")),
    hiringManagerEmployeeId: optInt(form.get("hiringManagerEmployeeId")),
    openings: num(form.get("openings")),
    priority: str(form.get("priority")) || "Medium",
    postedDate: str(form.get("postedDate")),
    targetCloseDate: opt(form.get("targetCloseDate")),
    status: str(form.get("status")) || "Open",
    isPublished: form.get("isPublished") === "on" || form.get("isPublished") === "true",
  });
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const v = parsed.data;

  const position = await db.query.omPosition.findFirst({
    where: eq(omPosition.code, v.positionCode),
  });
  if (!position) return fail("That position no longer exists.");

  const existing = original
    ? await db.query.rcRequisition.findFirst({ where: eq(rcRequisition.code, original) })
    : null;
  if (original && !existing) return fail("That requisition no longer exists.");

  // A new requisition, or a move to another position, needs a vacant one.
  if ((!existing || existing.positionCode !== v.positionCode) && !position.isVacant) {
    return fail(`${position.code} is filled. Open the requisition against a vacant position.`);
  }
  if (existing && existing.positionCode !== v.positionCode) {
    const applied = await db.select({ id: rcApplication.id }).from(rcApplication).where(eq(rcApplication.requisitionId, existing.id));
    if (applied.length > 0) return fail("People have applied to this requisition, so its position can no longer change.");
  }

  const values = {
    ...v,
    orgUnitCode: position.orgUnitCode,
    jobCode: position.jobCode,
    updatedAt: now(),
  };

  let code = original ?? "";
  if (existing) {
    await audited(
      actor,
      { entity: "rc_requisition", entityId: existing.code, subjectEmployeeId: subjectOf },
      () => db.query.rcRequisition.findFirst({ where: eq(rcRequisition.id, existing.id) }),
      () => db.update(rcRequisition).set(values).where(eq(rcRequisition.id, existing.id)),
    );
  } else {
    const [last] = await db
      .select({ code: rcRequisition.code })
      .from(rcRequisition)
      .orderBy(desc(rcRequisition.id))
      .limit(1);
    const next = last ? Number(last.code.replace(/\D/g, "")) + 1 : 1;
    code = `REQ${String(next).padStart(4, "0")}`;
    await recordCreated(
      actor,
      "rc_requisition",
      await db.insert(rcRequisition).values({ ...values, code, createdAt: now() }).returning(),
    );
  }

  revalidateRecruitment();
  return { ok: true, code };
}

/** Puts an open requisition on the careers page, or takes it off. */
export async function setRequisitionPublished(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const actor = actorOf(await requirePermission("recruitment.manage"));
  const code = str(form.get("code"));
  const publish = str(form.get("publish")) === "1";
  const req = await db.query.rcRequisition.findFirst({ where: eq(rcRequisition.code, code) });
  if (!req) return fail("That requisition no longer exists.");
  if (publish && req.status !== "Open") return fail("Only an open requisition can be on the careers page.");
  if (publish && (!req.description || req.description.length < 40)) {
    return fail("Add a description candidates can read before publishing.");
  }
  await audited(
    actor,
    { entity: "rc_requisition", entityId: code, subjectEmployeeId: subjectOf },
    () => db.query.rcRequisition.findFirst({ where: eq(rcRequisition.id, req.id) }),
    () => db.update(rcRequisition).set({ isPublished: publish, updatedAt: now() }).where(eq(rcRequisition.id, req.id)),
  );
  revalidateRecruitment();
  return OK;
}

export async function deleteRequisition(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const actor = actorOf(await requirePermission("recruitment.manage"));
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

  await recordDeleted(
    actor,
    "rc_requisition",
    await db.delete(rcRequisition).where(eq(rcRequisition.id, req.id)).returning(),
  );
  revalidateRecruitment();
  return OK;
}

/* -------------------------------------------------------- RC-02 candidates */

const CandidateInput = z.object({
  fullName: z.string().min(1, "Enter the candidate's name.").max(120),
  email: z.email("Enter a valid email address."),
  phone: z.string().max(40).nullable(),
  source: z.string().min(1),
  // Rendered as links, so only web addresses: a javascript: URL would run
  // in HR's browser when they clicked it.
  resumeLink: z
    .string()
    .regex(/^https?:\/\/\S+$/i, "A resume link must start with http:// or https://.")
    .nullable(),
  profileLink: z
    .string()
    .regex(/^https?:\/\/\S+$/i, "A profile link must start with http:// or https://.")
    .nullable(),
  currentEmployer: z.string().max(120).nullable(),
  experienceYears: z.number().int("Experience is in whole years.").min(0).max(60).nullable(),
  noticePeriodDays: z.number().int("The notice period is in days.").min(0).max(365).nullable(),
});

export async function saveCandidate(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requirePermission("recruitment.manage");
  const actor = actorOf(session);
  const original = opt(form.get("originalCode"));

  const parsed = CandidateInput.safeParse({
    fullName: str(form.get("fullName")),
    email: str(form.get("email")).toLowerCase(),
    phone: opt(form.get("phone")),
    source: str(form.get("source")) || "Job portal",
    resumeLink: opt(form.get("resumeLink")),
    profileLink: opt(form.get("profileLink")),
    currentEmployer: opt(form.get("currentEmployer")),
    experienceYears: optInt(form.get("experienceYears")),
    noticePeriodDays: optInt(form.get("noticePeriodDays")),
  });
  if (!parsed.success) return fail(firstIssue(parsed.error));

  // One record per person: the same email is the same candidate.
  const sameEmail = await db.query.rcCandidate.findFirst({ where: eq(rcCandidate.email, parsed.data.email) });
  if (sameEmail && sameEmail.code !== original) {
    return fail(`${sameEmail.fullName} (${sameEmail.code}) already has that email address.`);
  }

  if (original) {
    await audited(
      actor,
      { entity: "rc_candidate", entityId: original, subjectEmployeeId: subjectOf },
      () => db.query.rcCandidate.findFirst({ where: eq(rcCandidate.code, original) }),
      () => db.update(rcCandidate).set({ ...parsed.data, updatedAt: now() }).where(eq(rcCandidate.code, original)),
    );
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
      .returning();
    await recordCreated(actor, "rc_candidate", [candidate]);

    // Applying is optional, but it is the usual next step.
    const requisitionId = num(form.get("requisitionId"));
    if (requisitionId) {
      await applicationStatements(actor, { candidateId: candidate.id, requisitionId, channel: "Added by HR", today: todayInIndia() });
    }
  }

  revalidateRecruitment();
  return OK;
}

export async function deleteCandidate(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const actor = actorOf(await requirePermission("recruitment.manage"));
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

  await recordDeleted(
    actor,
    "rc_candidate",
    await db.delete(rcCandidate).where(eq(rcCandidate.id, candidate.id)).returning(),
  );
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
  const session = await requirePermission("recruitment.manage");
  const actor = actorOf(session);
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
  await recordCreated(actor, "app_document", [documentSummary(stored)]);

  revalidateRecruitment();
  return OK;
}

export async function removeResume(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const actor = actorOf(await requirePermission("recruitment.manage"));
  const doc = await db.query.appDocument.findFirst({
    where: and(eq(appDocument.id, num(form.get("documentId"))), eq(appDocument.ownerType, "candidate")),
  });
  if (!doc) return fail("That file has already been removed.");
  await deleteDocument(doc);
  await recordDeleted(actor, "app_document", [documentSummary(doc)]);
  revalidateRecruitment();
  return OK;
}

/* ---------------------------------------------------------- applications */

/** Applies an existing candidate to an open requisition, on their behalf. */
export async function createApplication(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requirePermission("recruitment.manage");
  const actor = actorOf(session);
  const candidateId = num(form.get("candidateId"));
  const requisitionId = num(form.get("requisitionId"));
  if (!candidateId || !requisitionId) return fail("Choose a candidate and a requisition.");

  const requisition = await db.query.rcRequisition.findFirst({ where: eq(rcRequisition.id, requisitionId) });
  if (!requisition) return fail("That requisition no longer exists.");
  if (requisition.status !== "Open") return fail(`${requisition.code} is ${requisition.status.toLowerCase()}, so it takes no applications.`);

  const created = await applicationStatements(actor, { candidateId, requisitionId, channel: "Added by HR", today: todayInIndia() });
  if (!created) return fail("That candidate has already applied to this requisition.");
  revalidateRecruitment();
  return { ok: true, id: created.id };
}

async function applicationFor(id: number) {
  return db.query.rcApplication.findFirst({ where: eq(rcApplication.id, id) });
}

type Application = NonNullable<Awaited<ReturnType<typeof applicationFor>>>;

async function move(actor: Actor, application: Application, to: string, set: Record<string, string | number | null>, note: string | null) {
  await rawClient().batch(stageStatements(actor, application, to, set, note), "write");
  revalidateRecruitment();
}

/**
 * Screening, the first decision on a new application: take it to interview.
 * (The other is rejecting the profile, `rejectApplication`.)
 */
export async function takeToInterview(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const actor = actorOf(await requirePermission("recruitment.manage"));
  const application = await applicationFor(num(form.get("id")));
  if (!application) return fail("That application no longer exists.");
  if (application.rejectedAt) return fail("That application was rejected.");
  if (application.stage !== "Applied") return fail("That application has already been screened.");
  await move(actor, application, "Interviewing", { stage: "Interviewing" }, opt(form.get("note")));
  return OK;
}

/**
 * Ends an application without a hire, at whatever stage it reached: a
 * profile rejected at screening, a candidate rejected after interviews, or
 * an offer declined or withdrawn. The reason is kept.
 */
export async function rejectApplication(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requirePermission("recruitment.manage");
  const actor = actorOf(session);
  const application = await applicationFor(num(form.get("id")));
  if (!application) return fail("That application no longer exists.");
  if (application.rejectedAt) return fail("That application was already rejected.");
  if (application.stage === "Hired") return fail("A hired candidate cannot be rejected.");
  const reason = opt(form.get("reason"));
  if (!reason) return fail("Say why, for the record.");

  await move(actor, application, "Rejected", { rejected_reason: reason, rejected_at: now(), rejected_by: session.displayName }, reason);
  return OK;
}

/**
 * The decision after interviews: approve the candidate. Needs at least one
 * round with notes, and no round still waiting — record or cancel it first.
 */
export async function selectCandidate(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requirePermission("recruitment.manage");
  const actor = actorOf(session);
  const application = await applicationFor(num(form.get("id")));
  if (!application) return fail("That application no longer exists.");
  if (application.rejectedAt) return fail("That application was rejected.");
  if (application.stage !== "Interviewing") return fail("Only a candidate being interviewed can be approved.");

  const rounds = await db.select().from(rcInterview).where(eq(rcInterview.applicationId, application.id));
  if (!rounds.some((r) => r.status === "Completed")) {
    return fail("Record at least one interview's notes before approving the candidate.");
  }
  const waiting = rounds.find((r) => r.status === "Scheduled");
  if (waiting) {
    return fail(`${waiting.round} with ${waiting.interviewer} is still scheduled. Record its notes or cancel it first.`);
  }

  await move(
    actor,
    application,
    "Selected",
    { stage: "Selected", selected_at: now(), selected_by: session.displayName, selection_note: opt(form.get("note")) },
    opt(form.get("note")),
  );
  return OK;
}

/** An approved candidate is offered the role, at a monthly salary. */
export async function makeOffer(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const actor = actorOf(await requirePermission("recruitment.manage"));
  const application = await applicationFor(num(form.get("id")));
  if (!application) return fail("That application no longer exists.");
  if (application.rejectedAt) return fail("That application was rejected.");
  if (application.stage !== "Selected") return fail("Approve the candidate before making an offer.");
  const salary = rupeesToPaise(form.get("offeredSalary"));
  if (salary === null || !Number.isFinite(salary) || salary <= 0) return fail("Enter the monthly salary offered.");

  await move(actor, application, "Offered", { stage: "Offered", offered_salary_paise: salary, offered_at: now() }, opt(form.get("note")));
  return OK;
}

/* ------------------------------------------------------- RC-04 interviews */

const InterviewInput = z.object({
  applicationId: z.number().int().positive("Choose an application."),
  round: z.string().min(1, "Name the round, such as Technical round 2.").max(80),
  interviewerEmployeeId: z.number().int().positive().nullable(),
  interviewerName: z.string().max(120).nullable(),
  scheduledDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a date."),
  scheduledTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Enter a time, such as 14:30."),
  durationMinutes: z.number().int().min(10, "An interview is ten minutes at least.").max(480),
  mode: z.enum(["Video call", "On site", "Phone"]),
  location: z.string().max(500).nullable(),
});

/**
 * Schedules a round, or changes one: who takes it, when, how and where. The
 * interviewer is told, and told again if it moves. Two rounds for one
 * interviewer may not overlap.
 */
export async function scheduleInterview(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const actor = actorOf(await requirePermission("recruitment.manage"));
  const originalId = optInt(form.get("id"));

  const parsed = InterviewInput.safeParse({
    applicationId: num(form.get("applicationId")),
    round: str(form.get("round")),
    interviewerEmployeeId: optInt(form.get("interviewerEmployeeId")),
    interviewerName: opt(form.get("interviewerName")),
    scheduledDate: str(form.get("scheduledDate")),
    scheduledTime: str(form.get("scheduledTime")),
    durationMinutes: num(form.get("durationMinutes")) || 60,
    mode: str(form.get("mode")) || "Video call",
    location: opt(form.get("location")),
  });
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const v = parsed.data;
  if (!v.interviewerEmployeeId && !v.interviewerName) return fail("Choose who takes the interview.");
  if (v.location && v.mode === "Video call" && /^[a-z]+:/i.test(v.location) && !/^https?:\/\//i.test(v.location)) {
    return fail("A meeting link must start with http:// or https://.");
  }

  const application = await applicationFor(v.applicationId);
  if (!application) return fail("That application no longer exists.");
  if (application.rejectedAt) return fail("That application was rejected.");
  if (application.stage !== "Interviewing") {
    return fail(application.stage === "Applied" ? "Take the application to interview first." : "Interviews are over for this application.");
  }

  let interviewer = v.interviewerName ?? "";
  if (v.interviewerEmployeeId) {
    const employee = await db.query.paEmployee.findFirst({ where: eq(paEmployee.id, v.interviewerEmployeeId) });
    if (!employee || employee.employmentStatus === "Terminated") return fail("That interviewer is not a current employee.");
    interviewer = (await employeeName(v.interviewerEmployeeId)) ?? employee.employeeNumber;
    const clash = await interviewClash({ ...v, interviewerEmployeeId: v.interviewerEmployeeId, exceptId: originalId });
    if (clash) return fail(`${interviewer} already has an interview at ${clash.time} that day, with ${clash.candidate}.`);
  }

  const values = {
    applicationId: v.applicationId,
    round: v.round,
    interviewer,
    interviewerEmployeeId: v.interviewerEmployeeId,
    scheduledDate: v.scheduledDate,
    scheduledTime: v.scheduledTime,
    durationMinutes: v.durationMinutes,
    mode: v.mode,
    location: v.location,
  };

  let id: number;
  if (originalId) {
    const before = await db.query.rcInterview.findFirst({ where: eq(rcInterview.id, originalId) });
    if (!before || before.applicationId !== v.applicationId) return fail("That interview no longer exists.");
    if (before.status === "Completed") return fail("That interview has happened; its notes are recorded.");
    await audited(
      actor,
      { entity: "rc_interview", entityId: originalId, subjectEmployeeId: subjectOf },
      () => db.query.rcInterview.findFirst({ where: eq(rcInterview.id, originalId) }),
      () => db.update(rcInterview).set({ ...values, status: "Scheduled" }).where(eq(rcInterview.id, originalId)),
    );
    id = originalId;
  } else {
    const [created] = await db.insert(rcInterview).values({ ...values, status: "Scheduled", createdAt: now() }).returning();
    await recordCreated(actor, "rc_interview", [created]);
    id = created.id;
  }

  const candidate = await db.query.rcCandidate.findFirst({ where: eq(rcCandidate.id, application.candidateId) });
  const notices = await announceInterview({ id, ...values }, candidate?.fullName ?? "a candidate");
  if (notices.length > 0) await rawClient().batch(notices, "write");

  revalidateRecruitment();
  return { ok: true, id };
}

const FeedbackInput = z.object({
  rating: z.number().int().min(1, "Rate the candidate from 1 to 5.").max(5, "Rate the candidate from 1 to 5."),
  recommendation: z.enum(RECOMMENDATIONS, "Say whether the candidate should go forward."),
  feedback: z.string().min(1, "Write your notes on the interview.").max(8000),
});

/**
 * Records how a round went: notes, a rating and a recommendation. The
 * interviewer records their own; whoever runs recruitment may record any,
 * for an interviewer who cannot sign in.
 */
export async function recordInterviewFeedback(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireAnyPermission("recruitment.manage", "recruitment.interview");
  const actor = actorOf(session);
  const id = num(form.get("id"));
  const interview = await db.query.rcInterview.findFirst({ where: eq(rcInterview.id, id) });
  if (!interview) return fail("That interview no longer exists.");
  const own = session.employeeId !== null && interview.interviewerEmployeeId === session.employeeId;
  if (!own && !can(session, "recruitment.manage")) return fail("That interview is not assigned to you.");
  if (interview.status === "Cancelled" || interview.status === "No-show") return fail(`That interview was marked ${interview.status.toLowerCase()}.`);

  const application = await applicationFor(interview.applicationId);
  if (!application || application.rejectedAt || application.stage !== "Interviewing") {
    return fail("The decision on this candidate has been made; the notes can no longer change.");
  }

  const parsed = FeedbackInput.safeParse({
    rating: num(form.get("rating")),
    recommendation: str(form.get("recommendation")),
    feedback: str(form.get("feedback")),
  });
  if (!parsed.success) return fail(firstIssue(parsed.error));

  await audited(
    actor,
    { entity: "rc_interview", entityId: id, subjectEmployeeId: subjectOf },
    () => db.query.rcInterview.findFirst({ where: eq(rcInterview.id, id) }),
    () =>
      db
        .update(rcInterview)
        .set({ ...parsed.data, status: "Completed", completedAt: now(), completedBy: session.displayName })
        .where(eq(rcInterview.id, id)),
  );
  revalidateRecruitment();
  return OK;
}

/** A round that did not happen: cancelled, or the candidate did not come. Or back to scheduled. */
export async function setInterviewStatus(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const actor = actorOf(await requirePermission("recruitment.manage"));
  const id = num(form.get("id"));
  const status = str(form.get("status"));
  if (!["Cancelled", "No-show", "Scheduled"].includes(status)) return fail("Choose what happened.");
  const interview = await db.query.rcInterview.findFirst({ where: eq(rcInterview.id, id) });
  if (!interview) return fail("That interview no longer exists.");
  if (interview.status === "Completed") return fail("That interview has happened; its notes are recorded.");
  await audited(
    actor,
    { entity: "rc_interview", entityId: id, subjectEmployeeId: subjectOf },
    () => db.query.rcInterview.findFirst({ where: eq(rcInterview.id, id) }),
    () => db.update(rcInterview).set({ status }).where(eq(rcInterview.id, id)),
  );
  revalidateRecruitment();
  return OK;
}

/** Removes a round scheduled by mistake. One with notes is kept. */
export async function deleteInterview(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const actor = actorOf(await requirePermission("recruitment.manage"));
  const id = num(form.get("id"));
  const interview = await db.query.rcInterview.findFirst({ where: eq(rcInterview.id, id) });
  if (!interview) return fail("That interview no longer exists.");
  if (interview.status === "Completed") return fail("That interview has notes, so it stays on the record. Cancel it instead.");
  await recordDeleted(
    actor,
    "rc_interview",
    await db.delete(rcInterview).where(eq(rcInterview.id, id)).returning(),
  );
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
  const session = await requirePermission("recruitment.hire");
  const actor = actorOf(session);

  const applicationId = num(form.get("applicationId"));
  const hireDate = str(form.get("hireDate"));
  const salary = num(form.get("salary"));

  if (!/^\d{4}-\d{2}-\d{2}$/.test(hireDate)) return fail("Enter a hire date.");
  if (!Number.isFinite(salary) || salary <= 0) return fail("Enter the offered salary.");

  const application = await db.query.rcApplication.findFirst({
    where: eq(rcApplication.id, applicationId),
  });
  if (!application) return fail("That application no longer exists.");
  if (application.stage !== "Offered" || application.rejectedAt) {
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

    const logged = [
      changeStatement(actor, {
        entity: "pa_employee",
        entityId: employeeId,
        subjectEmployeeId: employeeId,
        action: "create",
        after: {
          employeeNumber,
          actionType: "Hire",
          hireDate,
          firstName,
          lastName,
          orgUnitCode: requisition.orgUnitCode,
          positionCode: requisition.positionCode,
          amountPaise: toPaise(salary),
        },
        reason: `Recruitment ${requisition.code}, application ${applicationId}`,
      }),
      changeStatement(actor, {
        entity: "om_position",
        entityId: requisition.positionCode,
        action: "update",
        before: { isVacant: true },
        after: { isVacant: false },
        reason: `Filled by ${employeeNumber}`,
      }),
      changeStatement(actor, {
        entity: "rc_application",
        entityId: applicationId,
        action: "update",
        before: { stage: "Offered" },
        after: { stage: "Hired" },
      }),
    ];
    for (const st of logged) if (st) await tx.execute(st);

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

    // Close the requisition once its openings are filled, and take it off
    // the careers page.
    const hiredCount = await tx.execute({
      sql: `SELECT COUNT(*) AS n FROM rc_application
            WHERE requisition_id = ? AND stage = 'Hired'`,
      args: [requisition.id],
    });
    if (Number(hiredCount.rows[0].n) >= requisition.openings) {
      await tx.execute({
        sql: "UPDATE rc_requisition SET status = 'Closed', is_published = 0, updated_at = ? WHERE id = ?",
        args: [createdAt, requisition.id],
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
