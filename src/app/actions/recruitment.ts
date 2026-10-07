"use server";

import { revalidatePath } from "next/cache";
import { and, eq, desc } from "drizzle-orm";
import { z } from "zod";
import { db, rawClient } from "@/lib/db";
import { requireAnyPermission, requirePermission, can } from "@/lib/access";
import { DEFAULT_REFERRAL_BONUS_PAISE, DEFAULT_REFERRAL_QUALIFYING_DAYS } from "@/lib/recruitment-values";
import {
  actorOf,
  audited,
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
  rcScorecardTemplate,
  rcScorecard,
  rcOffer,
  rcReferral,
  omPosition,
  paEmployee,
  EMPLOYMENT_TYPES,
  WORK_MODES,
  RECOMMENDATIONS,
  now,
} from "@/db/schema";
import { toPaise, formatINR } from "@/lib/money";
import { documentSummary } from "@/lib/document-kinds";
import {
  storeDocument,
  deleteDocument,
  UploadError,
  type StoredDocument,
} from "@/lib/storage";
import { appDocument } from "@/db/schema";
import { todayInIndia } from "@/lib/dates";
import { previewCtc } from "@/lib/engines/payroll";
import {
  announceInterview,
  applicationStatements,
  duplicateCandidate,
  employeeName,
  interviewClash,
  offerLetterText,
  offerSentStatements,
  offerToken,
  performConversion,
  requisitionClosedReason,
  stageStatements,
} from "@/lib/recruitment";

export type ActionState = {
  error?: string;
  ok?: boolean;
  employeeId?: number;
  code?: string;
  id?: number;
  /**
   * What was typed, echoed back when a long form is refused. React resets an
   * uncontrolled field to its `defaultValue` once the action returns, so the
   * form feeds these back as its defaults and nothing has to be retyped.
   */
  values?: Record<string, string>;
};

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
    description: z
      .string()
      .min(40, "Describe the role in a few sentences, so a candidate knows what the job actually is.")
      .max(8000),
    qualifications: z.string().max(4000).nullable(),
    skills: z.string().min(1, "List the skills the role needs, one per line.").max(2000),
    experienceMinYears: z
      .number("Enter the least experience the role needs, in years.")
      .int("Experience is in whole years.")
      .min(0)
      .max(50),
    experienceMaxYears: z.number().int("Experience is in whole years.").min(0).max(50).nullable(),
    employmentType: z.enum(EMPLOYMENT_TYPES),
    workMode: z.enum(WORK_MODES),
    location: z.string().max(200).nullable(),
    budgetMinPaise: z.number().int().positive("A budget is above zero.").nullable(),
    budgetMaxPaise: z.number().int().positive("A budget is above zero.").nullable(),
    hiringManagerEmployeeId: z.number("Name the hiring manager who owns this role.").int().positive(),
    openings: z.number().int("Enter at least one opening.").min(1, "Enter at least one opening.").max(500),
    priority: z.enum(["High", "Medium", "Low"]),
    postedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a posted date."),
    targetCloseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    status: z.enum(["Open", "On hold", "Closed"]),
    isPublished: z.boolean(),
  })
  .refine((v) => v.experienceMaxYears === null || v.experienceMinYears <= v.experienceMaxYears, {
    message: "The least experience cannot be more than the most.",
  })
  .refine((v) => v.budgetMinPaise === null || v.budgetMaxPaise === null || v.budgetMinPaise <= v.budgetMaxPaise, {
    message: "The lower budget cannot be above the higher one.",
  })
  .refine((v) => !v.targetCloseDate || v.targetCloseDate >= v.postedDate, {
    message: "The target close date is before the posted date.",
  })
  .refine((v) => !v.isPublished || v.status === "Open", {
    message: "Only an open requisition can be on the careers page.",
  });

/** Every text field on the requisition form, for echoing a refused form back. */
const REQUISITION_FIELDS = [
  "positionCode",
  "title",
  "description",
  "qualifications",
  "skills",
  "experienceMinYears",
  "experienceMaxYears",
  "employmentType",
  "workMode",
  "location",
  "budgetMin",
  "budgetMax",
  "hiringManagerEmployeeId",
  "openings",
  "priority",
  "postedDate",
  "targetCloseDate",
  "status",
] as const;

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

  // Every refusal below carries the form back, so a long form that fails one
  // check does not lose the rest of what was typed.
  const typed: Record<string, string> = {};
  for (const field of REQUISITION_FIELDS) typed[field] = str(form.get(field));
  typed.isPublished = form.get("isPublished") === "on" || form.get("isPublished") === "true" ? "on" : "";
  const keep = (error: string): ActionState => ({ error, values: typed });

  const parsed = RequisitionInput.safeParse({
    positionCode: str(form.get("positionCode")),
    title: str(form.get("title")),
    description: str(form.get("description")),
    qualifications: opt(form.get("qualifications")),
    skills: str(form.get("skills")),
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
  if (!parsed.success) return keep(firstIssue(parsed.error));
  const v = parsed.data;

  const position = await db.query.omPosition.findFirst({
    where: eq(omPosition.code, v.positionCode),
  });
  if (!position) return keep("That position no longer exists.");

  const existing = original
    ? await db.query.rcRequisition.findFirst({ where: eq(rcRequisition.code, original) })
    : null;
  if (original && !existing) return keep("That requisition no longer exists.");

  // A new requisition, or a move to another position, needs a vacant one.
  if ((!existing || existing.positionCode !== v.positionCode) && !position.isVacant) {
    return keep(`${position.code} is filled. Open the requisition against a vacant position.`);
  }
  if (existing && existing.positionCode !== v.positionCode) {
    const applied = await db.select({ id: rcApplication.id }).from(rcApplication).where(eq(rcApplication.requisitionId, existing.id));
    if (applied.length > 0) return keep("People have applied to this requisition, so its position can no longer change.");
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

  // One record per person: the same email or phone is the same candidate.
  const dup = await duplicateCandidate(parsed.data.email, parsed.data.phone);
  if (dup && dup.code !== original) {
    return fail(`${dup.fullName} (${dup.code}) already has that email address or phone number.`);
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

  const closed = await requisitionClosedReason(requisitionId);
  if (closed) return fail(closed);

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

/**
 * An approved candidate is offered the role: a CTC breakdown by structure,
 * built into a letter and sent to the candidate's own link. A CTC above the
 * requisition's budgeted band needs `recruitment.hire` — the same, more
 * senior permission that turns an offer into an employee — rather than a
 * full approval chain for a check this narrow.
 */
export async function makeOffer(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requirePermission("recruitment.manage");
  const actor = actorOf(session);
  const application = await applicationFor(num(form.get("id")));
  if (!application) return fail("That application no longer exists.");
  if (application.rejectedAt) return fail("That application was rejected.");
  if (application.stage !== "Selected") return fail("Approve the candidate before making an offer.");

  const annualCtc = rupeesToPaise(form.get("annualCtc"));
  if (annualCtc === null || !Number.isFinite(annualCtc) || annualCtc <= 0) return fail("Enter the annual CTC offered.");
  const structureCode = str(form.get("structureCode"));
  if (!structureCode) return fail("Choose a salary structure.");
  const joiningDate = str(form.get("joiningDate"));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(joiningDate)) return fail("Enter a joining date.");
  const expiryDate = str(form.get("expiryDate"));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expiryDate) || expiryDate < todayInIndia()) return fail("Enter an expiry date, today or later.");

  const [requisition, candidate] = await Promise.all([
    db.query.rcRequisition.findFirst({ where: eq(rcRequisition.id, application.requisitionId) }),
    db.query.rcCandidate.findFirst({ where: eq(rcCandidate.id, application.candidateId) }),
  ]);
  if (!requisition || !candidate) return fail("The requisition or candidate is missing.");
  const monthlyCeiling = requisition.budgetMaxPaise;
  if (monthlyCeiling && Math.round(annualCtc / 12) > monthlyCeiling && !can(session, "recruitment.hire")) {
    return fail(`${formatINR(annualCtc)} a year is above this role's budgeted band (up to ${formatINR(monthlyCeiling)} a month). Ask someone who can hire to send it.`);
  }

  const breakdown = await previewCtc(structureCode, annualCtc, joiningDate);
  const roleTitle = requisition.title || "the role";
  const letterText = offerLetterText({ candidateName: candidate.fullName, roleTitle, ctcPaise: annualCtc, breakdown, joiningDate, expiryDate });
  const token = offerToken();
  const sentAt = now();

  const [offer] = await db
    .insert(rcOffer)
    .values({ applicationId: application.id, ctcPaise: annualCtc, structureCode, joiningDate, expiryDate, letterText, status: "Sent", token, sentAt, createdBy: session.displayName })
    .returning();
  await recordCreated(actor, "rc_offer", [offer]);

  const statements = [
    ...stageStatements(actor, application, "Offered", { stage: "Offered", offered_salary_paise: breakdown.monthlyCtcPaise, offered_at: sentAt }, opt(form.get("note"))),
    ...offerSentStatements({ offerId: offer.id, token, candidateEmail: candidate.email, roleTitle, ctcPaise: annualCtc, expiryDate }),
  ];
  await rawClient().batch(statements, "write");

  revalidateRecruitment();
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

  const [candidate, requisition] = await Promise.all([
    db.query.rcCandidate.findFirst({ where: eq(rcCandidate.id, application.candidateId) }),
    db.query.rcRequisition.findFirst({ where: eq(rcRequisition.id, application.requisitionId) }),
  ]);
  if (candidate) {
    const notices = await announceInterview({ id, ...values }, { name: candidate.fullName, email: candidate.email }, requisition?.title || "the role");
    if (notices.length > 0) await rawClient().batch(notices, "write");
  }

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

  const requisition = await db.query.rcRequisition.findFirst({ where: eq(rcRequisition.id, application.requisitionId) });
  const template = requisition
    ? await db
        .select({ criterion: rcScorecardTemplate.criterion })
        .from(rcScorecardTemplate)
        .where(and(eq(rcScorecardTemplate.jobCode, requisition.jobCode), eq(rcScorecardTemplate.isActive, true)))
    : [];
  const scorecard: { criterion: string; rating: number }[] = [];
  for (const { criterion } of template) {
    const rating = num(form.get(`sc:${criterion}`));
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return fail(`Rate "${criterion}" from 1 to 5 before saving: this role's scorecard is required.`);
    }
    scorecard.push({ criterion, rating });
  }

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

  if (template.length > 0) {
    await db.delete(rcScorecard).where(eq(rcScorecard.interviewId, id));
    await db.insert(rcScorecard).values(scorecard.map((s) => ({ interviewId: id, criterion: s.criterion, rating: s.rating, createdAt: now() })));
  }

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

/* ----------------------------------------------------- scorecard criteria */

/**
 * What interviewers rate a candidate on, per job: the criteria HR chooses
 * rather than a list fixed in the software. A round for a job with criteria
 * cannot be saved until every active one is rated.
 */
export async function saveScorecardCriterion(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const actor = actorOf(await requirePermission("recruitment.manage"));
  const id = optInt(form.get("id"));
  const jobCode = str(form.get("jobCode"));
  const criterion = str(form.get("criterion"));
  const weight = num(form.get("weight")) || 1;
  const sortOrder = Number(str(form.get("sortOrder")) || "0");
  if (!jobCode) return fail("Choose the job these criteria belong to.");
  if (!criterion) return fail("Name what interviewers rate, such as Problem solving.");
  if (criterion.length > 80) return fail("Keep a criterion under 80 characters.");
  if (!Number.isInteger(weight) || weight < 1 || weight > 10) return fail("A weight is a whole number from 1 to 10.");

  const clash = await db.query.rcScorecardTemplate.findFirst({
    where: and(eq(rcScorecardTemplate.jobCode, jobCode), eq(rcScorecardTemplate.criterion, criterion)),
  });
  if (clash && clash.id !== id) return fail(`"${criterion}" is already on this job's scorecard.`);

  const values = { jobCode, criterion, weight, sortOrder: Number.isFinite(sortOrder) ? sortOrder : 0, isActive: form.get("isActive") !== "0" };
  if (id) {
    const existing = await db.query.rcScorecardTemplate.findFirst({ where: eq(rcScorecardTemplate.id, id) });
    if (!existing) return fail("That criterion no longer exists.");
    await audited(
      actor,
      { entity: "rc_scorecard_template", entityId: id },
      () => db.query.rcScorecardTemplate.findFirst({ where: eq(rcScorecardTemplate.id, id) }),
      () => db.update(rcScorecardTemplate).set(values).where(eq(rcScorecardTemplate.id, id)),
    );
  } else {
    await recordCreated(actor, "rc_scorecard_template", await db.insert(rcScorecardTemplate).values(values).returning());
  }

  revalidateRecruitment();
  return OK;
}

/**
 * Removes a criterion. Ratings already recorded against it stay on the
 * rounds that have them — what an interviewer scored is not rewritten by a
 * later change to the scorecard — so a criterion in use is made inactive
 * instead of deleted.
 */
export async function deleteScorecardCriterion(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const actor = actorOf(await requirePermission("recruitment.manage"));
  const id = num(form.get("id"));
  const existing = await db.query.rcScorecardTemplate.findFirst({ where: eq(rcScorecardTemplate.id, id) });
  if (!existing) return fail("That criterion no longer exists.");

  const scored = await db.select({ id: rcScorecard.id }).from(rcScorecard).where(eq(rcScorecard.criterion, existing.criterion)).limit(1);
  if (scored.length > 0) {
    return fail(`"${existing.criterion}" has already been scored on an interview. Make it inactive instead, so what was scored stays readable.`);
  }

  await recordDeleted(
    actor,
    "rc_scorecard_template",
    await db.delete(rcScorecardTemplate).where(eq(rcScorecardTemplate.id, id)).returning(),
  );
  revalidateRecruitment();
  return OK;
}

/* --------------------------------------------------- RC-05 hire conversion */

/** An offered candidate becomes an employee, through the screen HR uses directly. */
export async function convertToEmployee(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requirePermission("recruitment.hire");
  const applicationId = num(form.get("applicationId"));
  const hireDate = str(form.get("hireDate"));
  const salary = num(form.get("salary"));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(hireDate)) return fail("Enter a hire date.");
  if (!Number.isFinite(salary) || salary <= 0) return fail("Enter the offered salary.");

  const result = await performConversion({ applicationId, hireDate, salary, actorName: session.username, actor: actorOf(session) });
  if (result.ok) revalidateRecruitment();
  return result.ok ? result : fail(result.error);
}

/* -------------------------------------------------------- phase 22: referrals */

const ReferralInput = z.object({
  fullName: z.string().min(1, "Enter their name.").max(120),
  email: z.email("Enter a valid email address."),
  phone: z.string().max(40).nullable(),
  currentEmployer: z.string().max(120).nullable(),
  experienceYears: z.number().int("Experience is in whole years.").min(0).max(60).nullable(),
  requisitionId: z.number().int().positive().nullable(),
});

/** Any employee refers a candidate for an open role, earning a bonus once the hire sticks. */
export async function referCandidate(_prev: ActionState, form: FormData): Promise<ActionState> {
  const session = await requirePermission("self.profile");
  if (session.employeeId === null) return fail("Only an employee can refer someone.");
  const actor = actorOf(session);

  const parsed = ReferralInput.safeParse({
    fullName: str(form.get("fullName")),
    email: str(form.get("email")).toLowerCase(),
    phone: opt(form.get("phone")),
    currentEmployer: opt(form.get("currentEmployer")),
    experienceYears: optInt(form.get("experienceYears")),
    requisitionId: optInt(form.get("requisitionId")),
  });
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const v = parsed.data;

  const resume = form.get("resume");
  const resumeFile = resume instanceof File && resume.size > 0 ? resume : null;

  const dup = await duplicateCandidate(v.email, v.phone);
  // A bonus is for someone new to us. Someone already referred, or already a
  // candidate who applied another way, is refused here rather than left to
  // find out later that the referral earned nothing. Referred first, because
  // it is the more exact reason of the two.
  if (dup) {
    const referredAlready = await db.query.rcReferral.findFirst({ where: eq(rcReferral.candidateId, dup.id) });
    if (referredAlready) return fail(`${dup.fullName} has already been referred.`);
    const applied = await db.select({ id: rcApplication.id }).from(rcApplication).where(eq(rcApplication.candidateId, dup.id));
    if (applied.length > 0) {
      return fail(`${dup.fullName} has already applied to us, so they cannot be referred for a bonus.`);
    }
  }

  let candidateId: number;
  if (dup) {
    candidateId = dup.id;
  } else {
    const [last] = await db.select({ code: rcCandidate.code }).from(rcCandidate).orderBy(desc(rcCandidate.id)).limit(1);
    const next = last ? Number(last.code.replace(/\D/g, "")) + 1 : 1;
    const [candidate] = await db
      .insert(rcCandidate)
      .values({
        code: `CAND${String(next).padStart(4, "0")}`,
        fullName: v.fullName,
        email: v.email,
        phone: v.phone,
        currentEmployer: v.currentEmployer,
        experienceYears: v.experienceYears,
        source: "Referral",
        createdAt: now(),
      })
      .returning();
    await recordCreated(actor, "rc_candidate", [candidate]);
    candidateId = candidate.id;
  }

  const existingReferral = await db.query.rcReferral.findFirst({ where: eq(rcReferral.candidateId, candidateId) });
  if (existingReferral) return fail(`${dup ? dup.fullName : v.fullName} has already been referred.`);

  if (resumeFile) {
    try {
      const stored = await storeDocument({
        ownerType: "candidate",
        ownerId: candidateId,
        kind: "Resume",
        file: resumeFile,
        uploadedBy: session.username,
      });
      await recordCreated(actor, "app_document", [documentSummary(stored)]);
    } catch (err) {
      if (err instanceof UploadError) return fail(err.message);
      throw err;
    }
  }

  if (v.requisitionId) {
    const closed = await requisitionClosedReason(v.requisitionId);
    if (closed) return fail(closed);
    await applicationStatements(actor, { candidateId, requisitionId: v.requisitionId, channel: "Added by HR", coverNote: `Referred by ${session.displayName}`, today: todayInIndia() });
  }

  const [referral] = await db
    .insert(rcReferral)
    .values({
      referrerEmployeeId: session.employeeId,
      candidateId,
      bonusPaise: DEFAULT_REFERRAL_BONUS_PAISE,
      qualifyingDays: DEFAULT_REFERRAL_QUALIFYING_DAYS,
      status: "Pending",
      createdAt: now(),
    })
    .returning();
  await recordCreated(actor, "rc_referral", [referral]);

  revalidateRecruitment();
  return OK;
}
