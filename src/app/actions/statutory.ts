"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { rawClient } from "@/lib/db";
import { requirePermission } from "@/lib/access";
import {
  pySalaryStructure,
  pySalaryStructureComponent,
  pyEmployeeCtc,
  pyRecurringPayment,
  pyCostSplit,
  pyGlMapping,
  pyWageType,
  pyPfRate,
  pyEsiRate,
  pyProfessionalTaxSlab,
  pyLwfRate,
  pyTaxConstant,
  paEmployee,
  omCompany,
  OPEN_ENDED,
  now,
} from "@/db/schema";
import { previewCtc } from "@/lib/engines/payroll";
import { SLICED_TABLES, writeTimeSlice, deleteTimeSlice } from "@/lib/engines/timeslice";
import { toPaise } from "@/lib/money";
import { actorOf, recordChanges, recordCreate, recordDelete } from "@/lib/change-log";

export type ActionState = { error?: string; ok?: boolean };

const OK: ActionState = { ok: true };
const fail = (error: string): ActionState => ({ error });
const str = (v: FormDataEntryValue | null) => (typeof v === "string" ? v.trim() : "");
const opt = (v: FormDataEntryValue | null) => {
  const s = str(v);
  return s.length > 0 ? s : null;
};
const num = (v: FormDataEntryValue | null) => Number(str(v));
const bool = (v: FormDataEntryValue | null) => v === "on" || v === "true" || v === "1";
const isDate = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d);

function revalidate() {
  revalidatePath("/payroll", "layout");
}

/* --------------------------------------------------------- salary structures */

export async function saveSalaryStructure(_prev: ActionState, form: FormData): Promise<ActionState> {
  const session = await requirePermission("payroll.setup");
  const original = opt(form.get("originalCode"));
  const code = str(form.get("code")).toUpperCase();
  const name = str(form.get("name"));
  if (!code) return fail("Enter a structure code.");
  if (!name) return fail("Enter a structure name.");
  const values = { code, name, isActive: bool(form.get("isActive")) };

  if (original) {
    await db.update(pySalaryStructure).set(values).where(eq(pySalaryStructure.code, original));
    await recordChanges(actorOf(session), [{ entity: "py_salary_structure", entityId: original, action: "update", after: values }]);
  } else {
    const existing = await db.query.pySalaryStructure.findFirst({ where: eq(pySalaryStructure.code, code) });
    if (existing) return fail(`Salary structure ${code} already exists.`);
    await db.insert(pySalaryStructure).values(values);
    await recordCreate(actorOf(session), "py_salary_structure", code, values);
  }
  revalidate();
  return OK;
}

export async function deleteSalaryStructure(_prev: ActionState, form: FormData): Promise<ActionState> {
  const session = await requirePermission("payroll.setup");
  const code = str(form.get("code"));
  const used = await db.query.pyEmployeeCtc.findFirst({ where: eq(pyEmployeeCtc.structureCode, code) });
  if (used) return fail(`${code} is assigned to an employee's CTC. Remove that first.`);
  const before = await db.query.pySalaryStructure.findFirst({ where: eq(pySalaryStructure.code, code) });
  await db.delete(pySalaryStructure).where(eq(pySalaryStructure.code, code));
  if (before) await recordDelete(actorOf(session), "py_salary_structure", code, before);
  revalidate();
  return OK;
}

/**
 * Replaces every component of a structure in one go — simpler and safer than
 * editing rows one at a time, since exactly one of them must be Balancing and
 * the set is small enough to hold in a single form.
 */
export async function saveStructureComponents(_prev: ActionState, form: FormData): Promise<ActionState> {
  const session = await requirePermission("payroll.setup");
  const structureCode = str(form.get("structureCode"));
  if (!structureCode) return fail("Choose a salary structure.");
  const structure = await db.query.pySalaryStructure.findFirst({ where: eq(pySalaryStructure.code, structureCode) });
  if (!structure) return fail("That salary structure no longer exists.");

  let parsed: { wageTypeCode: string; componentType: string; percent?: string; fixedAmount?: string; sortOrder?: string }[];
  try {
    parsed = JSON.parse(str(form.get("components")));
  } catch {
    return fail("The component list could not be read.");
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return fail("Add at least one component.");
  if (parsed.filter((c) => c.componentType === "Balancing").length > 1) {
    return fail("Only one component can be Balancing.");
  }
  const wageTypes = await db.select({ code: pyWageType.code }).from(pyWageType);
  const validCodes = new Set(wageTypes.map((w) => w.code));
  for (const c of parsed) {
    if (!validCodes.has(c.wageTypeCode)) return fail(`There is no wage type ${c.wageTypeCode}.`);
    if ((c.componentType === "PercentOfCTC" || c.componentType === "PercentOfBasic") && !c.percent) {
      return fail(`Enter a percentage for ${c.wageTypeCode}.`);
    }
    if (c.componentType === "Fixed" && !c.fixedAmount) {
      return fail(`Enter a fixed amount for ${c.wageTypeCode}.`);
    }
  }

  const before = await db.select().from(pySalaryStructureComponent).where(eq(pySalaryStructureComponent.structureCode, structureCode));
  await db.delete(pySalaryStructureComponent).where(eq(pySalaryStructureComponent.structureCode, structureCode));
  const rows = parsed.map((c, i) => ({
    structureCode,
    wageTypeCode: c.wageTypeCode,
    componentType: c.componentType,
    percentBasisPoints: c.percent ? Math.round(Number(c.percent) * 100) : null,
    fixedAmountPaise: c.fixedAmount ? toPaise(Number(c.fixedAmount)) : null,
    sortOrder: c.sortOrder ? Number(c.sortOrder) : (i + 1) * 10,
  }));
  const inserted = await db.insert(pySalaryStructureComponent).values(rows).returning();
  await recordChanges(actorOf(session), [
    { entity: "py_salary_structure_component", entityId: structureCode, action: "update", before: { rows: before }, after: { rows: inserted } },
  ]);
  revalidate();
  return OK;
}

/* ---------------------------------------------------------------- employee CTC */

/**
 * Saves a CTC slice and derives its structure's components: BASIC through the
 * time-slice engine, the same as a hire or a promotion, and the Balancing
 * component as a recurring payment — so payroll's existing reads need no
 * change to pick either up.
 */
export async function saveCtc(_prev: ActionState, form: FormData): Promise<ActionState> {
  const session = await requirePermission("payroll.setup");
  const employeeId = num(form.get("employeeId"));
  const structureCode = str(form.get("structureCode"));
  const annualCtcRupees = num(form.get("annualCtc"));
  const validFrom = str(form.get("validFrom"));

  if (!employeeId) return fail("Choose an employee.");
  if (!structureCode) return fail("Choose a salary structure.");
  if (!Number.isFinite(annualCtcRupees) || annualCtcRupees <= 0) return fail("Enter an annual CTC above zero.");
  if (!isDate(validFrom)) return fail("Enter a valid from date.");

  const [employee, structure] = await Promise.all([
    db.query.paEmployee.findFirst({ where: eq(paEmployee.id, employeeId) }),
    db.query.pySalaryStructure.findFirst({ where: eq(pySalaryStructure.code, structureCode) }),
  ]);
  if (!employee) return fail("That employee does not exist.");
  if (!structure || !structure.isActive) return fail(`There is no active salary structure ${structureCode}.`);

  const components = await db.select().from(pySalaryStructureComponent).where(eq(pySalaryStructureComponent.structureCode, structureCode));
  if (components.length === 0) return fail(`${structureCode} has no components defined yet.`);
  const balancing = components.find((c) => c.componentType === "Balancing");

  const annualCtcPaise = toPaise(annualCtcRupees);
  const breakdown = await previewCtc(structureCode, annualCtcPaise, validFrom);
  const basicLine = breakdown.lines.find((l) => l.wageTypeCode === "BASIC");
  const balancingLine = balancing ? breakdown.lines.find((l) => l.wageTypeCode === balancing.wageTypeCode) : undefined;

  const actor = actorOf(session);
  const createdBy = session.username;
  const tx = await rawClient().transaction("write");
  try {
    await writeTimeSlice(tx, {
      table: SLICED_TABLES.employeeCtc,
      employeeId,
      validFrom,
      data: { structure_code: structureCode, annual_ctc_paise: annualCtcPaise },
      createdBy,
      actor,
      reason: "CTC revision",
    });
    if (basicLine) {
      await writeTimeSlice(tx, {
        table: SLICED_TABLES.basicPay,
        employeeId,
        validFrom,
        data: { pay_scale_type: "Monthly salaried", pay_scale_group: structureCode, amount_paise: basicLine.amountPaise, currency: "INR", source_ref: "CTC" },
        createdBy,
        actor,
        reason: "CTC revision",
      });
    }
    await tx.commit();
  } catch (err) {
    await tx.rollback();
    throw err;
  } finally {
    tx.close();
  }

  // The balancing allowance as a recurring payment: end whatever was open
  // before, so each CTC revision replaces it rather than stacking another one.
  if (balancing && balancingLine) {
    const open = await db.query.pyRecurringPayment.findFirst({
      where: and(eq(pyRecurringPayment.employeeId, employeeId), eq(pyRecurringPayment.wageTypeCode, balancing.wageTypeCode), eq(pyRecurringPayment.endDate, OPEN_ENDED)),
    });
    if (open) {
      if (open.startDate >= validFrom) {
        await db.delete(pyRecurringPayment).where(eq(pyRecurringPayment.id, open.id));
        await recordChanges(actor, [{ entity: "py_it0014_recurring_payment", entityId: open.id, subjectEmployeeId: employeeId, action: "delete", before: open }]);
      } else {
        const dayBeforeValidFrom = new Date(`${validFrom}T00:00:00Z`);
        dayBeforeValidFrom.setUTCDate(dayBeforeValidFrom.getUTCDate() - 1);
        const endDate = dayBeforeValidFrom.toISOString().slice(0, 10);
        await db.update(pyRecurringPayment).set({ endDate }).where(eq(pyRecurringPayment.id, open.id));
        await recordChanges(actor, [{ entity: "py_it0014_recurring_payment", entityId: open.id, subjectEmployeeId: employeeId, action: "update", before: open, after: { ...open, endDate } }]);
      }
    }
    const inserted = await db
      .insert(pyRecurringPayment)
      .values({ employeeId, wageTypeCode: balancing.wageTypeCode, amountPaise: balancingLine.amountPaise, startDate: validFrom, endDate: OPEN_ENDED, createdAt: now() })
      .returning();
    await recordCreate(actor, "py_it0014_recurring_payment", inserted[0].id, inserted[0]);
  }

  revalidatePath("/payroll", "layout");
  revalidatePath("/core-hr", "layout");
  revalidatePath("/me", "layout");
  return OK;
}

export async function deleteCtc(_prev: ActionState, form: FormData): Promise<ActionState> {
  const session = await requirePermission("payroll.setup");
  const ok = await deleteTimeSlice(SLICED_TABLES.employeeCtc, num(form.get("id")), actorOf(session));
  if (!ok) return fail("That CTC slice no longer exists.");
  revalidatePath("/payroll", "layout");
  revalidatePath("/core-hr", "layout");
  return OK;
}

// Employee statutory details (UAN, ESI number, professional tax state) are
// IT0011 — edited through the same generic infotype screen as bank details
// and the rest of core-hr's master data (app/actions/core-hr.ts), not here.

/* ------------------------------------------------------------------- cost splits */

export async function saveCostSplit(_prev: ActionState, form: FormData): Promise<ActionState> {
  const session = await requirePermission("payroll.setup");
  const id = opt(form.get("id"));
  const employeeId = num(form.get("employeeId"));
  const costCentre = str(form.get("costCentre"));
  const percent = num(form.get("percent"));
  const validFrom = str(form.get("validFrom"));
  const validTo = opt(form.get("validTo")) ?? OPEN_ENDED;

  if (!employeeId) return fail("Choose an employee.");
  if (!costCentre) return fail("Enter a cost centre.");
  if (!Number.isFinite(percent) || percent <= 0 || percent > 100) return fail("Enter a percentage between 0 and 100.");
  if (!isDate(validFrom)) return fail("Enter a valid from date.");

  const values = { employeeId, costCentre, percentBasisPoints: Math.round(percent * 100), validFrom, validTo, createdBy: session.username, createdAt: now() };

  if (id) {
    const before = await db.query.pyCostSplit.findFirst({ where: eq(pyCostSplit.id, Number(id)) });
    await db.update(pyCostSplit).set(values).where(eq(pyCostSplit.id, Number(id)));
    await recordChanges(actorOf(session), [{ entity: "py_cost_split", entityId: Number(id), subjectEmployeeId: employeeId, action: "update", before, after: values }]);
  } else {
    const inserted = await db.insert(pyCostSplit).values(values).returning();
    await recordCreate(actorOf(session), "py_cost_split", inserted[0].id, inserted[0]);
  }
  revalidatePath("/payroll", "layout");
  revalidatePath("/core-hr", "layout");
  return OK;
}

export async function deleteCostSplit(_prev: ActionState, form: FormData): Promise<ActionState> {
  const session = await requirePermission("payroll.setup");
  const id = num(form.get("id"));
  const before = await db.query.pyCostSplit.findFirst({ where: eq(pyCostSplit.id, id) });
  if (!before) return fail("That cost split no longer exists.");
  await db.delete(pyCostSplit).where(eq(pyCostSplit.id, id));
  await recordDelete(actorOf(session), "py_cost_split", id, before);
  revalidatePath("/payroll", "layout");
  revalidatePath("/core-hr", "layout");
  return OK;
}

/* -------------------------------------------------------------------- GL mapping */

export async function saveGlMapping(_prev: ActionState, form: FormData): Promise<ActionState> {
  const session = await requirePermission("payroll.setup");
  // MasterScreen's dialog always names the edited row "originalCode", whatever
  // the id field is actually called — see components/master-screen.tsx.
  const id = opt(form.get("originalCode"));
  const companyCode = str(form.get("companyCode"));
  const wageTypeCode = str(form.get("wageTypeCode")).toUpperCase();
  const glAccount = str(form.get("glAccount"));
  if (!companyCode) return fail("Choose a company.");
  if (!wageTypeCode) return fail("Choose a wage type.");
  if (!glAccount) return fail("Enter a GL account.");

  const [company, wageType] = await Promise.all([
    db.query.omCompany.findFirst({ where: eq(omCompany.code, companyCode) }),
    db.query.pyWageType.findFirst({ where: eq(pyWageType.code, wageTypeCode) }),
  ]);
  if (!company) return fail(`There is no company ${companyCode}.`);
  if (!wageType) return fail(`There is no wage type ${wageTypeCode}.`);

  const values = { companyCode, wageTypeCode, glAccount };
  if (id) {
    await db.update(pyGlMapping).set(values).where(eq(pyGlMapping.id, Number(id)));
    await recordChanges(actorOf(session), [{ entity: "py_gl_mapping", entityId: Number(id), action: "update", after: values }]);
  } else {
    const existing = await db.query.pyGlMapping.findFirst({ where: and(eq(pyGlMapping.companyCode, companyCode), eq(pyGlMapping.wageTypeCode, wageTypeCode)) });
    if (existing) return fail(`${companyCode} already has a mapping for ${wageTypeCode}.`);
    const inserted = await db.insert(pyGlMapping).values(values).returning();
    await recordCreate(actorOf(session), "py_gl_mapping", inserted[0].id, inserted[0]);
  }
  revalidate();
  return OK;
}

export async function deleteGlMapping(_prev: ActionState, form: FormData): Promise<ActionState> {
  const session = await requirePermission("payroll.setup");
  const id = num(form.get("id"));
  const before = await db.query.pyGlMapping.findFirst({ where: eq(pyGlMapping.id, id) });
  if (!before) return fail("That mapping no longer exists.");
  await db.delete(pyGlMapping).where(eq(pyGlMapping.id, id));
  await recordDelete(actorOf(session), "py_gl_mapping", id, before);
  revalidate();
  return OK;
}

/* ----------------------------------------------------------------- dated rates */

export async function savePfRate(_prev: ActionState, form: FormData): Promise<ActionState> {
  const session = await requirePermission("payroll.setup");
  const id = opt(form.get("id"));
  const validFrom = str(form.get("validFrom"));
  if (!isDate(validFrom)) return fail("Enter a valid from date.");
  const values = {
    validFrom,
    validTo: opt(form.get("validTo")) ?? OPEN_ENDED,
    employeeRateBasisPoints: Math.round(num(form.get("employeeRate")) * 100),
    employerRateBasisPoints: Math.round(num(form.get("employerRate")) * 100),
    epsRateBasisPoints: Math.round(num(form.get("epsRate")) * 100),
    edliRateBasisPoints: Math.round(num(form.get("edliRate")) * 100),
    adminChargeBasisPoints: Math.round(num(form.get("adminChargeRate")) * 100),
    wageCeilingPaise: toPaise(num(form.get("wageCeiling"))),
  };
  if (id) {
    await db.update(pyPfRate).set(values).where(eq(pyPfRate.id, Number(id)));
    await recordChanges(actorOf(session), [{ entity: "py_pf_rate", entityId: Number(id), action: "update", after: values }]);
  } else {
    const inserted = await db.insert(pyPfRate).values(values).returning();
    await recordCreate(actorOf(session), "py_pf_rate", inserted[0].id, inserted[0]);
  }
  revalidate();
  return OK;
}

export async function deletePfRate(_prev: ActionState, form: FormData): Promise<ActionState> {
  const session = await requirePermission("payroll.setup");
  const id = num(form.get("id"));
  const before = await db.query.pyPfRate.findFirst({ where: eq(pyPfRate.id, id) });
  await db.delete(pyPfRate).where(eq(pyPfRate.id, id));
  if (before) await recordDelete(actorOf(session), "py_pf_rate", id, before);
  revalidate();
  return OK;
}

export async function saveEsiRate(_prev: ActionState, form: FormData): Promise<ActionState> {
  const session = await requirePermission("payroll.setup");
  const id = opt(form.get("id"));
  const validFrom = str(form.get("validFrom"));
  if (!isDate(validFrom)) return fail("Enter a valid from date.");
  const values = {
    validFrom,
    validTo: opt(form.get("validTo")) ?? OPEN_ENDED,
    employeeRateBasisPoints: Math.round(num(form.get("employeeRate")) * 100),
    employerRateBasisPoints: Math.round(num(form.get("employerRate")) * 100),
    wageCeilingPaise: toPaise(num(form.get("wageCeiling"))),
  };
  if (id) {
    await db.update(pyEsiRate).set(values).where(eq(pyEsiRate.id, Number(id)));
    await recordChanges(actorOf(session), [{ entity: "py_esi_rate", entityId: Number(id), action: "update", after: values }]);
  } else {
    const inserted = await db.insert(pyEsiRate).values(values).returning();
    await recordCreate(actorOf(session), "py_esi_rate", inserted[0].id, inserted[0]);
  }
  revalidate();
  return OK;
}

export async function deleteEsiRate(_prev: ActionState, form: FormData): Promise<ActionState> {
  const session = await requirePermission("payroll.setup");
  const id = num(form.get("id"));
  const before = await db.query.pyEsiRate.findFirst({ where: eq(pyEsiRate.id, id) });
  await db.delete(pyEsiRate).where(eq(pyEsiRate.id, id));
  if (before) await recordDelete(actorOf(session), "py_esi_rate", id, before);
  revalidate();
  return OK;
}

export async function savePtSlab(_prev: ActionState, form: FormData): Promise<ActionState> {
  const session = await requirePermission("payroll.setup");
  const id = opt(form.get("id"));
  const state = str(form.get("state")).toUpperCase();
  const validFrom = str(form.get("validFrom"));
  if (!state) return fail("Enter a state.");
  if (!isDate(validFrom)) return fail("Enter a valid from date.");
  const toAmount = opt(form.get("toAmount"));
  const values = {
    state,
    validFrom,
    validTo: opt(form.get("validTo")) ?? OPEN_ENDED,
    fromPaise: toPaise(num(form.get("fromAmount"))),
    toPaise: toAmount ? toPaise(Number(toAmount)) : null,
    amountPaise: toPaise(num(form.get("amount"))),
    isFebruary: bool(form.get("isFebruary")),
  };
  if (id) {
    await db.update(pyProfessionalTaxSlab).set(values).where(eq(pyProfessionalTaxSlab.id, Number(id)));
    await recordChanges(actorOf(session), [{ entity: "py_professional_tax_slab", entityId: Number(id), action: "update", after: values }]);
  } else {
    const inserted = await db.insert(pyProfessionalTaxSlab).values(values).returning();
    await recordCreate(actorOf(session), "py_professional_tax_slab", inserted[0].id, inserted[0]);
  }
  revalidate();
  return OK;
}

export async function deletePtSlab(_prev: ActionState, form: FormData): Promise<ActionState> {
  const session = await requirePermission("payroll.setup");
  const id = num(form.get("id"));
  const before = await db.query.pyProfessionalTaxSlab.findFirst({ where: eq(pyProfessionalTaxSlab.id, id) });
  await db.delete(pyProfessionalTaxSlab).where(eq(pyProfessionalTaxSlab.id, id));
  if (before) await recordDelete(actorOf(session), "py_professional_tax_slab", id, before);
  revalidate();
  return OK;
}

export async function saveLwfRate(_prev: ActionState, form: FormData): Promise<ActionState> {
  const session = await requirePermission("payroll.setup");
  const id = opt(form.get("id"));
  const state = str(form.get("state")).toUpperCase();
  const validFrom = str(form.get("validFrom"));
  const dueMonth = num(form.get("dueMonth"));
  if (!state) return fail("Enter a state.");
  if (!isDate(validFrom)) return fail("Enter a valid from date.");
  if (!Number.isInteger(dueMonth) || dueMonth < 1 || dueMonth > 12) return fail("Enter a due month from 1 to 12.");
  const values = {
    state,
    validFrom,
    validTo: opt(form.get("validTo")) ?? OPEN_ENDED,
    frequency: str(form.get("frequency")) || "HalfYearly",
    employeeAmountPaise: toPaise(num(form.get("employeeAmount"))),
    employerAmountPaise: toPaise(num(form.get("employerAmount"))),
    dueMonth,
  };
  if (id) {
    await db.update(pyLwfRate).set(values).where(eq(pyLwfRate.id, Number(id)));
    await recordChanges(actorOf(session), [{ entity: "py_lwf_rate", entityId: Number(id), action: "update", after: values }]);
  } else {
    const inserted = await db.insert(pyLwfRate).values(values).returning();
    await recordCreate(actorOf(session), "py_lwf_rate", inserted[0].id, inserted[0]);
  }
  revalidate();
  return OK;
}

export async function deleteLwfRate(_prev: ActionState, form: FormData): Promise<ActionState> {
  const session = await requirePermission("payroll.setup");
  const id = num(form.get("id"));
  const before = await db.query.pyLwfRate.findFirst({ where: eq(pyLwfRate.id, id) });
  await db.delete(pyLwfRate).where(eq(pyLwfRate.id, id));
  if (before) await recordDelete(actorOf(session), "py_lwf_rate", id, before);
  revalidate();
  return OK;
}

export async function saveTaxConstant(_prev: ActionState, form: FormData): Promise<ActionState> {
  const session = await requirePermission("payroll.setup");
  const id = opt(form.get("id"));
  const financialYear = str(form.get("financialYear"));
  const regime = str(form.get("regime"));
  if (!/^\d{4}-\d{2}$/.test(financialYear)) return fail("Enter a financial year, such as 2026-27.");
  if (regime !== "Old" && regime !== "New") return fail("Choose a regime.");
  const values = {
    financialYear,
    regime,
    standardDeductionPaise: toPaise(num(form.get("standardDeduction"))),
    rebate87aLimitPaise: toPaise(num(form.get("rebate87aLimit"))),
    rebate87aMaxPaise: toPaise(num(form.get("rebate87aMax"))),
    cessBasisPoints: Math.round(num(form.get("cessPercent")) * 100),
  };
  if (id) {
    await db.update(pyTaxConstant).set(values).where(eq(pyTaxConstant.id, Number(id)));
    await recordChanges(actorOf(session), [{ entity: "py_tax_constant", entityId: Number(id), action: "update", after: values }]);
  } else {
    const existing = await db.query.pyTaxConstant.findFirst({ where: and(eq(pyTaxConstant.financialYear, financialYear), eq(pyTaxConstant.regime, regime)) });
    if (existing) return fail(`${financialYear} already has ${regime} regime constants.`);
    const inserted = await db.insert(pyTaxConstant).values(values).returning();
    await recordCreate(actorOf(session), "py_tax_constant", inserted[0].id, inserted[0]);
  }
  revalidate();
  return OK;
}

export async function deleteTaxConstant(_prev: ActionState, form: FormData): Promise<ActionState> {
  const session = await requirePermission("payroll.setup");
  const id = num(form.get("id"));
  const before = await db.query.pyTaxConstant.findFirst({ where: eq(pyTaxConstant.id, id) });
  await db.delete(pyTaxConstant).where(eq(pyTaxConstant.id, id));
  if (before) await recordDelete(actorOf(session), "py_tax_constant", id, before);
  revalidate();
  return OK;
}
