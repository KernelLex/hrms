"use server";

import { revalidatePath } from "next/cache";
import { eq, and, ne, count } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/access";
import { actorOf, audited, recordCreated, recordDeleted } from "@/lib/change-log";
import {
  omCompany,
  omPersonnelArea,
  omPersonnelSubArea,
  omJob,
  omOrgUnit,
  omPosition,
  omReportingLine,
  OPEN_ENDED,
} from "@/db/schema";

/**
 * Org management CRUD.
 *
 * Every action re-checks the caller's role. Server Functions are reachable by
 * direct POST, not only through the UI, so the page that rendered the form is
 * never trusted.
 *
 * Deletes check for dependent rows in application code rather than relying on
 * a foreign key error. The constraint would only produce "FOREIGN KEY
 * constraint failed"; §8.12 asks an error to say what went wrong and what to do
 * next, which needs to name the thing that is still pointing at this record.
 */

export type ActionState = { error?: string; ok?: boolean };

const OK: ActionState = { ok: true };

function fail(error: string): ActionState {
  return { error };
}

/** Turns a zod failure into the first message, which is what the form shows. */
function firstIssue(err: z.ZodError): string {
  return err.issues[0]?.message ?? "Check the form and try again.";
}

function str(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v.trim() : "";
}

function optional(v: FormDataEntryValue | null): string | null {
  const s = str(v);
  return s.length > 0 ? s : null;
}

function bool(v: FormDataEntryValue | null): boolean {
  return v === "on" || v === "true" || v === "1";
}

const code = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `Enter a ${label}.`)
    .max(20, `A ${label} cannot be longer than 20 characters.`)
    .regex(/^[A-Za-z0-9_-]+$/, `A ${label} may use only letters, numbers, hyphens and underscores.`);

const label = (what: string) =>
  z.string().trim().min(1, `Enter a ${what}.`).max(120, `That ${what} is too long.`);

const dateish = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Dates must be in the form YYYY-MM-DD.");

function revalidateOrg() {
  revalidatePath("/org", "layout");
  revalidatePath("/");
}

/* ----------------------------------------------------------- OM-01 company */

const CompanyInput = z.object({
  code: code("company code"),
  name: label("company name"),
  address: z.string().trim().max(200).nullable(),
  city: z.string().trim().max(80).nullable(),
  country: z.string().trim().max(80).nullable(),
  isActive: z.boolean(),
});

export async function saveCompany(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const actor = actorOf(await requirePermission("org.edit"));
  const original = optional(form.get("originalCode"));

  const parsed = CompanyInput.safeParse({
    code: str(form.get("code")).toUpperCase(),
    name: str(form.get("name")),
    address: optional(form.get("address")),
    city: optional(form.get("city")),
    country: optional(form.get("country")),
    isActive: bool(form.get("isActive")),
  });
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const v = parsed.data;

  if (!original) {
    const [dupe] = await db
      .select({ n: count() })
      .from(omCompany)
      .where(eq(omCompany.code, v.code));
    if (dupe.n > 0) return fail(`Company ${v.code} already exists.`);
    await recordCreated(actor, "om_company", await db.insert(omCompany).values(v).returning());
  } else {
    await audited(
      actor,
      { entity: "om_company", entityId: original },
      () => db.query.omCompany.findFirst({ where: eq(omCompany.code, original) }),
      () => db.update(omCompany).set(v).where(eq(omCompany.code, original)),
    );
  }

  revalidateOrg();
  return OK;
}

export async function deleteCompany(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const actor = actorOf(await requirePermission("org.edit"));
  const c = str(form.get("code"));

  const [areas] = await db
    .select({ n: count() })
    .from(omPersonnelArea)
    .where(eq(omPersonnelArea.companyCode, c));
  if (areas.n > 0) {
    return fail(
      `${c} still has ${areas.n} personnel area${areas.n === 1 ? "" : "s"}. Remove or reassign them first.`,
    );
  }
  const [units] = await db
    .select({ n: count() })
    .from(omOrgUnit)
    .where(eq(omOrgUnit.companyCode, c));
  if (units.n > 0) {
    return fail(
      `${c} still has ${units.n} department${units.n === 1 ? "" : "s"}. Remove or reassign them first.`,
    );
  }

  await recordDeleted(
    actor,
    "om_company",
    await db.delete(omCompany).where(eq(omCompany.code, c)).returning(),
  );
  revalidateOrg();
  return OK;
}

/* ----------------------------------------------------- OM-02 personnel area */

const AreaInput = z.object({
  code: code("area code"),
  companyCode: code("company"),
  name: label("area name"),
  location: z.string().trim().max(120).nullable(),
  isActive: z.boolean(),
});

export async function saveArea(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const actor = actorOf(await requirePermission("org.edit"));
  const original = optional(form.get("originalCode"));

  const parsed = AreaInput.safeParse({
    code: str(form.get("code")).toUpperCase(),
    companyCode: str(form.get("companyCode")),
    name: str(form.get("name")),
    location: optional(form.get("location")),
    isActive: bool(form.get("isActive")),
  });
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const v = parsed.data;

  if (!original) {
    const [dupe] = await db
      .select({ n: count() })
      .from(omPersonnelArea)
      .where(eq(omPersonnelArea.code, v.code));
    if (dupe.n > 0) return fail(`Personnel area ${v.code} already exists.`);
    await recordCreated(
      actor,
      "om_personnel_area",
      await db.insert(omPersonnelArea).values(v).returning(),
    );
  } else {
    await audited(
      actor,
      { entity: "om_personnel_area", entityId: original },
      () => db.query.omPersonnelArea.findFirst({ where: eq(omPersonnelArea.code, original) }),
      () => db.update(omPersonnelArea).set(v).where(eq(omPersonnelArea.code, original)),
    );
  }

  revalidateOrg();
  return OK;
}

export async function deleteArea(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const actor = actorOf(await requirePermission("org.edit"));
  const c = str(form.get("code"));

  const [subs] = await db
    .select({ n: count() })
    .from(omPersonnelSubArea)
    .where(eq(omPersonnelSubArea.areaCode, c));
  if (subs.n > 0) {
    return fail(
      `${c} still has ${subs.n} sub-area${subs.n === 1 ? "" : "s"}. Remove them first.`,
    );
  }

  await recordDeleted(
    actor,
    "om_personnel_area",
    await db.delete(omPersonnelArea).where(eq(omPersonnelArea.code, c)).returning(),
  );
  revalidateOrg();
  return OK;
}

/* ------------------------------------------------- OM-03 personnel sub-area */

const SubAreaInput = z.object({
  code: code("sub-area code"),
  areaCode: code("personnel area"),
  name: label("sub-area name"),
  isActive: z.boolean(),
});

export async function saveSubArea(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const actor = actorOf(await requirePermission("org.edit"));
  const original = optional(form.get("originalCode"));

  const parsed = SubAreaInput.safeParse({
    code: str(form.get("code")).toUpperCase(),
    areaCode: str(form.get("areaCode")),
    name: str(form.get("name")),
    isActive: bool(form.get("isActive")),
  });
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const v = parsed.data;

  if (!original) {
    const [dupe] = await db
      .select({ n: count() })
      .from(omPersonnelSubArea)
      .where(eq(omPersonnelSubArea.code, v.code));
    if (dupe.n > 0) return fail(`Sub-area ${v.code} already exists.`);
    await recordCreated(
      actor,
      "om_personnel_sub_area",
      await db.insert(omPersonnelSubArea).values(v).returning(),
    );
  } else {
    await audited(
      actor,
      { entity: "om_personnel_sub_area", entityId: original },
      () => db.query.omPersonnelSubArea.findFirst({ where: eq(omPersonnelSubArea.code, original) }),
      () => db.update(omPersonnelSubArea).set(v).where(eq(omPersonnelSubArea.code, original)),
    );
  }

  revalidateOrg();
  return OK;
}

export async function deleteSubArea(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const actor = actorOf(await requirePermission("org.edit"));
  const c = str(form.get("code"));
  await recordDeleted(
    actor,
    "om_personnel_sub_area",
    await db.delete(omPersonnelSubArea).where(eq(omPersonnelSubArea.code, c)).returning(),
  );
  revalidateOrg();
  return OK;
}

/* --------------------------------------------------------------- OM-04 job */

const JobInput = z.object({
  code: code("job code"),
  title: label("job title"),
  jobGroup: z.string().trim().max(60).nullable(),
  description: z.string().trim().max(200).nullable(),
  isActive: z.boolean(),
});

export async function saveJob(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const actor = actorOf(await requirePermission("org.edit"));
  const original = optional(form.get("originalCode"));

  const parsed = JobInput.safeParse({
    code: str(form.get("code")).toUpperCase(),
    title: str(form.get("title")),
    jobGroup: optional(form.get("jobGroup")),
    description: optional(form.get("description")),
    isActive: bool(form.get("isActive")),
  });
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const v = parsed.data;

  if (!original) {
    const [dupe] = await db.select({ n: count() }).from(omJob).where(eq(omJob.code, v.code));
    if (dupe.n > 0) return fail(`Job ${v.code} already exists.`);
    await recordCreated(actor, "om_job", await db.insert(omJob).values(v).returning());
  } else {
    await audited(
      actor,
      { entity: "om_job", entityId: original },
      () => db.query.omJob.findFirst({ where: eq(omJob.code, original) }),
      () => db.update(omJob).set(v).where(eq(omJob.code, original)),
    );
  }

  revalidateOrg();
  return OK;
}

export async function deleteJob(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const actor = actorOf(await requirePermission("org.edit"));
  const c = str(form.get("code"));

  const [positions] = await db
    .select({ n: count() })
    .from(omPosition)
    .where(eq(omPosition.jobCode, c));
  if (positions.n > 0) {
    return fail(
      `${c} is used by ${positions.n} position${positions.n === 1 ? "" : "s"}. Reassign them first.`,
    );
  }

  await recordDeleted(actor, "om_job", await db.delete(omJob).where(eq(omJob.code, c)).returning());
  revalidateOrg();
  return OK;
}

/* ---------------------------------------------------------- OM-05 org unit */

const OrgUnitInput = z.object({
  code: code("org unit code"),
  name: label("org unit name"),
  parentCode: z.string().trim().nullable(),
  companyCode: code("company"),
  areaCode: z.string().trim().nullable(),
  validFrom: dateish,
  validTo: dateish,
  isActive: z.boolean(),
});

/** Walks up the parent chain to stop a department being made its own ancestor. */
async function wouldCycle(childCode: string, parentCode: string): Promise<boolean> {
  let cursor: string | null = parentCode;
  const seen = new Set<string>();
  while (cursor) {
    if (cursor === childCode) return true;
    if (seen.has(cursor)) return true;
    seen.add(cursor);
    const row: { parentCode: string | null } | undefined = await db.query.omOrgUnit.findFirst({
      where: eq(omOrgUnit.code, cursor),
      columns: { parentCode: true },
    });
    cursor = row?.parentCode ?? null;
  }
  return false;
}

export async function saveOrgUnit(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const actor = actorOf(await requirePermission("org.edit"));
  const original = optional(form.get("originalCode"));

  const parsed = OrgUnitInput.safeParse({
    code: str(form.get("code")).toUpperCase(),
    name: str(form.get("name")),
    parentCode: optional(form.get("parentCode")),
    companyCode: str(form.get("companyCode")),
    areaCode: optional(form.get("areaCode")),
    validFrom: str(form.get("validFrom")),
    validTo: str(form.get("validTo")) || OPEN_ENDED,
    isActive: bool(form.get("isActive")),
  });
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const v = parsed.data;

  if (v.validTo < v.validFrom) {
    return fail("Valid to cannot fall before valid from.");
  }
  if (v.parentCode === v.code) {
    return fail("A department cannot report to itself.");
  }
  if (v.parentCode && (await wouldCycle(v.code, v.parentCode))) {
    return fail("That parent would create a loop in the department tree.");
  }

  if (!original) {
    const [dupe] = await db
      .select({ n: count() })
      .from(omOrgUnit)
      .where(eq(omOrgUnit.code, v.code));
    if (dupe.n > 0) return fail(`Department ${v.code} already exists.`);
    await recordCreated(actor, "om_org_unit", await db.insert(omOrgUnit).values(v).returning());
  } else {
    await audited(
      actor,
      { entity: "om_org_unit", entityId: original },
      () => db.query.omOrgUnit.findFirst({ where: eq(omOrgUnit.code, original) }),
      () => db.update(omOrgUnit).set(v).where(eq(omOrgUnit.code, original)),
    );
  }

  revalidateOrg();
  return OK;
}

export async function deleteOrgUnit(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const actor = actorOf(await requirePermission("org.edit"));
  const c = str(form.get("code"));

  const [children] = await db
    .select({ n: count() })
    .from(omOrgUnit)
    .where(eq(omOrgUnit.parentCode, c));
  if (children.n > 0) {
    return fail(
      `${c} still has ${children.n} child department${children.n === 1 ? "" : "s"}. Move them first.`,
    );
  }
  const [positions] = await db
    .select({ n: count() })
    .from(omPosition)
    .where(eq(omPosition.orgUnitCode, c));
  if (positions.n > 0) {
    return fail(
      `${c} still holds ${positions.n} position${positions.n === 1 ? "" : "s"}. Move them first.`,
    );
  }

  await recordDeleted(
    actor,
    "om_org_unit",
    await db.delete(omOrgUnit).where(eq(omOrgUnit.code, c)).returning(),
  );
  revalidateOrg();
  return OK;
}

/* ---------------------------------------------------------- OM-06 position */

const PositionInput = z.object({
  code: code("position code"),
  title: label("position title"),
  orgUnitCode: code("department"),
  jobCode: code("job"),
  reportsToCode: z.string().trim().nullable(),
  isManager: z.boolean(),
  isVacant: z.boolean(),
  validFrom: dateish,
  validTo: dateish,
  isActive: z.boolean(),
});

async function positionWouldCycle(childCode: string, parentCode: string): Promise<boolean> {
  let cursor: string | null = parentCode;
  const seen = new Set<string>();
  while (cursor) {
    if (cursor === childCode) return true;
    if (seen.has(cursor)) return true;
    seen.add(cursor);
    const row: { reportsToCode: string | null } | undefined =
      await db.query.omPosition.findFirst({
        where: eq(omPosition.code, cursor),
        columns: { reportsToCode: true },
      });
    cursor = row?.reportsToCode ?? null;
  }
  return false;
}

export async function savePosition(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const actor = actorOf(await requirePermission("org.edit"));
  const original = optional(form.get("originalCode"));

  const parsed = PositionInput.safeParse({
    code: str(form.get("code")).toUpperCase(),
    title: str(form.get("title")),
    orgUnitCode: str(form.get("orgUnitCode")),
    jobCode: str(form.get("jobCode")),
    reportsToCode: optional(form.get("reportsToCode")),
    isManager: bool(form.get("isManager")),
    isVacant: bool(form.get("isVacant")),
    validFrom: str(form.get("validFrom")),
    validTo: str(form.get("validTo")) || OPEN_ENDED,
    isActive: bool(form.get("isActive")),
  });
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const v = parsed.data;

  if (v.validTo < v.validFrom) {
    return fail("Valid to cannot fall before valid from.");
  }
  if (v.reportsToCode === v.code) {
    return fail("A position cannot report to itself.");
  }
  if (v.reportsToCode && (await positionWouldCycle(v.code, v.reportsToCode))) {
    return fail("That reporting line would create a loop.");
  }

  if (!original) {
    const [dupe] = await db
      .select({ n: count() })
      .from(omPosition)
      .where(eq(omPosition.code, v.code));
    if (dupe.n > 0) return fail(`Position ${v.code} already exists.`);
    await recordCreated(actor, "om_position", await db.insert(omPosition).values(v).returning());
  } else {
    await audited(
      actor,
      { entity: "om_position", entityId: original },
      () => db.query.omPosition.findFirst({ where: eq(omPosition.code, original) }),
      () => db.update(omPosition).set(v).where(eq(omPosition.code, original)),
    );
  }

  revalidateOrg();
  return OK;
}

export async function deletePosition(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const actor = actorOf(await requirePermission("org.edit"));
  const c = str(form.get("code"));

  const [reports] = await db
    .select({ n: count() })
    .from(omPosition)
    .where(eq(omPosition.reportsToCode, c));
  if (reports.n > 0) {
    return fail(
      `${reports.n} position${reports.n === 1 ? "" : "s"} report${reports.n === 1 ? "s" : ""} to ${c}. Reassign them first.`,
    );
  }

  await recordDeleted(
    actor,
    "om_reporting_line",
    await db.delete(omReportingLine).where(eq(omReportingLine.positionCode, c)).returning(),
  );
  await recordDeleted(
    actor,
    "om_position",
    await db.delete(omPosition).where(eq(omPosition.code, c)).returning(),
  );
  revalidateOrg();
  return OK;
}

/* ---------------------------------------------------- OM-07 reporting line */

const ReportingLineInput = z.object({
  positionCode: code("position"),
  reportsToCode: code("manager position"),
  effectiveFrom: dateish,
  remarks: z.string().trim().max(200).nullable(),
});

/**
 * Recording a reporting line is the transaction OM-07 exists for: it writes the
 * history row and moves the live pointer on the position together.
 */
export async function saveReportingLine(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const actor = actorOf(await requirePermission("org.edit"));

  const parsed = ReportingLineInput.safeParse({
    positionCode: str(form.get("positionCode")),
    reportsToCode: str(form.get("reportsToCode")),
    effectiveFrom: str(form.get("effectiveFrom")),
    remarks: optional(form.get("remarks")),
  });
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const v = parsed.data;

  if (v.positionCode === v.reportsToCode) {
    return fail("A position cannot report to itself.");
  }
  if (await positionWouldCycle(v.positionCode, v.reportsToCode)) {
    return fail("That reporting line would create a loop.");
  }

  await recordCreated(
    actor,
    "om_reporting_line",
    await db.insert(omReportingLine).values(v).returning(),
  );
  await audited(
    actor,
    { entity: "om_position", entityId: v.positionCode },
    () => db.query.omPosition.findFirst({ where: eq(omPosition.code, v.positionCode) }),
    () =>
      db
        .update(omPosition)
        .set({ reportsToCode: v.reportsToCode })
        .where(eq(omPosition.code, v.positionCode)),
  );

  revalidateOrg();
  return OK;
}

export async function deleteReportingLine(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const actor = actorOf(await requirePermission("org.edit"));
  const id = Number(str(form.get("id")));
  if (!Number.isInteger(id)) return fail("That reporting line could not be identified.");

  const row = await db.query.omReportingLine.findFirst({
    where: eq(omReportingLine.id, id),
  });
  if (!row) return fail("That reporting line no longer exists.");

  await recordDeleted(
    actor,
    "om_reporting_line",
    await db.delete(omReportingLine).where(eq(omReportingLine.id, id)).returning(),
  );

  // Fall back to the most recent remaining line for this position, if any.
  const remaining = await db.query.omReportingLine.findMany({
    where: and(
      eq(omReportingLine.positionCode, row.positionCode),
      ne(omReportingLine.id, id),
    ),
  });
  const latest = remaining.sort((a, b) =>
    a.effectiveFrom < b.effectiveFrom ? 1 : -1,
  )[0];
  await audited(
    actor,
    { entity: "om_position", entityId: row.positionCode },
    () => db.query.omPosition.findFirst({ where: eq(omPosition.code, row.positionCode) }),
    () =>
      db
        .update(omPosition)
        .set({ reportsToCode: latest?.reportsToCode ?? null })
        .where(eq(omPosition.code, row.positionCode)),
  );

  revalidateOrg();
  return OK;
}
