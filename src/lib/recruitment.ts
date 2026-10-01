import "server-only";
import { randomBytes } from "node:crypto";
import type { InStatement } from "@libsql/client";
import { eq } from "drizzle-orm";
import { db, rawClient } from "@/lib/db";
import { changeStatement, systemActor, type Actor } from "@/lib/change-log";
import { notificationStatements, notify, usersForEmployees } from "@/lib/notifications";
import { queueEmailStatement, renderEmail } from "@/lib/email";
import { formatINR, toPaise } from "@/lib/money";
import type { CtcBreakdown } from "@/lib/engines/payroll";
import { startOnboarding } from "@/lib/services/checklist";
import { rcApplication, rcRequisition, rcCandidate, omPosition, OPEN_ENDED, now } from "@/db/schema";

/**
 * Recruitment's shared rules, used by HR's screens and by the public careers
 * page: how an application comes into being, what each stage change writes,
 * who hears about it, and when two interviews collide.
 */

type Row = Record<string, unknown>;

async function one(sql: string, args: (string | number | null)[]): Promise<Row | null> {
  const r = await rawClient().execute({ sql, args });
  return (r.rows[0] as unknown as Row) ?? null;
}


/** The history row for a move, and the change-log row for the application. */
export function stageStatements(
  actor: Actor,
  application: { id: number; stage: string; candidateId: number },
  to: string,
  set: Record<string, string | number | null>,
  note: string | null,
): InStatement[] {
  const at = new Date().toISOString();
  const columns = Object.keys(set);
  const statements: InStatement[] = [];
  if (columns.length > 0) {
    statements.push({
      sql: `UPDATE rc_application SET ${columns.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`,
      args: [...columns.map((c) => set[c]), application.id],
    });
  }
  statements.push({
    sql: `INSERT INTO rc_application_stage_history (application_id, from_stage, to_stage, changed_by, changed_at, note)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [application.id, application.stage, to, actor.name, at, note],
  });
  const logged = changeStatement(actor, {
    entity: "rc_application",
    entityId: application.id,
    action: "update",
    before: { stage: application.stage },
    after: { ...set, stage: set.stage ?? application.stage, ...(to === "Rejected" ? { rejected: true } : {}) },
    reason: note ?? undefined,
  });
  if (logged) statements.push(logged);
  return statements;
}

/**
 * A new application, its first history row and its change-log row. Returns
 * null when the candidate has already applied to the requisition.
 */
export async function applicationStatements(
  actor: Actor,
  v: { candidateId: number; requisitionId: number; channel: "Careers page" | "Added by HR"; coverNote?: string | null; sourceHash?: string | null; today: string },
): Promise<{ id: number } | null> {
  const existing = await one("SELECT id FROM rc_application WHERE candidate_id = ? AND requisition_id = ?", [v.candidateId, v.requisitionId]);
  if (existing) return null;
  const inserted = await rawClient().execute({
    sql: `INSERT INTO rc_application (candidate_id, requisition_id, stage, applied_date, channel, cover_note, source_hash)
          VALUES (?, ?, 'Applied', ?, ?, ?, ?) RETURNING id`,
    args: [v.candidateId, v.requisitionId, v.today, v.channel, v.coverNote ?? null, v.sourceHash ?? null],
  });
  const id = Number(inserted.rows[0].id);
  const statements: InStatement[] = [
    {
      sql: `INSERT INTO rc_application_stage_history (application_id, from_stage, to_stage, changed_by, changed_at, note)
            VALUES (?, NULL, 'Applied', ?, ?, ?)`,
      args: [id, actor.name, new Date().toISOString(), v.channel === "Careers page" ? "Applied on the careers page" : null],
    },
  ];
  const logged = changeStatement(actor, {
    entity: "rc_application",
    entityId: id,
    action: "create",
    after: { candidateId: v.candidateId, requisitionId: v.requisitionId, stage: "Applied", channel: v.channel },
  });
  if (logged) statements.push(logged);
  await rawClient().batch(statements, "write");
  return { id };
}

/** Everyone who runs recruitment, through any role that grants it. */
export async function recruiterUserIds(): Promise<number[]> {
  const r = await rawClient().execute(
    `SELECT DISTINCT u.id FROM sec_app_user u
     JOIN sec_user_role ur ON ur.user_id = u.id
     JOIN sec_role_permission rp ON rp.role_code = ur.role_code
     WHERE rp.permission_code = 'recruitment.manage' AND u.is_active = 1`,
  );
  return r.rows.map((u) => Number(u.id));
}

/** Tells recruiters that someone applied on the careers page. */
export async function announceApplication(applicationId: number, candidateName: string, roleTitle: string): Promise<InStatement[]> {
  const users = await recruiterUserIds();
  return notificationStatements(
    users.map((userId) => ({
      userId,
      kind: "application.received" as const,
      title: `${candidateName} applied for ${roleTitle}`,
      body: "Their application is waiting to be screened: take it to interview, or reject the profile.",
      link: `/recruitment/applications/${applicationId}`,
      dedupeKey: `application.received:${applicationId}:${userId}`,
    })),
  );
}

/**
 * Tells an interviewer they have a round to take, and tells the candidate
 * it is confirmed. Both are a calendar invitation: the interviewer, who can
 * sign in, gets a link to the round where a "Download invite" button builds
 * the file on request; the candidate, who cannot, gets the when and where in
 * the email itself — the file attaches once a real provider sends it
 * (phase 25).
 */
export async function announceInterview(
  interview: { id: number; round: string; scheduledDate: string; scheduledTime: string | null; durationMinutes: number; mode: string; location: string | null; interviewerEmployeeId: number | null },
  candidate: { name: string; email: string },
  roleTitle: string,
): Promise<InStatement[]> {
  const when = `${interview.scheduledDate}${interview.scheduledTime ? ` at ${interview.scheduledTime}` : ""}`;
  const statements: InStatement[] = [];

  if (interview.interviewerEmployeeId) {
    const users = await usersForEmployees([interview.interviewerEmployeeId]);
    const userId = users.get(interview.interviewerEmployeeId);
    if (userId) {
      statements.push(
        ...(await notificationStatements([
          {
            userId,
            kind: "interview.assigned",
            title: `Interview with ${candidate.name}: ${interview.round}`,
            body: `On ${when}. Open it to see the candidate and the role, download the calendar invite, and record your notes afterwards.`,
            link: `/recruitment/interviews/${interview.id}`,
            // A rescheduled round is a new notice.
            dedupeKey: `interview.assigned:${interview.id}:${userId}:${interview.scheduledDate}:${interview.scheduledTime ?? ""}`,
          },
        ])),
      );
    }
  }

  statements.push(
    queueEmailStatement(
      `interview.confirmed:${interview.id}:${interview.scheduledDate}:${interview.scheduledTime ?? ""}`,
      {
        to: candidate.email,
        ...renderEmail({
          title: `Your interview for ${roleTitle} is confirmed`,
          body: `${interview.round}, on ${when} (${interview.durationMinutes} minutes, ${interview.mode.toLowerCase()}).${
            interview.location ? ` ${/^https?:\/\//i.test(interview.location) ? "Join at: " + interview.location : "Where: " + interview.location}` : ""
          }`,
          footer: "You are receiving this because you applied on our careers page.",
        }),
      },
      { kind: "interview.confirmed", interviewId: interview.id },
    ),
  );
  return statements;
}

/**
 * The interview round as a calendar file (RFC 5545), built fresh each time
 * rather than stored — the same reason the outbox never keeps attachment
 * bytes, just the recipe to make them.
 */
export function buildInterviewIcs(
  interview: { id: number; round: string; scheduledDate: string; scheduledTime: string | null; durationMinutes: number; location: string | null; createdAt: string },
  roleTitle: string,
  candidateName: string,
): string | null {
  if (!interview.scheduledTime) return null;
  // India has one fixed offset, year-round: no DST to account for.
  const start = new Date(`${interview.scheduledDate}T${interview.scheduledTime}:00+05:30`);
  const end = new Date(start.getTime() + interview.durationMinutes * 60_000);
  const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/[,;]/g, (c) => `\\${c}`).replace(/\n/g, "\\n");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//HRMS//Recruitment//EN",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    `UID:interview-${interview.id}@hrms`,
    `DTSTAMP:${stamp(new Date(interview.createdAt))}`,
    `DTSTART:${stamp(start)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${esc(`${interview.round} with ${candidateName}`)}`,
    `DESCRIPTION:${esc(`Interview for ${roleTitle}`)}`,
    ...(interview.location ? [`LOCATION:${esc(interview.location)}`] : []),
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.join("\r\n");
}

/** The same candidate is caught by email, and also by phone. */
export async function duplicateCandidate(email: string, phone: string | null): Promise<{ id: number; code: string; fullName: string } | null> {
  const row = await one(
    phone
      ? "SELECT id, code, full_name FROM rc_candidate WHERE email = ? OR (phone IS NOT NULL AND phone = ?) LIMIT 1"
      : "SELECT id, code, full_name FROM rc_candidate WHERE email = ? LIMIT 1",
    phone ? [email, phone] : [email],
  );
  return row ? { id: Number(row.id), code: String(row.code), fullName: String(row.full_name) } : null;
}

const minutes = (time: string | null) => {
  if (!time) return null;
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
};

/**
 * Another scheduled round the interviewer has that overlaps this one, if any.
 * Rounds without a time never collide: nobody can say when they are.
 */
export async function interviewClash(v: {
  interviewerEmployeeId: number;
  scheduledDate: string;
  scheduledTime: string | null;
  durationMinutes: number;
  exceptId: number | null;
}): Promise<{ time: string; candidate: string } | null> {
  const start = minutes(v.scheduledTime);
  if (start === null) return null;
  const r = await rawClient().execute({
    sql: `SELECT i.scheduled_time, i.duration_minutes, c.full_name
          FROM rc_interview i JOIN rc_application a ON a.id = i.application_id JOIN rc_candidate c ON c.id = a.candidate_id
          WHERE i.interviewer_employee_id = ? AND i.scheduled_date = ? AND i.status = 'Scheduled' AND i.id <> ?`,
    args: [v.interviewerEmployeeId, v.scheduledDate, v.exceptId ?? 0],
  });
  for (const row of r.rows) {
    const otherStart = minutes(row.scheduled_time === null ? null : String(row.scheduled_time));
    if (otherStart === null) continue;
    const otherEnd = otherStart + Number(row.duration_minutes);
    if (start < otherEnd && otherStart < start + v.durationMinutes) {
      return { time: String(row.scheduled_time), candidate: String(row.full_name) };
    }
  }
  return null;
}

/** An employee's name as it stands today, or their number if they have none. */
export async function employeeName(employeeId: number): Promise<string | null> {
  const row = await one(
    `SELECT e.employee_number, p.first_name, p.last_name FROM pa_employee e
     LEFT JOIN pa_it0002_personal_data p ON p.employee_id = e.id AND p.valid_from <= date('now') AND p.valid_to >= date('now')
     WHERE e.id = ? ORDER BY p.valid_from DESC LIMIT 1`,
    [employeeId],
  );
  if (!row) return null;
  return [row.first_name, row.last_name].filter(Boolean).join(" ") || String(row.employee_number);
}

/** Whether this employee has been asked to interview this candidate, in any round. */
export async function interviewsCandidate(employeeId: number, candidateId: number): Promise<boolean> {
  const row = await one(
    `SELECT 1 FROM rc_interview i JOIN rc_application a ON a.id = i.application_id
     WHERE i.interviewer_employee_id = ? AND a.candidate_id = ? LIMIT 1`,
    [employeeId, candidateId],
  );
  return row !== null;
}

/* ---------------------------------------------------------- phase 22: offers */

/** Only this, in the candidate's link, stands for them: unguessable, and never reused. */
export function offerToken(): string {
  return randomBytes(24).toString("base64url");
}

/** The offer letter: plain text, merged from the CTC breakdown — no template to maintain for one letter. */
export function offerLetterText(opts: {
  candidateName: string;
  roleTitle: string;
  ctcPaise: number;
  breakdown: CtcBreakdown;
  joiningDate: string;
  expiryDate: string;
}): string {
  return [
    `Dear ${opts.candidateName},`,
    "",
    `We are pleased to offer you the position of ${opts.roleTitle}, at a cost to company of ${formatINR(opts.ctcPaise)} a year, made up of:`,
    "",
    ...opts.breakdown.lines.map((l) => `  ${l.wageTypeName}: ${formatINR(l.amountPaise)} a month`),
    "",
    `Your proposed start date is ${opts.joiningDate}. This offer is open for your acceptance until ${opts.expiryDate}.`,
    "",
    "We look forward to welcoming you.",
  ].join("\n");
}

/** Tells the candidate their offer is ready, with the link only they can use to respond. */
export function offerSentStatements(opts: { offerId: number; token: string; candidateEmail: string; roleTitle: string; ctcPaise: number; expiryDate: string }): InStatement[] {
  return [
    queueEmailStatement(
      `offer.sent:${opts.offerId}`,
      {
        to: opts.candidateEmail,
        ...renderEmail({
          title: `Your offer for ${opts.roleTitle}`,
          body: `We are delighted to offer you this role, at ${formatINR(opts.ctcPaise)} a year. Read the full letter and accept or decline by ${opts.expiryDate}.`,
          link: `/careers/offer/${opts.token}`,
          action: "Review the offer",
          footer: "This link is yours alone; please do not forward it.",
        }),
      },
      { kind: "offer.sent", offerId: opts.offerId },
    ),
  ];
}

/** Tells recruiters the candidate has replied. */
export async function announceOfferResponse(applicationId: number, candidateName: string, decision: "Accepted" | "Declined"): Promise<InStatement[]> {
  const users = await recruiterUserIds();
  return notificationStatements(
    users.map((userId) => ({
      userId,
      kind: "offer.responded" as const,
      title: `${candidateName} ${decision === "Accepted" ? "accepted" : "declined"} the offer`,
      body: decision === "Accepted" ? "They are now an employee; there is nothing more to do." : "Close the application, or make another offer.",
      link: `/recruitment/applications/${applicationId}`,
      dedupeKey: `offer.responded:${applicationId}`,
    })),
  );
}

/* ------------------------------------------------------- phase 22: referrals */

type Executor = { execute: (s: InStatement) => Promise<{ rows: unknown[]; rowsAffected: number }> };

/**
 * Pays a referral bonus as one one-off payment, on the same IT0015 rail every
 * other one-off payment uses — kept apart from the job that decides who
 * qualifies, the way `engines/claims.ts` is kept from `services/claims.ts`.
 */
export async function queueReferralBonus(
  tx: Executor,
  logActor: Actor,
  opts: { referralId: number; referrerEmployeeId: number; bonusPaise: number; paymentDate: string },
): Promise<number> {
  const inserted = await tx.execute({
    sql: `INSERT INTO py_it0015_additional_payment (employee_id, wage_type_code, amount_paise, payment_date, created_at)
          VALUES (?, 'REFERRAL', ?, ?, ?) RETURNING id`,
    args: [opts.referrerEmployeeId, opts.bonusPaise, opts.paymentDate, new Date().toISOString()],
  });
  const additionalPaymentId = Number((inserted.rows[0] as Record<string, unknown>).id);
  await tx.execute({
    sql: "UPDATE rc_referral SET additional_payment_id = ?, status = 'Paid', paid_at = ? WHERE id = ?",
    args: [additionalPaymentId, new Date().toISOString(), opts.referralId],
  });
  const logged = changeStatement(logActor, {
    entity: "py_it0015_additional_payment",
    entityId: additionalPaymentId,
    subjectEmployeeId: opts.referrerEmployeeId,
    action: "create",
    after: { employeeId: opts.referrerEmployeeId, wageTypeCode: "REFERRAL", amountPaise: opts.bonusPaise, paymentDate: opts.paymentDate },
    reason: `Referral #${opts.referralId}`,
  });
  if (logged) await tx.execute(logged);
  return additionalPaymentId;
}

/**
 * Pays every referral whose qualifying period has passed, as of today — or
 * forfeits it, if the hire did not stay. Run daily; a referral paid or
 * forfeited once never comes up again, since both leave `status = 'Pending'`.
 */
export async function payQualifyingReferrals(asOfDate: string): Promise<number> {
  const due = await rawClient().execute({
    sql: `SELECT f.id, f.referrer_employee_id, f.bonus_paise, hc.hire_date, e.employment_status
          FROM rc_referral f
          JOIN rc_application a ON a.candidate_id = f.candidate_id AND a.stage = 'Hired'
          JOIN rc_hire_conversion hc ON hc.application_id = a.id
          JOIN pa_employee e ON e.id = hc.employee_id
          WHERE f.status = 'Pending' AND date(hc.hire_date, '+' || f.qualifying_days || ' days') <= ?`,
    args: [asOfDate],
  });
  const actor = systemActor("referrals");
  let handled = 0;
  for (const row of due.rows) {
    const referralId = Number(row.id);
    if (String(row.employment_status) === "Terminated") {
      await rawClient().execute({ sql: "UPDATE rc_referral SET status = 'Forfeited' WHERE id = ?", args: [referralId] });
    } else {
      await queueReferralBonus(rawClient(), actor, {
        referralId,
        referrerEmployeeId: Number(row.referrer_employee_id),
        bonusPaise: Number(row.bonus_paise),
        paymentDate: asOfDate,
      });
      const users = await usersForEmployees([Number(row.referrer_employee_id)]);
      const userId = users.get(Number(row.referrer_employee_id));
      if (userId) {
        await notify([
          {
            userId,
            kind: "referral.paid",
            title: "Your referral bonus is on its way",
            body: "It will be paid with the next payroll run that includes one-off payments.",
            link: "/refer",
            dedupeKey: `referral.paid:${referralId}`,
          },
        ]);
      }
    }
    handled += 1;
  }
  return handled;
}

/* ---------------------------------------------------- RC-05 hire conversion */

export type ConversionResult = { ok: true; employeeId: number } | { ok: false; error: string };

/**
 * Turns an offered candidate into an employee: the same hire action Core HR
 * uses — employee plus five infotypes, position marked filled — in one
 * transaction. Shared by the HR-driven action and the candidate's own
 * offer-accept link, so there is one way this happens, not two: nobody
 * retypes anything either way.
 */
export async function performConversion(opts: {
  applicationId: number;
  hireDate: string;
  salary: number;
  actorName: string;
  actor: Actor;
}): Promise<ConversionResult> {
  const { applicationId, hireDate, salary, actorName, actor } = opts;
  const fail = (error: string): ConversionResult => ({ ok: false, error });

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

  // Ordered by the number itself, not the text — see people.ts's hire().
  const last = (
    await rawClient().execute(
      "SELECT employee_number AS n FROM pa_employee WHERE employee_number LIKE 'EMP%' ORDER BY CAST(SUBSTR(employee_number, 4) AS INTEGER) DESC LIMIT 1",
    )
  ).rows[0];
  const employeeNumber = `EMP${(last ? Number(String(last.n).replace(/\D/g, "")) : 1000) + 1}`;

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
    const common = [employeeId, hireDate, OPEN_ENDED, 1, actorName, createdAt];

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
      args: [applicationId, employeeId, hireDate, toPaise(salary), actorName, createdAt],
    });

    await tx.execute({
      sql: `INSERT INTO rc_application_stage_history
            (application_id, from_stage, to_stage, changed_by, changed_at, note)
            VALUES (?, 'Offered', 'Hired', ?, ?, ?)`,
      args: [applicationId, actorName, createdAt, `Became ${employeeNumber}`],
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

    await startOnboarding(tx, actor, {
      employeeId,
      positionCode: requisition.positionCode,
      effectiveDate: hireDate,
      createdBy: actorName,
    });

    await tx.commit();
  } catch (err) {
    await tx.rollback();
    return fail(
      err instanceof Error
        ? `The conversion could not be completed: ${err.message}`
        : "The conversion could not be completed.",
    );
  }

  return { ok: true, employeeId };
}
