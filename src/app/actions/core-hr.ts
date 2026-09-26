"use server";

import { revalidatePath } from "next/cache";
import { eq, sql, desc } from "drizzle-orm";
import { z } from "zod";
import { db, rawClient } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import {
  paEmployee,
  paOrgAssignment,
  paPlannedWorkingTime,
  paBasicPay,
  paAddress,
  paFamilyMember,
  paCommunication,
  omPosition,
  omOrgUnit,
  OPEN_ENDED,
  now,
  today,
} from "@/db/schema";
import { saveTimeSlice, deleteTimeSlice, SLICED_TABLES } from "@/lib/engines/timeslice";
import { toPaise } from "@/lib/money";

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
  const session = await requireRole("HR_ADMIN");

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

  const position = await db.query.omPosition.findFirst({
    where: eq(omPosition.code, v.positionCode),
  });
  if (!position) return fail("That position no longer exists.");
  if (!position.isVacant) {
    return fail(
      `${v.positionCode} is already filled. Choose a vacant position, or free that one first.`,
    );
  }

  const unit = await db.query.omOrgUnit.findFirst({
    where: eq(omOrgUnit.code, v.orgUnitCode),
  });
  if (!unit) return fail("That department no longer exists.");

  // EMP1003, EMP1004, ... continuing from whatever exists.
  const [last] = await db
    .select({ n: paEmployee.employeeNumber })
    .from(paEmployee)
    .orderBy(desc(paEmployee.employeeNumber))
    .limit(1);
  const lastNumber = last ? Number(last.n.replace(/\D/g, "")) : 1000;
  const employeeNumber = `EMP${lastNumber + 1}`;

  const createdAt = now();
  const client = rawClient();
  const tx = await client.transaction("write");

  let employeeId: number;
  try {
    const inserted = await tx.execute({
      sql: `INSERT INTO pa_employee (employee_number, hire_date, employment_status, created_at)
            VALUES (?, ?, 'Active', ?) RETURNING id`,
      args: [employeeNumber, v.effectiveDate, createdAt],
    });
    employeeId = inserted.rows[0].id as number;

    const common = [employeeId, v.effectiveDate, OPEN_ENDED, 1, session.username, createdAt];

    await tx.execute({
      sql: `INSERT INTO pa_it0000_action
            (employee_id, valid_from, valid_to, seq, created_by, created_at, action_type, reason)
            VALUES (?,?,?,?,?,?,?,?)`,
      args: [...common, v.actionType, v.reason],
    });

    await tx.execute({
      sql: `INSERT INTO pa_it0001_org_assignment
            (employee_id, valid_from, valid_to, seq, created_by, created_at,
             company_code, area_code, sub_area_code, org_unit_code, position_code, cost_center)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      args: [
        ...common,
        v.companyCode,
        v.areaCode,
        null,
        v.orgUnitCode,
        v.positionCode,
        v.costCenter,
      ],
    });

    await tx.execute({
      sql: `INSERT INTO pa_it0002_personal_data
            (employee_id, valid_from, valid_to, seq, created_by, created_at,
             first_name, last_name, date_of_birth, gender, marital_status, nationality)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      args: [...common, v.firstName, v.lastName, v.dateOfBirth, v.gender, null, null],
    });

    await tx.execute({
      sql: `INSERT INTO pa_it0007_planned_working_time
            (employee_id, valid_from, valid_to, seq, created_by, created_at,
             work_schedule_code, weekly_hours, employment_percent)
            VALUES (?,?,?,?,?,?,?,?,?)`,
      args: [...common, v.workScheduleCode, 40, 100],
    });

    await tx.execute({
      sql: `INSERT INTO pa_it0008_basic_pay
            (employee_id, valid_from, valid_to, seq, created_by, created_at,
             pay_scale_type, pay_scale_area, pay_scale_group, amount_paise, currency)
            VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      args: [
        ...common,
        "Monthly salaried",
        null,
        v.payScaleGroup,
        toPaise(v.amount),
        v.currency,
      ],
    });

    await tx.execute({
      sql: `UPDATE om_position SET is_vacant = 0 WHERE code = ?`,
      args: [v.positionCode],
    });

    await tx.commit();
  } catch (err) {
    await tx.rollback();
    return fail(
      err instanceof Error ? `The hire could not be completed: ${err.message}` : "The hire could not be completed.",
    );
  }

  revalidateEmployee(employeeId);
  revalidatePath("/org", "layout");
  return { ok: true, employeeId };
}

/* --------------------------------------------- CH-02 maintain master data */

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
  }
}

export async function saveInfotypeSlice(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireRole("HR_ADMIN");

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
  await requireRole("HR_ADMIN");
  const employeeId = num(form.get("employeeId"));
  const code = str(form.get("infotype")) as SlicedInfotype;
  const id = num(form.get("id"));
  const config = SLICED_FORMS[code];
  if (!config) return fail("That infotype is not recognised.");

  const removed = await deleteTimeSlice(config.table, id);
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
  const session = await requireRole("HR_ADMIN");
  const employeeId = num(form.get("employeeId"));
  const code = str(form.get("infotype"));
  const id = opt(form.get("id"));
  const createdAt = now();
  const validFrom = str(form.get("validFrom")) || today();

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
      if (id) await db.update(paAddress).set(values).where(eq(paAddress.id, Number(id)));
      else await db.insert(paAddress).values(values);
    } else if (code === "0021") {
      const name = str(form.get("name"));
      if (!name) return fail("Enter a name.");
      const values = {
        ...base,
        relationship: str(form.get("relationship")) || "Spouse",
        name,
        dateOfBirth: opt(form.get("dateOfBirth")),
      };
      if (id)
        await db.update(paFamilyMember).set(values).where(eq(paFamilyMember.id, Number(id)));
      else await db.insert(paFamilyMember).values(values);
    } else if (code === "0105") {
      const value = str(form.get("value"));
      if (!value) return fail("Enter a value.");
      const values = {
        ...base,
        commType: str(form.get("commType")) || "Email (official)",
        value,
      };
      if (id)
        await db.update(paCommunication).set(values).where(eq(paCommunication.id, Number(id)));
      else await db.insert(paCommunication).values(values);
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
  await requireRole("HR_ADMIN");
  const employeeId = num(form.get("employeeId"));
  const code = str(form.get("infotype"));
  const id = num(form.get("id"));

  if (code === "0006") await db.delete(paAddress).where(eq(paAddress.id, id));
  else if (code === "0021") await db.delete(paFamilyMember).where(eq(paFamilyMember.id, id));
  else if (code === "0105") await db.delete(paCommunication).where(eq(paCommunication.id, id));
  else return fail("That infotype is not recognised.");

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
  const session = await requireRole("HR_ADMIN");

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
  await requireRole("HR_ADMIN");
  const employeeId = num(form.get("employeeId"));
  const status = str(form.get("status"));
  if (!["Active", "On leave", "Terminated"].includes(status)) {
    return fail("That status is not recognised.");
  }

  await db
    .update(paEmployee)
    .set({
      employmentStatus: status,
      terminationDate: status === "Terminated" ? str(form.get("effectiveDate")) || null : null,
    })
    .where(eq(paEmployee.id, employeeId));

  // A terminated employee frees their chair.
  if (status === "Terminated") {
    const assignment = await db.query.paOrgAssignment.findFirst({
      where: eq(paOrgAssignment.employeeId, employeeId),
      orderBy: [desc(paOrgAssignment.validFrom)],
    });
    if (assignment) {
      await db
        .update(omPosition)
        .set({ isVacant: true })
        .where(eq(omPosition.code, assignment.positionCode));
    }
  }

  revalidateEmployee(employeeId);
  revalidatePath("/org", "layout");
  return OK;
}

/** Count of employees, used for the dashboard figure. */
export async function employeeCount(): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)` }).from(paEmployee);
  return row.n;
}
