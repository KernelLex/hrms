import "server-only";
import { rawClient } from "@/lib/db";
import { OPEN_ENDED, now } from "@/db/schema";
import { changeStatement, recordChanges, type Actor } from "@/lib/change-log";
import { saveTimeSlice, readAsOf, SLICED_TABLES } from "@/lib/engines/timeslice";
import type { Result } from "./result";

/**
 * People, as the screens and the API both change them. Every rule lives
 * here once: the hire action's checks, which fields another system may set,
 * and how those changes reach the dated records.
 */

export type HireData = {
  actionType: string;
  effectiveDate: string;
  reason: string | null;
  companyCode: string;
  areaCode: string | null;
  orgUnitCode: string;
  positionCode: string;
  costCenter: string | null;
  firstName: string;
  lastName: string;
  dateOfBirth: string | null;
  gender: string | null;
  payScaleGroup: string | null;
  amountPaise: number;
  currency: string;
  workScheduleCode: string;
};

const one = async (sql: string, args: (string | number | null)[]) =>
  (await rawClient().execute({ sql, args })).rows[0] as Record<string, unknown> | undefined;

/**
 * The hire action, equivalent to SAP's PA40: the employee and the chain of
 * records payroll needs, and the position marked filled — all or nothing.
 */
export async function hire(actor: Actor, v: HireData, createdBy: string): Promise<Result<{ employeeId: number; employeeNumber: string }>> {
  if (!(v.amountPaise > 0)) return { error: "Enter a basic salary above zero." };
  const [position, unit, company, schedule, area] = await Promise.all([
    one("SELECT * FROM om_position WHERE code = ?", [v.positionCode]),
    one("SELECT * FROM om_org_unit WHERE code = ?", [v.orgUnitCode]),
    one("SELECT * FROM om_company WHERE code = ?", [v.companyCode]),
    one("SELECT * FROM pt_work_schedule_rule WHERE code = ?", [v.workScheduleCode]),
    v.areaCode ? one("SELECT * FROM om_personnel_area WHERE code = ?", [v.areaCode]) : Promise.resolve({}),
  ]);
  if (!position) return { error: "That position no longer exists." };
  if (Number(position.is_vacant) !== 1) {
    return { error: `${v.positionCode} is already filled. Choose a vacant position, or free that one first.`, code: "conflict" };
  }
  if (!unit) return { error: "That department no longer exists." };
  if (!company) return { error: "That company does not exist." };
  if (!schedule) return { error: "That work schedule does not exist." };
  if (!area) return { error: "That personnel area does not exist." };

  // EMP1003, EMP1004, ... continuing from whatever exists.
  const last = await one("SELECT employee_number AS n FROM pa_employee ORDER BY employee_number DESC LIMIT 1", []);
  const lastNumber = last ? Number(String(last.n).replace(/\D/g, "")) : 1000;
  const employeeNumber = `EMP${lastNumber + 1}`;

  const createdAt = now();
  const tx = await rawClient().transaction("write");
  let employeeId: number;
  try {
    const inserted = await tx.execute({
      sql: `INSERT INTO pa_employee (employee_number, hire_date, employment_status, created_at)
            VALUES (?, ?, 'Active', ?) RETURNING id`,
      args: [employeeNumber, v.effectiveDate, createdAt],
    });
    employeeId = Number(inserted.rows[0].id);
    const common = [employeeId, v.effectiveDate, OPEN_ENDED, 1, createdBy, createdAt];

    await tx.execute({
      sql: `INSERT INTO pa_it0000_action (employee_id, valid_from, valid_to, seq, created_by, created_at, action_type, reason)
            VALUES (?,?,?,?,?,?,?,?)`,
      args: [...common, v.actionType, v.reason],
    });
    await tx.execute({
      sql: `INSERT INTO pa_it0001_org_assignment (employee_id, valid_from, valid_to, seq, created_by, created_at,
              company_code, area_code, sub_area_code, org_unit_code, position_code, cost_center)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      args: [...common, v.companyCode, v.areaCode, null, v.orgUnitCode, v.positionCode, v.costCenter],
    });
    await tx.execute({
      sql: `INSERT INTO pa_it0002_personal_data (employee_id, valid_from, valid_to, seq, created_by, created_at,
              first_name, last_name, date_of_birth, gender, marital_status, nationality)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      args: [...common, v.firstName, v.lastName, v.dateOfBirth, v.gender, null, null],
    });
    await tx.execute({
      sql: `INSERT INTO pa_it0007_planned_working_time (employee_id, valid_from, valid_to, seq, created_by, created_at,
              work_schedule_code, weekly_hours, employment_percent)
            VALUES (?,?,?,?,?,?,?,?,?)`,
      args: [...common, v.workScheduleCode, 40, 100],
    });
    await tx.execute({
      sql: `INSERT INTO pa_it0008_basic_pay (employee_id, valid_from, valid_to, seq, created_by, created_at,
              pay_scale_type, pay_scale_area, pay_scale_group, amount_paise, currency)
            VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      args: [...common, "Monthly salaried", null, v.payScaleGroup, v.amountPaise, v.currency],
    });
    await tx.execute({ sql: "UPDATE om_position SET is_vacant = 0 WHERE code = ?", args: [v.positionCode] });

    const logged = [
      changeStatement(actor, {
        entity: "pa_employee",
        entityId: employeeId,
        subjectEmployeeId: employeeId,
        action: "create",
        after: {
          employeeNumber,
          actionType: v.actionType,
          hireDate: v.effectiveDate,
          firstName: v.firstName,
          lastName: v.lastName,
          companyCode: v.companyCode,
          orgUnitCode: v.orgUnitCode,
          positionCode: v.positionCode,
          payScaleGroup: v.payScaleGroup,
          amountPaise: v.amountPaise,
          workScheduleCode: v.workScheduleCode,
        },
        reason: v.reason,
      }),
      changeStatement(actor, {
        entity: "om_position",
        entityId: v.positionCode,
        action: "update",
        before: { isVacant: true },
        after: { isVacant: false },
        reason: `Filled by ${employeeNumber}`,
      }),
    ];
    for (const st of logged) if (st) await tx.execute(st);
    await tx.commit();
  } catch (err) {
    await tx.rollback();
    return { error: err instanceof Error ? `The hire could not be completed: ${err.message}` : "The hire could not be completed." };
  } finally {
    tx.close();
  }
  return { ok: true, value: { employeeId, employeeNumber } };
}

/** The fields another system may be given ownership of, and how each is written. */
export const EMPLOYEE_FIELDS = ["first_name", "last_name", "work_email", "cost_centre"] as const;
export type EmployeeField = (typeof EMPLOYEE_FIELDS)[number];

/**
 * Sets fields on an employee's dated records from a date: names through the
 * personal-data record, the cost centre through the org assignment, the work
 * email on the contact records. Ownership is the caller's check.
 */
export async function updateEmployeeFields(
  actor: Actor,
  employeeId: number,
  fields: Partial<Record<EmployeeField, string>>,
  validFrom: string,
  createdBy: string,
): Promise<Result<null>> {
  const employee = await one("SELECT id FROM pa_employee WHERE id = ?", [employeeId]);
  if (!employee) return { error: "That employee does not exist.", code: "not_found" };

  try {
    if (fields.first_name !== undefined || fields.last_name !== undefined) {
      const current = await readAsOf<Record<string, string | null>>(SLICED_TABLES.personalData, employeeId, validFrom);
      if (!current) return { error: `There is no personal data valid on ${validFrom} to change.` };
      await saveTimeSlice({
        table: SLICED_TABLES.personalData,
        employeeId,
        validFrom,
        data: {
          first_name: fields.first_name ?? current.first_name,
          last_name: fields.last_name ?? current.last_name,
          date_of_birth: current.date_of_birth,
          gender: current.gender,
          marital_status: current.marital_status,
          nationality: current.nationality,
        },
        createdBy,
        actor,
      });
    }
    if (fields.cost_centre !== undefined) {
      const known = await one("SELECT code FROM om_cost_centre WHERE code = ? AND is_active = 1", [fields.cost_centre]);
      if (!known) return { error: `There is no active cost centre ${fields.cost_centre}. Send it to /cost-centres first.` };
      const current = await readAsOf<Record<string, string | null>>(SLICED_TABLES.orgAssignment, employeeId, validFrom);
      if (!current) return { error: `There is no org assignment valid on ${validFrom} to change.` };
      await saveTimeSlice({
        table: SLICED_TABLES.orgAssignment,
        employeeId,
        validFrom,
        data: {
          company_code: current.company_code,
          area_code: current.area_code,
          sub_area_code: current.sub_area_code,
          org_unit_code: current.org_unit_code,
          position_code: current.position_code,
          cost_center: fields.cost_centre,
        },
        createdBy,
        actor,
      });
    }
    if (fields.work_email !== undefined) {
      const existing = await one(
        `SELECT * FROM pa_it0105_communication WHERE employee_id = ? AND comm_type = 'Email (official)'
         ORDER BY valid_from DESC LIMIT 1`,
        [employeeId],
      );
      if (existing) {
        await rawClient().execute({
          sql: "UPDATE pa_it0105_communication SET value = ? WHERE id = ?",
          args: [fields.work_email, Number(existing.id)],
        });
        await recordChanges(actor, [
          {
            entity: "pa_it0105_communication",
            entityId: Number(existing.id),
            subjectEmployeeId: employeeId,
            action: "update",
            before: { value: existing.value },
            after: { value: fields.work_email },
          },
        ]);
      } else {
        const r = await rawClient().execute({
          sql: `INSERT INTO pa_it0105_communication (employee_id, valid_from, valid_to, seq, created_by, created_at, comm_type, value)
                VALUES (?, ?, ?, 1, ?, ?, 'Email (official)', ?) RETURNING *`,
          args: [employeeId, validFrom, OPEN_ENDED, createdBy, now(), fields.work_email],
        });
        const row = r.rows[0] as unknown as Record<string, unknown>;
        await recordChanges(actor, [
          { entity: "pa_it0105_communication", entityId: Number(row.id), subjectEmployeeId: employeeId, action: "create", after: row },
        ]);
      }
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : "The change could not be saved." };
  }
  return { ok: true, value: null };
}
