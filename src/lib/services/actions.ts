import "server-only";
import { rawClient } from "@/lib/db";
import { changeStatement, type Actor } from "@/lib/change-log";
import { writeTimeSlice, readAsOf, SLICED_TABLES } from "@/lib/engines/timeslice";
import type { Result } from "./result";

/**
 * Transfers and promotions: guided actions like hiring, not raw record
 * edits. Each writes a new `pa_it0000_action` row alongside the record it
 * changes, from an effective date, through the time-slice engine — in one
 * transaction, so a promotion's new position and new pay either both take
 * effect or neither does. A backdated one needs nothing extra: payroll's
 * retro already pays the arrears once the next run finds a basic-pay slice
 * newer than the month it corrects (`engines/payroll.ts`).
 */

const one = async (sql: string, args: (string | number | null)[]) =>
  (await rawClient().execute({ sql, args })).rows[0] as Record<string, unknown> | undefined;

type OrgAssignmentRow = {
  company_code: string;
  area_code: string | null;
  sub_area_code: string | null;
  org_unit_code: string;
  position_code: string;
  cost_center: string | null;
};

type BasicPayRow = {
  pay_scale_type: string | null;
  pay_scale_area: string | null;
  pay_scale_group: string | null;
  amount_paise: number;
  currency: string;
};

async function assignmentTarget(v: {
  employeeId: number;
  effectiveDate: string;
  positionCode: string;
}): Promise<Result<{ employee: Record<string, unknown>; position: Record<string, unknown>; current: OrgAssignmentRow }>> {
  const [employee, position] = await Promise.all([
    one("SELECT * FROM pa_employee WHERE id = ?", [v.employeeId]),
    one("SELECT * FROM om_position WHERE code = ?", [v.positionCode]),
  ]);
  if (!employee) return { error: "That employee does not exist.", code: "not_found" };
  if (String(employee.employment_status) === "Terminated") return { error: "That employee has already left, so their record cannot change this way." };
  if (!position) return { error: "That position no longer exists." };
  if (Number(position.is_vacant) !== 1) {
    return { error: `${v.positionCode} is already filled. Choose a vacant position, or free that one first.`, code: "conflict" };
  }
  const current = await readAsOf<OrgAssignmentRow>(SLICED_TABLES.orgAssignment, v.employeeId, v.effectiveDate);
  if (!current) return { error: `There is no org assignment valid on ${v.effectiveDate} to change.` };
  if (current.position_code === v.positionCode) return { error: "That is already their position." };
  return { ok: true, value: { employee, position, current } };
}

/** Frees the old position and fills the new one, logged either way. */
function positionSwapStatements(actor: Actor, from: string, to: string, verb: string) {
  return [
    changeStatement(actor, { entity: "om_position", entityId: from, action: "update", before: { isVacant: false }, after: { isVacant: true }, reason: `Vacated by ${verb}` }),
    changeStatement(actor, { entity: "om_position", entityId: to, action: "update", before: { isVacant: true }, after: { isVacant: false }, reason: `Filled by ${verb}` }),
  ];
}

export type TransferInput = {
  employeeId: number;
  effectiveDate: string;
  companyCode: string;
  areaCode: string | null;
  orgUnitCode: string;
  positionCode: string;
  costCenter: string | null;
  reason: string | null;
};

/** Moves someone to another vacant position — a new department, company or reporting line. Pay does not change. */
export async function transferEmployee(actor: Actor, v: TransferInput, createdBy: string): Promise<Result<null>> {
  const target = await assignmentTarget(v);
  if (!target.ok) return target;
  const { current } = target.value;
  const [unit, company] = await Promise.all([
    one("SELECT code FROM om_org_unit WHERE code = ?", [v.orgUnitCode]),
    one("SELECT code FROM om_company WHERE code = ?", [v.companyCode]),
  ]);
  if (!unit) return { error: "That department no longer exists." };
  if (!company) return { error: "That company does not exist." };

  const fromPosition = current.position_code;
  const tx = await rawClient().transaction("write");
  try {
    await writeTimeSlice(tx, {
      table: SLICED_TABLES.action,
      employeeId: v.employeeId,
      validFrom: v.effectiveDate,
      data: { action_type: "Transfer", reason: v.reason },
      createdBy,
      actor,
      reason: v.reason,
    });
    await writeTimeSlice(tx, {
      table: SLICED_TABLES.orgAssignment,
      employeeId: v.employeeId,
      validFrom: v.effectiveDate,
      data: {
        company_code: v.companyCode,
        area_code: v.areaCode,
        sub_area_code: current.sub_area_code ?? null,
        org_unit_code: v.orgUnitCode,
        position_code: v.positionCode,
        cost_center: v.costCenter,
      },
      createdBy,
      actor,
      reason: v.reason,
    });
    await tx.execute({ sql: "UPDATE om_position SET is_vacant = 1 WHERE code = ?", args: [fromPosition] });
    await tx.execute({ sql: "UPDATE om_position SET is_vacant = 0 WHERE code = ?", args: [v.positionCode] });
    for (const st of positionSwapStatements(actor, fromPosition, v.positionCode, "transfer")) if (st) await tx.execute(st);
    await tx.commit();
  } catch (err) {
    await tx.rollback();
    return { error: err instanceof Error ? `The transfer could not be completed: ${err.message}` : "The transfer could not be completed." };
  } finally {
    tx.close();
  }
  return { ok: true, value: null };
}

export type PromotionInput = {
  employeeId: number;
  effectiveDate: string;
  positionCode: string;
  payScaleGroup: string | null;
  amountPaise: number;
  currency: string;
  reason: string | null;
};

/** Moves someone into a new, higher position with new pay — one transaction, so retro can never see one without the other. */
export async function promoteEmployee(actor: Actor, v: PromotionInput, createdBy: string): Promise<Result<null>> {
  if (!(v.amountPaise > 0)) return { error: "Enter a basic salary above zero." };
  const target = await assignmentTarget(v);
  if (!target.ok) return target;
  const { current } = target.value;
  const currentPay = await readAsOf<BasicPayRow>(SLICED_TABLES.basicPay, v.employeeId, v.effectiveDate);
  if (!currentPay) return { error: `There is no basic pay valid on ${v.effectiveDate} to revise.` };
  if (v.amountPaise <= currentPay.amount_paise) {
    return { error: "A promotion's new salary is above the current one. Use the basic pay tab for anything else." };
  }

  const fromPosition = current.position_code;
  const tx = await rawClient().transaction("write");
  try {
    await writeTimeSlice(tx, {
      table: SLICED_TABLES.action,
      employeeId: v.employeeId,
      validFrom: v.effectiveDate,
      data: { action_type: "Promotion", reason: v.reason },
      createdBy,
      actor,
      reason: v.reason,
    });
    await writeTimeSlice(tx, {
      table: SLICED_TABLES.orgAssignment,
      employeeId: v.employeeId,
      validFrom: v.effectiveDate,
      data: {
        company_code: current.company_code,
        area_code: current.area_code,
        sub_area_code: current.sub_area_code ?? null,
        org_unit_code: current.org_unit_code,
        position_code: v.positionCode,
        cost_center: current.cost_center,
      },
      createdBy,
      actor,
      reason: v.reason,
    });
    await writeTimeSlice(tx, {
      table: SLICED_TABLES.basicPay,
      employeeId: v.employeeId,
      validFrom: v.effectiveDate,
      data: {
        pay_scale_type: currentPay.pay_scale_type ?? "Monthly salaried",
        pay_scale_area: currentPay.pay_scale_area ?? null,
        pay_scale_group: v.payScaleGroup,
        amount_paise: v.amountPaise,
        currency: v.currency,
        source_ref: "Promotion",
      },
      createdBy,
      actor,
      reason: v.reason ?? "Promotion",
    });
    await tx.execute({ sql: "UPDATE om_position SET is_vacant = 1 WHERE code = ?", args: [fromPosition] });
    await tx.execute({ sql: "UPDATE om_position SET is_vacant = 0 WHERE code = ?", args: [v.positionCode] });
    for (const st of positionSwapStatements(actor, fromPosition, v.positionCode, "promotion")) if (st) await tx.execute(st);
    await tx.commit();
  } catch (err) {
    await tx.rollback();
    return { error: err instanceof Error ? `The promotion could not be completed: ${err.message}` : "The promotion could not be completed." };
  } finally {
    tx.close();
  }
  return { ok: true, value: null };
}
