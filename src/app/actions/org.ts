"use server";

import { revalidatePath } from "next/cache";
import { eq, and, ne, count } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/access";
import { actorOf, audited, recordCreated, recordDeleted } from "@/lib/change-log";
import {
  omCompany,
  omLevelType,
  omJob,
  omJobFamily,
  omOrgUnit,
  omPosition,
  omReportingLine,
  pyPayrollPeriod,
  CENTRE_TYPES,
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

/**
 * Looser than `code`: cost centres are nodes now, and the ERP pushes codes
 * like `CC-MFG.01` through `upsertCostCentre`. One table, one accepted format.
 */
const nodeCode = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `Enter a ${label}.`)
    .max(40, `A ${label} cannot be longer than 40 characters.`)
    .regex(
      /^[A-Za-z0-9_.-]+$/,
      `A ${label} may use only letters, numbers, hyphens, dots and underscores.`,
    );

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
  currency: z
    .string()
    .trim()
    .regex(/^[A-Z]{3}$/, "A currency is its three-letter code, such as INR."),
  fiscalYearStart: z
    .string()
    .trim()
    .regex(/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, "A fiscal year starts on a date written MM-DD, such as 04-01."),
  /** The group node this legal entity sits under, where there is one. */
  parentNodeCode: z.string().trim().nullable(),
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
    currency: str(form.get("currency")).toUpperCase() || "INR",
    fiscalYearStart: str(form.get("fiscalYearStart")) || "04-01",
    parentNodeCode: optional(form.get("parentNodeCode")),
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

  const [units] = await db
    .select({ n: count() })
    .from(omOrgUnit)
    .where(eq(omOrgUnit.companyCode, c));
  if (units.n > 0) {
    return fail(
      `${c} still has ${units.n} org unit${units.n === 1 ? "" : "s"}. Remove or reassign them first.`,
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

/* ------------------------------------------------------- OM-02 level type */

const LevelTypeInput = z.object({
  code: code("level code"),
  name: label("level name"),
  parentLevelTypeCode: z.string().trim().nullable(),
  rank: z.number().int().min(0, "Rank cannot be negative.").max(99, "Rank cannot exceed 99."),
  isPayrollGroup: z.boolean(),
  isCalendarLevel: z.boolean(),
  isCostCentre: z.boolean(),
  isBusinessCentre: z.boolean(),
  isActive: z.boolean(),
});

/** Stops a level being made its own ancestor, the same way departments are checked. */
async function levelWouldCycle(childCode: string, parentCode: string): Promise<boolean> {
  let cursor: string | null = parentCode;
  const seen = new Set<string>();
  while (cursor) {
    if (cursor === childCode) return true;
    if (seen.has(cursor)) return true;
    seen.add(cursor);
    const row: { parentLevelTypeCode: string | null } | undefined =
      await db.query.omLevelType.findFirst({
        where: eq(omLevelType.code, cursor),
        columns: { parentLevelTypeCode: true },
      });
    cursor = row?.parentLevelTypeCode ?? null;
  }
  return false;
}

export async function saveLevelType(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const actor = actorOf(await requirePermission("org.edit"));
  const original = optional(form.get("originalCode"));

  const parsed = LevelTypeInput.safeParse({
    code: str(form.get("code")).toUpperCase(),
    name: str(form.get("name")),
    parentLevelTypeCode: optional(form.get("parentLevelTypeCode")),
    rank: Number(str(form.get("rank")) || "0"),
    isPayrollGroup: bool(form.get("isPayrollGroup")),
    isCalendarLevel: bool(form.get("isCalendarLevel")),
    isCostCentre: bool(form.get("isCostCentre")),
    isBusinessCentre: bool(form.get("isBusinessCentre")),
    isActive: bool(form.get("isActive")),
  });
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const v = parsed.data;

  if (v.parentLevelTypeCode === v.code) {
    return fail("A level cannot sit under itself.");
  }
  if (v.parentLevelTypeCode && (await levelWouldCycle(v.code, v.parentLevelTypeCode))) {
    return fail("That parent would create a loop in the level hierarchy.");
  }

  if (!original) {
    const [dupe] = await db
      .select({ n: count() })
      .from(omLevelType)
      .where(eq(omLevelType.code, v.code));
    if (dupe.n > 0) return fail(`Level ${v.code} already exists.`);
    await recordCreated(actor, "om_level_type", await db.insert(omLevelType).values(v).returning());
  } else {
    await audited(
      actor,
      { entity: "om_level_type", entityId: original },
      () => db.query.omLevelType.findFirst({ where: eq(omLevelType.code, original) }),
      () => db.update(omLevelType).set(v).where(eq(omLevelType.code, original)),
    );
  }

  revalidateOrg();
  return OK;
}

export async function deleteLevelType(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const actor = actorOf(await requirePermission("org.edit"));
  const c = str(form.get("code"));

  const [nodes] = await db
    .select({ n: count() })
    .from(omOrgUnit)
    .where(eq(omOrgUnit.levelTypeCode, c));
  if (nodes.n > 0) {
    return fail(
      `${c} is used by ${nodes.n} org unit${nodes.n === 1 ? "" : "s"}. Move them to another level first.`,
    );
  }
  const [children] = await db
    .select({ n: count() })
    .from(omLevelType)
    .where(eq(omLevelType.parentLevelTypeCode, c));
  if (children.n > 0) {
    return fail(
      `${children.n} level${children.n === 1 ? "" : "s"} sit${children.n === 1 ? "s" : ""} under ${c}. Reassign them first.`,
    );
  }

  await recordDeleted(
    actor,
    "om_level_type",
    await db.delete(omLevelType).where(eq(omLevelType.code, c)).returning(),
  );
  revalidateOrg();
  return OK;
}

/* ------------------------------------------------------- OM-03 job family */

const JobFamilyInput = z.object({
  code: code("job family code"),
  name: label("job family name"),
  isActive: z.boolean(),
});

export async function saveJobFamily(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const actor = actorOf(await requirePermission("org.edit"));
  const original = optional(form.get("originalCode"));

  const parsed = JobFamilyInput.safeParse({
    code: str(form.get("code")).toUpperCase(),
    name: str(form.get("name")),
    isActive: bool(form.get("isActive")),
  });
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const v = parsed.data;

  if (!original) {
    const [dupe] = await db
      .select({ n: count() })
      .from(omJobFamily)
      .where(eq(omJobFamily.code, v.code));
    if (dupe.n > 0) return fail(`Job family ${v.code} already exists.`);
    await recordCreated(actor, "om_job_family", await db.insert(omJobFamily).values(v).returning());
  } else {
    await audited(
      actor,
      { entity: "om_job_family", entityId: original },
      () => db.query.omJobFamily.findFirst({ where: eq(omJobFamily.code, original) }),
      () => db.update(omJobFamily).set(v).where(eq(omJobFamily.code, original)),
    );
  }

  revalidateOrg();
  return OK;
}

export async function deleteJobFamily(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const actor = actorOf(await requirePermission("org.edit"));
  const c = str(form.get("code"));

  const [jobs] = await db.select({ n: count() }).from(omJob).where(eq(omJob.jobFamilyCode, c));
  if (jobs.n > 0) {
    return fail(
      `${c} is used by ${jobs.n} job${jobs.n === 1 ? "" : "s"}. Reassign them first.`,
    );
  }

  await recordDeleted(
    actor,
    "om_job_family",
    await db.delete(omJobFamily).where(eq(omJobFamily.code, c)).returning(),
  );
  revalidateOrg();
  return OK;
}

/* --------------------------------------------------------------- OM-04 job */

const JobInput = z.object({
  code: code("job code"),
  title: label("job title"),
  jobFamilyCode: code("job family"),
  grade: z.string().trim().max(20).nullable(),
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
    jobFamilyCode: str(form.get("jobFamilyCode")),
    grade: optional(form.get("grade")),
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
  code: nodeCode("org unit code"),
  name: label("org unit name"),
  parentCode: z.string().trim().nullable(),
  /** Null for a group node sitting above the legal entities. */
  companyCode: z.string().trim().nullable(),
  levelTypeCode: code("level"),
  calendarCode: z.string().trim().nullable(),
  centreType: z.enum(CENTRE_TYPES).nullable(),
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
    companyCode: optional(form.get("companyCode")),
    levelTypeCode: str(form.get("levelTypeCode")),
    calendarCode: optional(form.get("calendarCode")),
    centreType: optional(form.get("centreType")),
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
    return fail("An org unit cannot sit under itself.");
  }
  if (v.parentCode && (await wouldCycle(v.code, v.parentCode))) {
    return fail("That parent would create a loop in the org tree.");
  }

  const level = await db.query.omLevelType.findFirst({
    where: eq(omLevelType.code, v.levelTypeCode),
  });
  if (!level) return fail(`Level ${v.levelTypeCode} does not exist.`);

  // "No orphans": a level that declares a parent level must be given a parent,
  // and that parent has to be the right level, active, and valid on the day
  // this unit starts.
  if (level.parentLevelTypeCode && v.parentCode === null) {
    return fail(`A ${level.name} must sit under a ${level.parentLevelTypeCode}.`);
  }
  if (v.parentCode) {
    const parent = await db.query.omOrgUnit.findFirst({
      where: eq(omOrgUnit.code, v.parentCode),
      columns: { levelTypeCode: true, isActive: true, validFrom: true, validTo: true },
    });
    if (!parent) return fail(`${v.parentCode} does not exist.`);
    if (level.parentLevelTypeCode) {
      const allowed = [level.parentLevelTypeCode, level.code];
      if (!allowed.includes(parent.levelTypeCode)) {
        return fail(
          `A ${level.name} may sit only under a ${level.parentLevelTypeCode} or another ${level.code}, and ${v.parentCode} is a ${parent.levelTypeCode}.`,
        );
      }
    }
    if (!parent.isActive) return fail(`${v.parentCode} is inactive, so nothing can be put under it.`);
    if (parent.validFrom > v.validFrom || parent.validTo < v.validFrom) {
      return fail(`${v.parentCode} is not valid on ${v.validFrom}, so nothing can start under it that day.`);
    }
  }

  // Payroll and cost-centre nodes resolve a GL company when pay is posted, so
  // they cannot be left on a group node that belongs to no legal entity.
  if ((level.isPayrollGroup || level.isCostCentre) && v.companyCode === null) {
    return fail(`A ${level.name} must belong to a company.`);
  }
  if (level.isCalendarLevel && v.calendarCode === null) {
    return fail(`A ${level.name} must have a holiday calendar.`);
  }
  if (!level.isCalendarLevel) v.calendarCode = null;
  if (level.isBusinessCentre && v.centreType === null) {
    return fail(`A ${level.name} must be either a profit centre or shared services.`);
  }
  if (!level.isBusinessCentre) v.centreType = null;

  // "Safe deactivation": nothing is switched off while live things hang off it.
  if (original && !v.isActive) {
    const [children, positions] = await Promise.all([
      db.select({ n: count() }).from(omOrgUnit).where(and(eq(omOrgUnit.parentCode, original), eq(omOrgUnit.isActive, true))),
      db.select({ n: count() }).from(omPosition).where(and(eq(omPosition.orgUnitCode, original), eq(omPosition.isActive, true))),
    ]);
    if (children[0].n > 0) {
      return fail(`${original} still has ${children[0].n} active org unit${children[0].n === 1 ? "" : "s"} under it. Move or deactivate them first.`);
    }
    if (positions[0].n > 0) {
      return fail(`${original} still holds ${positions[0].n} active position${positions[0].n === 1 ? "" : "s"}. Move or deactivate them first.`);
    }
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
      `${c} still has ${children.n} child org unit${children.n === 1 ? "" : "s"}. Move them first.`,
    );
  }
  const [companies] = await db
    .select({ n: count() })
    .from(omCompany)
    .where(eq(omCompany.parentNodeCode, c));
  if (companies.n > 0) {
    return fail(
      `${companies.n} compan${companies.n === 1 ? "y" : "ies"} sit${companies.n === 1 ? "s" : ""} under ${c}. Move them first.`,
    );
  }
  const [periods] = await db
    .select({ n: count() })
    .from(pyPayrollPeriod)
    .where(eq(pyPayrollPeriod.nodeCode, c));
  if (periods.n > 0) {
    return fail(
      `${c} has ${periods.n} payroll period${periods.n === 1 ? "" : "s"} against it. Those must stay for the record.`,
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
