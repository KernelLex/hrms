"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db, rawClient } from "@/lib/db";
import { can, requireAnyPermission, requirePermission } from "@/lib/access";
import {
  actorOf,
  audited,
  recordCreated,
  recordDeleted,
  subjectOf,
} from "@/lib/change-log";
import {
  ldCourse,
  ldSession,
  ldNomination,
  ldDepartmentBudget,
  ldCertification,
  ldCertificationRequirement,
  appDocument,
  now,
} from "@/db/schema";
import { toPaise } from "@/lib/money";
import { documentSummary } from "@/lib/document-kinds";
import { storeDocument, deleteDocument, UploadError } from "@/lib/storage";
import { notificationStatements, usersForEmployees } from "@/lib/notifications";
import { managesEmployee } from "@/lib/workflow/engine";

export type ActionState = { error?: string; ok?: boolean };

const OK: ActionState = { ok: true };
const fail = (error: string): ActionState => ({ error });
const str = (v: FormDataEntryValue | null) => (typeof v === "string" ? v.trim() : "");
const opt = (v: FormDataEntryValue | null) => {
  const s = str(v);
  return s.length > 0 ? s : null;
};
const num = (v: FormDataEntryValue | null) => Number(str(v));

function revalidateTraining() {
  revalidatePath("/training", "layout");
  revalidatePath("/");
}

/* ------------------------------------------------------------- catalogue */

export async function saveCourse(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const actor = actorOf(await requirePermission("training.manage"));
  const original = opt(form.get("originalCode"));
  const code = str(form.get("code"));
  const title = str(form.get("title"));
  if (!code) return fail("Give the course a code.");
  if (!title) return fail("Give the course a title.");
  const costPaise = toPaise(Number(str(form.get("cost")) || "0"));

  const values = { code, title, description: opt(form.get("description")), costPaise, isActive: form.get("isActive") !== "0" };

  if (original) {
    await audited(
      actor,
      { entity: "ld_course", entityId: original },
      () => db.query.ldCourse.findFirst({ where: eq(ldCourse.code, original) }),
      () => db.update(ldCourse).set(values).where(eq(ldCourse.code, original)),
    );
  } else {
    const existing = await db.query.ldCourse.findFirst({ where: eq(ldCourse.code, code) });
    if (existing) return fail(`${code} already exists.`);
    await recordCreated(actor, "ld_course", await db.insert(ldCourse).values(values).returning());
  }

  revalidateTraining();
  return OK;
}

export async function deleteCourse(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const actor = actorOf(await requirePermission("training.manage"));
  const code = str(form.get("code"));
  const sessions = await db.select({ id: ldSession.id }).from(ldSession).where(eq(ldSession.courseCode, code));
  if (sessions.length > 0) return fail("This course has sessions on record. Make it inactive instead of deleting it.");
  await recordDeleted(actor, "ld_course", await db.delete(ldCourse).where(eq(ldCourse.code, code)).returning());
  revalidateTraining();
  return OK;
}

/* --------------------------------------------------------------- sessions */

export async function saveSession(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const actor = actorOf(await requirePermission("training.manage"));
  const id = opt(form.get("id"));
  const courseCode = str(form.get("courseCode"));
  const startDate = str(form.get("startDate"));
  const endDate = str(form.get("endDate"));
  const capacity = num(form.get("capacity"));
  if (!courseCode) return fail("Choose a course.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate) || endDate < startDate) {
    return fail("Enter a start and end date, the end on or after the start.");
  }
  if (!Number.isInteger(capacity) || capacity < 1) return fail("Capacity is at least one seat.");

  const course = await db.query.ldCourse.findFirst({ where: eq(ldCourse.code, courseCode) });
  if (!course) return fail("That course no longer exists.");
  const costInput = str(form.get("cost"));
  const costPaise = costInput ? toPaise(Number(costInput)) : course.costPaise;

  const values = { courseCode, startDate, endDate, capacity, place: opt(form.get("place")), costPaise };

  if (id) {
    await audited(
      actor,
      { entity: "ld_session", entityId: Number(id) },
      () => db.query.ldSession.findFirst({ where: eq(ldSession.id, Number(id)) }),
      () => db.update(ldSession).set(values).where(eq(ldSession.id, Number(id))),
    );
  } else {
    await recordCreated(actor, "ld_session", await db.insert(ldSession).values({ ...values, createdAt: now() }).returning());
  }

  revalidateTraining();
  return OK;
}

export async function deleteSession(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const actor = actorOf(await requirePermission("training.manage"));
  const id = num(form.get("id"));
  const nominations = await db.select({ id: ldNomination.id }).from(ldNomination).where(eq(ldNomination.sessionId, id));
  if (nominations.length > 0) return fail("This session has nominations on record.");
  await recordDeleted(actor, "ld_session", await db.delete(ldSession).where(eq(ldSession.id, id)).returning());
  revalidateTraining();
  return OK;
}

/* ------------------------------------------------------------ nominations */

/**
 * Nominating someone for a session: themself, their own team, or anyone.
 *
 * Who may nominate whom is decided by the data, not by the form: `self.training`
 * covers your own name only, a manager may put forward the people who report
 * to them, and `training.manage` covers anyone. Without that, an employee
 * holding only `self.training` could nominate a colleague by sending their id.
 */
export async function nominate(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireAnyPermission("self.training", "training.manage");
  const actor = actorOf(session);
  const sessionId = num(form.get("sessionId"));
  const employeeId = num(form.get("employeeId")) || session.employeeId;
  if (!sessionId || !employeeId) return fail("Choose a session.");

  const forSomeoneElse = employeeId !== session.employeeId;
  if (forSomeoneElse && !can(session, "training.manage")) {
    const mine = session.employeeId !== null && (await managesEmployee(session.employeeId, employeeId));
    if (!mine) return fail("You can only nominate yourself, or someone who reports to you.");
  }

  const existing = await db.query.ldNomination.findFirst({ where: and(eq(ldNomination.sessionId, sessionId), eq(ldNomination.employeeId, employeeId)) });
  if (existing) return fail("Already nominated for this session.");

  const taken = await db.select().from(ldNomination).where(and(eq(ldNomination.sessionId, sessionId), eq(ldNomination.status, "Approved")));
  const seats = await db.query.ldSession.findFirst({ where: eq(ldSession.id, sessionId) });
  if (!seats) return fail("That session no longer exists.");
  if (taken.length >= seats.capacity) return fail("That session is full.");

  const [row] = await db
    .insert(ldNomination)
    .values({ sessionId, employeeId, status: "Requested", createdBy: session.displayName, createdAt: now() })
    .returning();
  await recordCreated(actor, "ld_nomination", [row]);

  // Someone put forward by their manager or by HR hears about it; nominating
  // yourself needs no telling.
  if (forSomeoneElse) {
    const course = await db.query.ldSession.findFirst({ where: eq(ldSession.id, sessionId) });
    const users = await usersForEmployees([employeeId]);
    const userId = users.get(employeeId);
    if (userId) {
      const notices = await notificationStatements([
        {
          userId,
          kind: "nomination.assigned",
          title: "You have been nominated for training",
          body: course ? `Starting ${course.startDate}. It needs approving before your seat is confirmed.` : "It needs approving before your seat is confirmed.",
          link: "/training/my-training",
          dedupeKey: `nomination.assigned:${row.id}:${userId}`,
        },
      ]);
      if (notices.length > 0) await rawClient().batch(notices, "write");
    }
  }

  revalidateTraining();
  return OK;
}

/**
 * Approving a nomination is checked against its department's training budget
 * for the year: the session's cost, added to every nomination already
 * approved for that department this year, must not exceed what was
 * allocated. The check runs at the decision, since the budget — or the
 * queue ahead of it — can move between asking and deciding.
 */
export async function decideNomination(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requirePermission("training.manage");
  const actor = actorOf(session);
  const id = num(form.get("id"));
  const decision = str(form.get("decision"));
  if (!["Approved", "Rejected"].includes(decision)) return fail("Approve or reject.");

  const nomination = await db.query.ldNomination.findFirst({ where: eq(ldNomination.id, id) });
  if (!nomination) return fail("That nomination no longer exists.");
  if (nomination.status !== "Requested") return fail("That nomination has already been decided.");

  if (decision === "Approved") {
    const thisSession = await db.query.ldSession.findFirst({ where: eq(ldSession.id, nomination.sessionId) });
    if (!thisSession) return fail("That session no longer exists.");
    const year = Number(thisSession.startDate.slice(0, 4));

    const orgRow = (
      await rawClient().execute({
        sql: "SELECT org_unit_code FROM pa_it0001_org_assignment WHERE employee_id = ? AND valid_from <= date('now') AND valid_to >= date('now')",
        args: [nomination.employeeId],
      })
    ).rows[0];
    const orgUnitCode = orgRow ? String(orgRow.org_unit_code) : null;

    const budget = orgUnitCode
      ? await db.query.ldDepartmentBudget.findFirst({ where: and(eq(ldDepartmentBudget.orgUnitCode, orgUnitCode), eq(ldDepartmentBudget.year, year)) })
      : null;
    if (budget) {
      const spentRow = (
        await rawClient().execute({
          sql: `SELECT COALESCE(SUM(s.cost_paise), 0) AS spent FROM ld_nomination n
                JOIN ld_session s ON s.id = n.session_id
                JOIN pa_it0001_org_assignment o ON o.employee_id = n.employee_id AND o.valid_from <= date('now') AND o.valid_to >= date('now')
                WHERE n.status = 'Approved' AND o.org_unit_code = ? AND CAST(strftime('%Y', s.start_date) AS INTEGER) = ?`,
          args: [orgUnitCode, year],
        })
      ).rows[0];
      const spent = Number(spentRow.spent);
      if (spent + thisSession.costPaise > budget.allocatedPaise) {
        return fail(`Approving this would take their department's ${year} training budget over what was allocated.`);
      }
    }
  }

  await audited(
    actor,
    { entity: "ld_nomination", entityId: id, subjectEmployeeId: subjectOf },
    () => db.query.ldNomination.findFirst({ where: eq(ldNomination.id, id) }),
    () => db.update(ldNomination).set({ status: decision, decidedBy: session.displayName, decidedAt: now() }).where(eq(ldNomination.id, id)),
  );

  const users = await usersForEmployees([nomination.employeeId]);
  const userId = users.get(nomination.employeeId);
  if (userId) {
    await rawClient().batch(
      await notificationStatements([
        {
          userId,
          kind: "nomination.decided",
          title: decision === "Approved" ? "Your training nomination is approved" : "Your training nomination was not approved",
          body: decision === "Approved" ? "You have a seat on the session." : "Ask your manager if you would like to know more.",
          link: "/training/my-training",
          dedupeKey: `nomination.decided:${id}`,
        },
      ]),
      "write",
    );
  }

  revalidateTraining();
  return OK;
}

export async function recordAttendance(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const actor = actorOf(await requirePermission("training.manage"));
  const id = num(form.get("id"));
  const attended = form.get("attended") === "1";
  const nomination = await db.query.ldNomination.findFirst({ where: eq(ldNomination.id, id) });
  if (!nomination) return fail("That nomination no longer exists.");
  if (nomination.status !== "Approved") return fail("Only an approved nomination can have attendance recorded.");

  await audited(
    actor,
    { entity: "ld_nomination", entityId: id, subjectEmployeeId: subjectOf },
    () => db.query.ldNomination.findFirst({ where: eq(ldNomination.id, id) }),
    () => db.update(ldNomination).set({ attended, feedback: opt(form.get("feedback")) }).where(eq(ldNomination.id, id)),
  );

  revalidateTraining();
  return OK;
}

/* --------------------------------------------------------------- budgets */

export async function saveDepartmentBudget(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const actor = actorOf(await requirePermission("training.manage"));
  const orgUnitCode = str(form.get("orgUnitCode"));
  const year = num(form.get("year"));
  const allocatedPaise = toPaise(Number(str(form.get("allocated")) || "0"));
  if (!orgUnitCode) return fail("Choose a department.");
  if (!Number.isInteger(year) || year < 2000) return fail("Enter a year.");

  const existing = await db.query.ldDepartmentBudget.findFirst({ where: and(eq(ldDepartmentBudget.orgUnitCode, orgUnitCode), eq(ldDepartmentBudget.year, year)) });
  if (existing) {
    await audited(
      actor,
      { entity: "ld_department_budget", entityId: existing.id },
      () => db.query.ldDepartmentBudget.findFirst({ where: eq(ldDepartmentBudget.id, existing.id) }),
      () => db.update(ldDepartmentBudget).set({ allocatedPaise }).where(eq(ldDepartmentBudget.id, existing.id)),
    );
  } else {
    await recordCreated(actor, "ld_department_budget", await db.insert(ldDepartmentBudget).values({ orgUnitCode, year, allocatedPaise }).returning());
  }

  revalidateTraining();
  return OK;
}

/* ---------------------------------------------------------- certifications */

export async function saveCertification(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireAnyPermission("self.training", "training.manage");
  const actor = actorOf(session);
  const employeeId = num(form.get("employeeId")) || session.employeeId;
  const name = str(form.get("name"));
  const issuedDate = str(form.get("issuedDate"));
  if (!employeeId) return fail("Choose whose certification this is.");
  if (!can(session, "training.manage") && employeeId !== session.employeeId) return fail("You can only add your own certifications.");
  if (!name) return fail("Name the certification.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(issuedDate)) return fail("Enter when it was issued.");
  const expiryDate = opt(form.get("expiryDate"));
  if (expiryDate && !/^\d{4}-\d{2}-\d{2}$/.test(expiryDate)) return fail("Enter a valid expiry date, or leave it blank.");

  let documentId: number | null = null;
  const file = form.get("file");
  if (file instanceof File && file.size > 0) {
    try {
      const stored = await storeDocument({ ownerType: "employee", ownerId: employeeId, kind: "Certification", file, uploadedBy: session.username });
      documentId = stored.id;
      await recordCreated(actor, "app_document", [documentSummary(stored)]);
    } catch (err) {
      if (err instanceof UploadError) return fail(err.message);
      throw err;
    }
  }

  await recordCreated(
    actor,
    "ld_certification",
    await db
      .insert(ldCertification)
      .values({ employeeId, name, issuer: opt(form.get("issuer")), issuedDate, expiryDate, documentId, createdAt: now() })
      .returning(),
  );

  revalidateTraining();
  return OK;
}

export async function deleteCertification(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireAnyPermission("self.training", "training.manage");
  const actor = actorOf(session);
  const id = num(form.get("id"));
  const cert = await db.query.ldCertification.findFirst({ where: eq(ldCertification.id, id) });
  if (!cert) return fail("That certification no longer exists.");
  if (!can(session, "training.manage") && cert.employeeId !== session.employeeId) return fail("You can only remove your own certifications.");

  if (cert.documentId) {
    const doc = await db.query.appDocument.findFirst({ where: eq(appDocument.id, cert.documentId) });
    if (doc) await deleteDocument(doc);
  }
  await recordDeleted(actor, "ld_certification", await db.delete(ldCertification).where(eq(ldCertification.id, id)).returning());

  revalidateTraining();
  return OK;
}

export async function saveCertificationRequirement(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const actor = actorOf(await requirePermission("training.manage"));
  const jobCode = str(form.get("jobCode"));
  const name = str(form.get("name"));
  if (!jobCode || !name) return fail("Choose a job and name the certification.");

  const existing = await db.query.ldCertificationRequirement.findFirst({ where: and(eq(ldCertificationRequirement.jobCode, jobCode), eq(ldCertificationRequirement.name, name)) });
  if (existing) return fail("That job already requires this certification.");

  await recordCreated(actor, "ld_certification_requirement", await db.insert(ldCertificationRequirement).values({ jobCode, name }).returning());
  revalidateTraining();
  return OK;
}

export async function deleteCertificationRequirement(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const actor = actorOf(await requirePermission("training.manage"));
  const id = num(form.get("id"));
  await recordDeleted(actor, "ld_certification_requirement", await db.delete(ldCertificationRequirement).where(eq(ldCertificationRequirement.id, id)).returning());
  revalidateTraining();
  return OK;
}
