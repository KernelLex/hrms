"use server";

import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { rawClient } from "@/lib/db";
import { readEnv } from "@/lib/env";
import { changeStatement, systemActor } from "@/lib/change-log";
import { storeDocument, UploadError } from "@/lib/storage";
import { documentSummary } from "@/lib/document-kinds";
import { queueEmailStatement, renderEmail } from "@/lib/email";
import { requeueStatement } from "@/lib/jobs/queue";
import { todayInIndia } from "@/lib/dates";
import { announceApplication, announceOfferResponse, applicationStatements, performConversion, stageStatements } from "@/lib/recruitment";
import { kickJobs } from "@/lib/jobs/runner";
import { toRupees } from "@/lib/money";

/**
 * Applying from the public careers page — the one Server Function anyone may
 * call without signing in. So it trusts nothing: every field is checked, the
 * resume is recognised by its content, a hidden field catches simple bots,
 * and one address can send only so many applications a day.
 */

export type ApplyState = { error?: string; ok?: boolean };

/** Applications one address may send in a day before it is refused. */
const DAILY_LIMIT = 8;

const ApplyInput = z.object({
  fullName: z.string().min(2, "Enter your full name.").max(120),
  email: z.email("Enter a valid email address.").max(200),
  phone: z.string().regex(/^[+\d][\d\s-]{6,19}$/, "Enter a phone number, such as +91 98765 43210."),
  currentEmployer: z.string().max(120).nullable(),
  experienceYears: z.number().int("Enter whole years.").min(0, "Enter whole years.").max(60).nullable(),
  noticePeriodDays: z.number().int("Enter the notice period in days.").min(0).max(365).nullable(),
  profileLink: z.string().regex(/^https?:\/\/\S+$/i, "A profile link starts with http:// or https://.").max(300).nullable(),
  coverNote: z.string().max(3000, "Keep the note under 3,000 characters.").nullable(),
});

const str = (v: FormDataEntryValue | null) => (typeof v === "string" ? v.trim() : "");
const opt = (v: FormDataEntryValue | null) => str(v) || null;
const optInt = (v: FormDataEntryValue | null) => {
  const s = str(v);
  return s ? (/^\d+$/.test(s) ? Number(s) : Number.NaN) : null;
};

/** Who is applying, as a hash: enough to count, nothing to identify. */
async function sourceHash(): Promise<string> {
  let address = "unknown";
  try {
    const h = await headers();
    address = h.get("x-forwarded-for")?.split(",")[0].trim() || h.get("x-real-ip") || "unknown";
  } catch {
    // outside a request
  }
  return createHash("sha256").update(`${readEnv("AUTH_SECRET") ?? ""}:careers:${address}`).digest("hex").slice(0, 32);
}

export async function applyForJob(_prev: ApplyState, form: FormData): Promise<ApplyState> {
  // A field people never see: anything in it came from a bot, which is told
  // it succeeded and is given nothing.
  if (str(form.get("website"))) return { ok: true };

  const code = str(form.get("code"));
  const req = (
    await rawClient().execute({
      sql: "SELECT id, code, title, status, is_published FROM rc_requisition WHERE code = ?",
      args: [code],
    })
  ).rows[0];
  if (!req || String(req.status) !== "Open" || Number(req.is_published) !== 1) {
    return { error: "This role is no longer taking applications." };
  }

  const parsed = ApplyInput.safeParse({
    fullName: str(form.get("fullName")),
    email: str(form.get("email")).toLowerCase(),
    phone: str(form.get("phone")),
    currentEmployer: opt(form.get("currentEmployer")),
    experienceYears: optInt(form.get("experienceYears")),
    noticePeriodDays: optInt(form.get("noticePeriodDays")),
    profileLink: opt(form.get("profileLink")),
    coverNote: opt(form.get("coverNote")),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  const v = parsed.data;

  const resume = form.get("resume");
  if (!(resume instanceof File) || resume.size === 0) return { error: "Attach your resume: a PDF or Word document." };
  if (form.get("consent") !== "on") {
    return { error: "Agree to us keeping your details for this application, so we can consider it." };
  }

  const hash = await sourceHash();
  const today = todayInIndia();
  const sent = await rawClient().execute({
    sql: "SELECT COUNT(*) AS n FROM rc_application WHERE source_hash = ? AND applied_date = ?",
    args: [hash, today],
  });
  if (Number(sent.rows[0].n) >= DAILY_LIMIT) {
    return { error: "We have had a lot of applications from your connection today. Please try again tomorrow." };
  }

  const actor = systemActor("Careers page");
  const at = new Date().toISOString();

  // One record per person: someone applying again, or for another role, is
  // the same candidate, with their details brought up to date. Caught by
  // phone as well as email, so a new address does not split their history.
  const existing = (
    await rawClient().execute({
      sql: "SELECT id FROM rc_candidate WHERE email = ? OR (phone <> '' AND phone = ?) LIMIT 1",
      args: [v.email, v.phone],
    })
  ).rows[0];
  let candidateId: number;
  let created = false;
  if (existing) {
    candidateId = Number(existing.id);
    const already = await rawClient().execute({
      sql: "SELECT 1 FROM rc_application WHERE candidate_id = ? AND requisition_id = ?",
      args: [candidateId, Number(req.id)],
    });
    if (already.rows.length > 0) return { error: "You have already applied for this role. We will be in touch." };
    await rawClient().execute({
      sql: `UPDATE rc_candidate SET full_name = ?, phone = ?, current_employer = COALESCE(?, current_employer),
              experience_years = COALESCE(?, experience_years), notice_period_days = COALESCE(?, notice_period_days),
              profile_link = COALESCE(?, profile_link), updated_at = ? WHERE id = ?`,
      args: [v.fullName, v.phone, v.currentEmployer, v.experienceYears, v.noticePeriodDays, v.profileLink, at, candidateId],
    });
  } else {
    const last = (await rawClient().execute("SELECT code FROM rc_candidate ORDER BY id DESC LIMIT 1")).rows[0];
    const next = last ? Number(String(last.code).replace(/\D/g, "")) + 1 : 1;
    const inserted = await rawClient().execute({
      sql: `INSERT INTO rc_candidate (code, full_name, email, phone, source, current_employer, experience_years,
              notice_period_days, profile_link, created_at)
            VALUES (?, ?, ?, ?, 'Careers page', ?, ?, ?, ?, ?) RETURNING id`,
      args: [`CAND${String(next).padStart(4, "0")}`, v.fullName, v.email, v.phone, v.currentEmployer, v.experienceYears, v.noticePeriodDays, v.profileLink, at],
    });
    candidateId = Number(inserted.rows[0].id);
    created = true;
  }

  let stored;
  try {
    stored = await storeDocument({ ownerType: "candidate", ownerId: candidateId, kind: "Resume", file: resume, uploadedBy: "Careers page" });
  } catch (err) {
    // Nothing half-made is left behind: a new candidate without their resume goes too.
    if (created) await rawClient().execute({ sql: "DELETE FROM rc_candidate WHERE id = ?", args: [candidateId] });
    if (err instanceof UploadError) return { error: err.message };
    throw err;
  }

  const application = await applicationStatements(actor, {
    candidateId,
    requisitionId: Number(req.id),
    channel: "Careers page",
    coverNote: v.coverNote,
    sourceHash: hash,
    today,
  });
  if (!application) return { error: "You have already applied for this role. We will be in touch." };

  const title = String(req.title);
  const statements = [
    ...(created
      ? [changeStatement(actor, { entity: "rc_candidate", entityId: candidateId, action: "create", after: { fullName: v.fullName, source: "Careers page" } })]
      : []),
    changeStatement(actor, { entity: "app_document", entityId: stored.id, action: "create", after: documentSummary(stored) }),
    ...(await announceApplication(application.id, v.fullName, title)),
    // The candidate hears that it arrived.
    queueEmailStatement(
      `careers.received:${application.id}`,
      {
        to: v.email,
        ...renderEmail({
          title: `We have your application for ${title}`,
          body: `Thank you, ${v.fullName.split(/\s+/)[0]}. Our recruitment team reads every application and will contact you about the next steps. You do not need to do anything more for now.`,
          footer: "You are receiving this because you applied on our careers page.",
        }),
      },
      { kind: "careers.received", applicationId: application.id },
    ),
    requeueStatement("outbox.deliver", null, "outbox.deliver"),
  ].filter((s): s is NonNullable<typeof s> => Boolean(s));
  await rawClient().batch(statements, "write");
  await kickJobs();

  revalidatePath("/recruitment", "layout");
  return { ok: true };
}

/* -------------------------------------------------------------- RC offers */

export type OfferResponseState = { error?: string; ok?: boolean; accepted?: boolean };

/** Where in the request this came from, to record with a reply only the candidate could send. */
async function clientIp(): Promise<string | null> {
  try {
    const h = await headers();
    return h.get("x-forwarded-for")?.split(",")[0].trim() || h.get("x-real-ip") || null;
  } catch {
    return null;
  }
}

/**
 * The candidate's own reply to their offer, through the link only they have
 * — no sign-in, so trusted only as far as the token itself: unguessable,
 * single-use, and checked against the offer's own expiry.
 */
export async function respondToOffer(_prev: OfferResponseState, form: FormData): Promise<OfferResponseState> {
  const token = str(form.get("token"));
  const decision = str(form.get("decision"));
  if (!token || (decision !== "accept" && decision !== "decline")) {
    return { error: "Something went wrong. Reload the page and try again." };
  }

  const offerRow = (await rawClient().execute({ sql: "SELECT * FROM rc_offer WHERE token = ?", args: [token] })).rows[0];
  if (!offerRow) return { error: "That link is not valid." };
  if (String(offerRow.status) !== "Sent") return { error: "This offer has already been responded to." };
  const today = todayInIndia();
  if (String(offerRow.expiry_date) < today) {
    await rawClient().execute({ sql: "UPDATE rc_offer SET status = 'Expired' WHERE id = ?", args: [offerRow.id] });
    return { error: "This offer has expired. Please contact recruitment." };
  }

  const appRow = (await rawClient().execute({ sql: "SELECT * FROM rc_application WHERE id = ?", args: [offerRow.application_id] })).rows[0];
  if (!appRow) return { error: "That application no longer exists." };
  const candidateRow = (await rawClient().execute({ sql: "SELECT full_name FROM rc_candidate WHERE id = ?", args: [appRow.candidate_id] })).rows[0];
  const candidateName = candidateRow ? String(candidateRow.full_name) : "The candidate";

  const actor = systemActor("Candidate, via offer link");
  const respondedAt = new Date().toISOString();
  const ip = await clientIp();

  if (decision === "decline") {
    await rawClient().batch(
      [
        { sql: "UPDATE rc_offer SET status = 'Declined', responded_at = ?, responded_ip = ? WHERE id = ?", args: [respondedAt, ip, offerRow.id] },
        ...stageStatements(
          actor,
          { id: Number(appRow.id), stage: String(appRow.stage), candidateId: Number(appRow.candidate_id) },
          "Rejected",
          { rejected_reason: "Declined the offer", rejected_at: respondedAt, rejected_by: "Candidate" },
          "Declined through their offer link",
        ),
        ...(await announceOfferResponse(Number(appRow.id), candidateName, "Declined")),
      ],
      "write",
    );
    await kickJobs();
    return { ok: true, accepted: false };
  }

  await rawClient().execute({
    sql: "UPDATE rc_offer SET status = 'Accepted', responded_at = ?, responded_ip = ? WHERE id = ?",
    args: [respondedAt, ip, offerRow.id],
  });
  const result = await performConversion({
    applicationId: Number(appRow.id),
    hireDate: String(offerRow.joining_date),
    salary: toRupees(Number(appRow.offered_salary_paise)),
    actorName: "Candidate, via offer link",
    actor,
  });
  if (!result.ok) return { error: `Your acceptance is recorded, but joining could not be completed yet: ${result.error} Recruitment has been told.` };

  await rawClient().batch(await announceOfferResponse(Number(appRow.id), candidateName, "Accepted"), "write");
  await kickJobs();
  revalidatePath("/recruitment", "layout");
  revalidatePath("/core-hr", "layout");
  return { ok: true, accepted: true };
}
