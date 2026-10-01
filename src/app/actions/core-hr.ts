"use server";

import { revalidatePath } from "next/cache";
import { eq, desc } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { can, inScope, requirePermission, type Access } from "@/lib/access";
import {
  paEmployee,
  paOrgAssignment,
  paPlannedWorkingTime,
  paBasicPay,
  paAddress,
  paFamilyMember,
  paCommunication,
  omPosition,
  OPEN_ENDED,
  now,
  today,
} from "@/db/schema";
import { saveTimeSlice, deleteTimeSlice, SLICED_TABLES } from "@/lib/engines/timeslice";
import { actorOf, audited, recordCreate, recordDelete } from "@/lib/change-log";
import { toPaise } from "@/lib/money";
import { hire } from "@/lib/services/people";

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

const dateish = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Dates must be in the form YYYY-MM-DD.");

function revalidateEmployee(id?: number) {
  revalidatePath("/core-hr", "layout");
  if (id) revalidatePath(`/core-hr/${id}`, "layout");
  revalidatePath("/");
}

/* ------------------------------------------------------- CH-01 hire action */

const HireInput = z.object({
  actionType: z.string().min(1),
  effectiveDate: dateish,
  reason: z.string().nullable(),
  companyCode: z.string().min(1, "Choose a company."),
  areaCode: z.string().nullable(),
  orgUnitCode: z.string().min(1, "Choose a department."),
  positionCode: z.string().min(1, "Choose a position."),
  costCenter: z.string().nullable(),
  firstName: z.string().min(1, "Enter a first name."),
  lastName: z.string().min(1, "Enter a last name."),
  dateOfBirth: z.string().nullable(),
  gender: z.string().nullable(),
  payScaleGroup: z.string().nullable(),
  amount: z.number().positive("Enter a basic salary above zero."),
  currency: z.string().min(1),
  workScheduleCode: z.string().min(1),
});

/**
 * The hire action, equivalent to SAP's PA40.
 *
 * A hire is not one insert. It creates the employee and the chain of infotypes
 * that must exist for payroll to run, and it marks the position occupied — all
 * or nothing, so a half-hired person can never exist.
 */
export async function hireEmployee(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requirePermission("employee.edit", "pay.view");

  const parsed = HireInput.safeParse({
    actionType: str(form.get("actionType")) || "Hire",
    effectiveDate: str(form.get("effectiveDate")),
    reason: opt(form.get("reason")),
    companyCode: str(form.get("companyCode")),
    areaCode: opt(form.get("areaCode")),
    orgUnitCode: str(form.get("orgUnitCode")),
    positionCode: str(form.get("positionCode")),
    costCenter: opt(form.get("costCenter")),
    firstName: str(form.get("firstName")),
    lastName: str(form.get("lastName")),
    dateOfBirth: opt(form.get("dateOfBirth")),
    gender: opt(form.get("gender")),
    payScaleGroup: opt(form.get("payScaleGroup")),
    amount: num(form.get("amount")),
    currency: str(form.get("currency")) || "INR",
    workScheduleCode: str(form.get("workScheduleCode")) || "WS01",
  });
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const v = parsed.data;

  const hired = await hire(
    actorOf(session),
    { ...v, amountPaise: toPaise(v.amount) },
    session.username,
  );
  if (!hired.ok) return fail(hired.error);
  const employeeId = hired.value.employeeId;

  revalidateEmployee(employeeId);
  revalidatePath("/org", "layout");
  return { ok: true, employeeId };
}

/* --------------------------------------------- CH-02 maintain master data */

/**
 * What stops a change to one person's record: someone outside the role's
 * companies or areas, or pay and bank details for a role that may not see
 * them. Null when the change may go ahead.
 */
async function guardEmployee(access: Access, employeeId: number, infotype?: string): Promise<string | null> {
  if (!(await inScope(access, employeeId))) {
    return "That employee is outside the companies and areas your role covers.";
  }
  if (infotype === "0008" && !can(access, "pay.view")) {
    return "Changing basic pay needs permission to see pay.";
  }
  if (infotype === "0009" && !can(access, "bank.view")) {
    return "Changing bank details needs permission to see them.";
  }
  if (infotype === "0011" && !can(access, "pay.view")) {
    return "Changing statutory details needs permission to see pay.";
  }
  return null;
}

/** Infotypes that hold one valid record at a time, written through the engine. */
const SLICED_FORMS = {
  "0001": {
    table: SLICED_TABLES.orgAssignment,
    schema: z.object({
      companyCode: z.string().min(1, "Choose a company."),
      areaCode: z.string().nullable(),
      subAreaCode: z.string().nullable(),
      orgUnitCode: z.string().min(1, "Choose a department."),
      positionCode: z.string().min(1, "Choose a position."),
      costCenter: z.string().nullable(),
    }),
    columns: (v: Record<string, unknown>) => ({
      company_code: v.companyCode as string,
      area_code: v.areaCode as string | null,
      sub_area_code: v.subAreaCode as string | null,
      org_unit_code: v.orgUnitCode as string,
      position_code: v.positionCode as string,
      cost_center: v.costCenter as string | null,
    }),
  },
  "0002": {
    table: SLICED_TABLES.personalData,
    schema: z.object({
      firstName: z.string().min(1, "Enter a first name."),
      lastName: z.string().min(1, "Enter a last name."),
      dateOfBirth: z.string().nullable(),
      gender: z.string().nullable(),
      maritalStatus: z.string().nullable(),
      nationality: z.string().nullable(),
    }),
    columns: (v: Record<string, unknown>) => ({
      first_name: v.firstName as string,
      last_name: v.lastName as string,
      date_of_birth: v.dateOfBirth as string | null,
      gender: v.gender as string | null,
      marital_status: v.maritalStatus as string | null,
      nationality: v.nationality as string | null,
    }),
  },
  "0007": {
    table: SLICED_TABLES.plannedWorkingTime,
    schema: z.object({
      workScheduleCode: z.string().min(1, "Choose a work schedule."),
      weeklyHours: z.number().min(1).max(80),
      employmentPercent: z.number().min(1).max(100),
    }),
    columns: (v: Record<string, unknown>) => ({
      work_schedule_code: v.workScheduleCode as string,
      weekly_hours: v.weeklyHours as number,
      employment_percent: v.employmentPercent as number,
    }),
  },
  "0008": {
    table: SLICED_TABLES.basicPay,
    schema: z.object({
      payScaleType: z.string().nullable(),
      payScaleArea: z.string().nullable(),
      payScaleGroup: z.string().nullable(),
      amount: z.number().positive("Enter a basic salary above zero."),
      currency: z.string().min(1),
    }),
    columns: (v: Record<string, unknown>) => ({
      pay_scale_type: v.payScaleType as string | null,
      pay_scale_area: v.payScaleArea as string | null,
      pay_scale_group: v.payScaleGroup as string | null,
      amount_paise: toPaise(v.amount as number),
      currency: v.currency as string,
    }),
  },
  "0009": {
    table: SLICED_TABLES.bankDetails,
    schema: z.object({
      bankName: z.string().min(1, "Enter a bank name."),
      accountNumber: z.string().min(1, "Enter an account number."),
      ifsc: z.string().nullable(),
      holderName: z.string().nullable(),
    }),
    columns: (v: Record<string, unknown>) => ({
      bank_name: v.bankName as string,
      account_number: v.accountNumber as string,
      ifsc: v.ifsc as string | null,
      holder_name: v.holderName as string | null,
    }),
  },
  "0011": {
    table: SLICED_TABLES.statutoryDetails,
    schema: z.object({
      uan: z.string().nullable(),
      esiNumber: z.string().nullable(),
      professionalTaxState: z.string().nullable(),
    }),
    columns: (v: Record<string, unknown>) => ({
      uan: v.uan as string | null,
      esi_number: v.esiNumber as string | null,
      professional_tax_state: v.professionalTaxState ? (v.professionalTaxState as string).toUpperCase() : null,
    }),
  },
} as const;

export type SlicedInfotype = keyof typeof SLICED_FORMS;

function readSliced(code: SlicedInfotype, form: FormData) {
  switch (code) {
    case "0001":
      return {
        companyCode: str(form.get("companyCode")),
        areaCode: opt(form.get("areaCode")),
        subAreaCode: opt(form.get("subAreaCode")),
        orgUnitCode: str(form.get("orgUnitCode")),
        positionCode: str(form.get("positionCode")),
        costCenter: opt(form.get("costCenter")),
      };
    case "0002":
      return {
        firstName: str(form.get("firstName")),
        lastName: str(form.get("lastName")),
        dateOfBirth: opt(form.get("dateOfBirth")),
        gender: opt(form.get("gender")),
        maritalStatus: opt(form.get("maritalStatus")),
        nationality: opt(form.get("nationality")),
      };
    case "0007":
      return {
        workScheduleCode: str(form.get("workScheduleCode")),
        weeklyHours: num(form.get("weeklyHours")),
        employmentPercent: num(form.get("employmentPercent")),
      };
    case "0008":
      return {
        payScaleType: opt(form.get("payScaleType")),
        payScaleArea: opt(form.get("payScaleArea")),
        payScaleGroup: opt(form.get("payScaleGroup")),
        amount: num(form.get("amount")),
        currency: str(form.get("currency")) || "INR",
      };
    case "0009":
      return {
        bankName: str(form.get("bankName")),
        accountNumber: str(form.get("accountNumber")),
        ifsc: opt(form.get("ifsc")),
        holderName: opt(form.get("holderName")),
      };
    case "0011":
      return {
        uan: opt(form.get("uan")),
        esiNumber: opt(form.get("esiNumber")),
        professionalTaxState: opt(form.get("professionalTaxState")),
      };
  }
}

export async function saveInfotypeSlice(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requirePermission("employee.edit");

  const employeeId = num(form.get("employeeId"));
  const code = str(form.get("infotype")) as SlicedInfotype;
  const config = SLICED_FORMS[code];
  if (!config) return fail("That infotype is not recognised.");

  const validFrom = str(form.get("validFrom"));
  const validTo = str(form.get("validTo")) || OPEN_ENDED;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(validFrom)) {
    return fail("Enter a valid-from date.");
  }
  if (validTo < validFrom) return fail("Valid to cannot fall before valid from.");

  const guard = await guardEmployee(session, employeeId, code);
  if (guard) return fail(guard);

  const parsed = config.schema.safeParse(readSliced(code, form));
  if (!parsed.success) return fail(firstIssue(parsed.error));

  try {
    await saveTimeSlice({
      table: config.table,
      employeeId,
      validFrom,
      validTo,
      data: config.columns(parsed.data as Record<string, unknown>),
      createdBy: session.username,
      actor: actorOf(session),
    });
  } catch (err) {
    return fail(err instanceof Error ? err.message : "That record could not be saved.");
  }

  revalidateEmployee(employeeId);
  return OK;
}

export async function deleteInfotypeSlice(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requirePermission("employee.edit");
  const employeeId = num(form.get("employeeId"));
  const code = str(form.get("infotype")) as SlicedInfotype;
  const id = num(form.get("id"));
  const config = SLICED_FORMS[code];
  if (!config) return fail("That infotype is not recognised.");
  const guard = await guardEmployee(session, employeeId, code);
  if (guard) return fail(guard);

  const removed = await deleteTimeSlice(config.table, id, actorOf(session));
  if (!removed) return fail("That record no longer exists.");

  revalidateEmployee(employeeId);
  return OK;
}

/* ----------------------------------- repeating infotypes (0006/0021/0105) */

/**
 * Addresses, family members and contact details are repeating: an employee has
 * several at once, so they are not delimited against each other.
 */
export async function saveRepeatingInfotype(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requirePermission("employee.edit");
  const employeeId = num(form.get("employeeId"));
  const code = str(form.get("infotype"));
  const id = opt(form.get("id"));
  const createdAt = now();
  const validFrom = str(form.get("validFrom")) || today();
  const actor = actorOf(session);
  const guard = await guardEmployee(session, employeeId);
  if (guard) return fail(guard);

  const base = {
    employeeId,
    validFrom,
    validTo: OPEN_ENDED,
    seq: 1,
    createdBy: session.username,
    createdAt,
  };

  try {
    if (code === "0006") {
      const line = str(form.get("line"));
      if (!line) return fail("Enter an address line.");
      const values = {
        ...base,
        addressType: str(form.get("addressType")) || "Permanent",
        line,
        city: opt(form.get("city")),
        state: opt(form.get("state")),
        postalCode: opt(form.get("postalCode")),
        country: opt(form.get("country")),
      };
      if (id) {
        await audited(
          actor,
          { entity: "pa_it0006_address", entityId: Number(id), subjectEmployeeId: employeeId },
          () => db.query.paAddress.findFirst({ where: eq(paAddress.id, Number(id)) }),
          () => db.update(paAddress).set(values).where(eq(paAddress.id, Number(id))),
        );
      } else {
        const [row] = await db.insert(paAddress).values(values).returning();
        await recordCreate(actor, "pa_it0006_address", row.id, row, employeeId);
      }
    } else if (code === "0021") {
      const name = str(form.get("name"));
      if (!name) return fail("Enter a name.");
      const values = {
        ...base,
        relationship: str(form.get("relationship")) || "Spouse",
        name,
        dateOfBirth: opt(form.get("dateOfBirth")),
      };
      if (id) {
        await audited(
          actor,
          { entity: "pa_it0021_family_member", entityId: Number(id), subjectEmployeeId: employeeId },
          () => db.query.paFamilyMember.findFirst({ where: eq(paFamilyMember.id, Number(id)) }),
          () => db.update(paFamilyMember).set(values).where(eq(paFamilyMember.id, Number(id))),
        );
      } else {
        const [row] = await db.insert(paFamilyMember).values(values).returning();
        await recordCreate(actor, "pa_it0021_family_member", row.id, row, employeeId);
      }
    } else if (code === "0105") {
      const value = str(form.get("value"));
      if (!value) return fail("Enter a value.");
      const values = {
        ...base,
        commType: str(form.get("commType")) || "Email (official)",
        value,
      };
      if (id) {
        await audited(
          actor,
          { entity: "pa_it0105_communication", entityId: Number(id), subjectEmployeeId: employeeId },
          () => db.query.paCommunication.findFirst({ where: eq(paCommunication.id, Number(id)) }),
          () => db.update(paCommunication).set(values).where(eq(paCommunication.id, Number(id))),
        );
      } else {
        const [row] = await db.insert(paCommunication).values(values).returning();
        await recordCreate(actor, "pa_it0105_communication", row.id, row, employeeId);
      }
    } else {
      return fail("That infotype is not recognised.");
    }
  } catch (err) {
    return fail(err instanceof Error ? err.message : "That record could not be saved.");
  }

  revalidateEmployee(employeeId);
  return OK;
}

export async function deleteRepeatingInfotype(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requirePermission("employee.edit");
  const employeeId = num(form.get("employeeId"));
  const code = str(form.get("infotype"));
  const id = num(form.get("id"));
  const actor = actorOf(session);
  const guard = await guardEmployee(session, employeeId);
  if (guard) return fail(guard);

  if (code === "0006") {
    const [row] = await db.delete(paAddress).where(eq(paAddress.id, id)).returning();
    if (row) await recordDelete(actor, "pa_it0006_address", id, row, row.employeeId);
  } else if (code === "0021") {
    const [row] = await db.delete(paFamilyMember).where(eq(paFamilyMember.id, id)).returning();
    if (row) await recordDelete(actor, "pa_it0021_family_member", id, row, row.employeeId);
  } else if (code === "0105") {
    const [row] = await db.delete(paCommunication).where(eq(paCommunication.id, id)).returning();
    if (row) await recordDelete(actor, "pa_it0105_communication", id, row, row.employeeId);
  } else return fail("That infotype is not recognised.");

  revalidateEmployee(employeeId);
  return OK;
}

/* ---------------------------------------------- CH-05 mass data maintenance */

/**
 * Applies one change to many employees at once, each through the time-slice
 * engine — so a mass update leaves the same clean history a single edit does.
 */
export async function massUpdate(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requirePermission("employee.edit");

  const field = str(form.get("field"));
  const value = str(form.get("newValue"));
  const effectiveDate = str(form.get("effectiveDate"));
  const ids = form
    .getAll("employeeIds")
    .map((v) => Number(v))
    .filter((n) => Number.isInteger(n) && n > 0);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) return fail("Enter an effective date.");
  if (ids.length === 0) return fail("Select at least one employee.");
  if (!value) return fail("Enter the new value.");
  if ((field === "payScaleGroup" || field === "amount") && !can(session, "pay.view")) {
    return fail("Changing pay needs permission to see pay.");
  }
  for (const employeeId of ids) {
    const guard = await guardEmployee(session, employeeId);
    if (guard) return fail(guard);
  }

  const actor = actorOf(session);
  const reason = `Mass update of ${ids.length} ${ids.length === 1 ? "employee" : "employees"}`;
  let applied = 0;
  for (const employeeId of ids) {
    if (field === "payScaleGroup" || field === "amount") {
      const current = await db.query.paBasicPay.findFirst({
        where: eq(paBasicPay.employeeId, employeeId),
        orderBy: [desc(paBasicPay.validFrom)],
      });
      if (!current) continue;
      await saveTimeSlice({
        table: SLICED_TABLES.basicPay,
        employeeId,
        validFrom: effectiveDate,
        data: {
          pay_scale_type: current.payScaleType,
          pay_scale_area: current.payScaleArea,
          pay_scale_group: field === "payScaleGroup" ? value : current.payScaleGroup,
          amount_paise: field === "amount" ? toPaise(value) : current.amountPaise,
          currency: current.currency,
        },
        createdBy: session.username,
        actor,
        reason,
      });
      applied += 1;
    } else if (field === "workScheduleCode") {
      const current = await db.query.paPlannedWorkingTime.findFirst({
        where: eq(paPlannedWorkingTime.employeeId, employeeId),
        orderBy: [desc(paPlannedWorkingTime.validFrom)],
      });
      if (!current) continue;
      await saveTimeSlice({
        table: SLICED_TABLES.plannedWorkingTime,
        employeeId,
        validFrom: effectiveDate,
        data: {
          work_schedule_code: value,
          weekly_hours: current.weeklyHours,
          employment_percent: current.employmentPercent,
        },
        createdBy: session.username,
        actor,
        reason,
      });
      applied += 1;
    } else {
      return fail("That field cannot be mass updated.");
    }
  }

  revalidateEmployee();
  if (applied === 0) {
    return fail("None of the selected employees had a record to update.");
  }
  return OK;
}

/* -------------------------------------------------------------- utilities */

/** Employment status, used by the search screen's filter and the hire action. */
export async function setEmploymentStatus(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requirePermission("employee.edit");
  const employeeId = num(form.get("employeeId"));
  const status = str(form.get("status"));
  if (!["Active", "On leave", "Terminated"].includes(status)) {
    return fail("That status is not recognised.");
  }
  const guard = await guardEmployee(session, employeeId);
  if (guard) return fail(guard);

  const actor = actorOf(session);
  await audited(
    actor,
    { entity: "pa_employee", entityId: employeeId, subjectEmployeeId: employeeId },
    () => db.query.paEmployee.findFirst({ where: eq(paEmployee.id, employeeId) }),
    () =>
      db
        .update(paEmployee)
        .set({
          employmentStatus: status,
          terminationDate: status === "Terminated" ? str(form.get("effectiveDate")) || null : null,
        })
        .where(eq(paEmployee.id, employeeId)),
  );

  // A terminated employee frees their chair.
  if (status === "Terminated") {
    const assignment = await db.query.paOrgAssignment.findFirst({
      where: eq(paOrgAssignment.employeeId, employeeId),
      orderBy: [desc(paOrgAssignment.validFrom)],
    });
    if (assignment) {
      const code = assignment.positionCode;
      await audited(
        actor,
        { entity: "om_position", entityId: code, reason: "Holder terminated" },
        () => db.query.omPosition.findFirst({ where: eq(omPosition.code, code) }),
        () => db.update(omPosition).set({ isVacant: true }).where(eq(omPosition.code, code)),
      );
    }
  }

  revalidateEmployee(employeeId);
  revalidatePath("/org", "layout");
  return OK;
}
