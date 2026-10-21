import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { rawClient } from "@/lib/db";
import { addExistingEmployee, hire } from "@/lib/services/people";
import { startImport, confirmImport, runImportBatch } from "@/lib/services/imports";
import { systemActor } from "@/lib/change-log";
import { OPEN_ENDED } from "@/db/schema";

/**
 * Installing into a company whose people already work there. The records are
 * the same ones a hire writes — plus the bank and statutory details that make
 * someone payable — and deliberately none of the induction.
 */

const actor = systemActor("test");
const uid = () => randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase();
const one = async (sql: string, args: (string | number)[] = []) =>
  (await rawClient().execute({ sql, args })).rows[0] as Record<string, unknown> | undefined;

async function vacantPosition(): Promise<string> {
  const code = `PSX${uid()}`;
  await rawClient().execute({
    sql: `INSERT INTO om_position (code, title, org_unit_code, job_code, is_manager, is_vacant, valid_from, valid_to, is_active)
          VALUES (?, 'A seat', 'OU0002', 'JB0001', 0, 1, '2000-01-01', ?, 1)`,
    args: [code, OPEN_ENDED],
  });
  return code;
}

function details(employeeNumber: string, positionCode: string) {
  return {
    employeeNumber,
    previousPersonnelNumber: "LEGACY-77",
    actionType: "Hire",
    effectiveDate: "2019-07-01",
    reason: "Already employed",
    companyCode: "CO01",
    orgUnitCode: "OU0002",
    positionCode,
    costCenter: null,
    firstName: "Meera",
    lastName: "Nair",
    dateOfBirth: "1990-02-11",
    gender: "Female",
    maritalStatus: "Married",
    nationality: "Indian",
    payScaleGroup: "L3",
    amountPaise: 68_000_00,
    currency: "INR",
    payScaleType: "Monthly salaried",
    workScheduleCode: "WS01",
    weeklyHours: 40,
    employmentPercent: 100,
    bank: { bankName: "State Bank of India", accountNumber: "30123456789", ifsc: "SBIN0001234", holderName: null },
    statutory: { pan: "ABCPR1234K", uan: "100123456789", esiNumber: null, professionalTaxState: "KARNATAKA" },
    workEmail: "meera.nair@acme.example",
  };
}

beforeAll(async () => {
  // The suite shares one database; nothing here depends on another file's rows.
});

describe("adding someone who already works here", () => {
  it("keeps their number and joining date, and files what payroll needs", async () => {
    const number = `EMPX${uid()}`;
    const position = await vacantPosition();
    const added = await addExistingEmployee(actor, details(number, position), "test");
    expect(added.ok, added.ok ? "" : added.error).toBe(true);
    if (!added.ok) return;

    const employee = await one("SELECT * FROM pa_employee WHERE id = ?", [added.value.employeeId]);
    expect(employee).toMatchObject({
      employee_number: number,
      previous_personnel_number: "LEGACY-77",
      hire_date: "2019-07-01",
      employment_status: "Active",
    });

    const id = added.value.employeeId;
    const bank = await one("SELECT * FROM pa_it0009_bank_details WHERE employee_id = ?", [id]);
    expect(bank).toMatchObject({ bank_name: "State Bank of India", account_number: "30123456789", ifsc: "SBIN0001234" });
    const statutory = await one("SELECT * FROM pa_it0011_statutory_details WHERE employee_id = ?", [id]);
    expect(statutory).toMatchObject({ pan: "ABCPR1234K", uan: "100123456789", professional_tax_state: "KARNATAKA" });
    const email = await one("SELECT value FROM pa_it0105_communication WHERE employee_id = ? AND comm_type = 'Email (official)'", [id]);
    expect(email?.value).toBe("meera.nair@acme.example");
    const personal = await one("SELECT * FROM pa_it0002_personal_data WHERE employee_id = ?", [id]);
    expect(personal).toMatchObject({ marital_status: "Married", nationality: "Indian" });

    // Every dated record starts the day they actually joined, not today.
    for (const table of ["pa_it0001_org_assignment", "pa_it0008_basic_pay", "pa_it0009_bank_details"]) {
      const row = await one(`SELECT valid_from FROM ${table} WHERE employee_id = ?`, [id]);
      expect(row?.valid_from).toBe("2019-07-01");
    }

    // The seat is theirs now.
    expect(Number((await one("SELECT is_vacant FROM om_position WHERE code = ?", [position]))?.is_vacant)).toBe(0);
  });

  it("starts no checklist and no probation review", async () => {
    const position = await vacantPosition();
    const added = await addExistingEmployee(actor, details(`EMPX${uid()}`, position), "test");
    expect(added.ok).toBe(true);
    if (!added.ok) return;

    expect(await one("SELECT id FROM pa_checklist WHERE employee_id = ?", [added.value.employeeId])).toBeUndefined();
    expect(
      await one(
        "SELECT t.id FROM pa_task t JOIN pa_checklist c ON c.id = t.checklist_id WHERE c.employee_id = ?",
        [added.value.employeeId],
      ),
    ).toBeUndefined();
    expect(await one("SELECT id FROM pa_it0019_monitoring WHERE employee_id = ?", [added.value.employeeId])).toBeUndefined();
  });

  it("still starts them for a real hire, so the two paths stay different", async () => {
    const position = await vacantPosition();
    const hired = await hire(
      actor,
      {
        actionType: "Hire",
        effectiveDate: "2026-01-05",
        reason: null,
        companyCode: "CO01",
        orgUnitCode: "OU0002",
        positionCode: position,
        costCenter: null,
        firstName: "Fresh",
        lastName: "Joiner",
        dateOfBirth: null,
        gender: null,
        payScaleGroup: "L1",
        amountPaise: 50_000_00,
        currency: "INR",
        workScheduleCode: "WS01",
      },
      "test",
    );
    expect(hired.ok).toBe(true);
    if (!hired.ok) return;
    expect(await one("SELECT id FROM pa_checklist WHERE employee_id = ?", [hired.value.employeeId])).toBeDefined();
    expect(await one("SELECT id FROM pa_it0019_monitoring WHERE employee_id = ?", [hired.value.employeeId])).toBeDefined();
    // And a hire is numbered here, never by the caller.
    expect(String((await one("SELECT employee_number FROM pa_employee WHERE id = ?", [hired.value.employeeId]))?.employee_number)).toMatch(/^EMP\d+$/);
  });

  it("refuses a number already on record, a future joining date, and a filled seat", async () => {
    const number = `EMPX${uid()}`;
    const position = await vacantPosition();
    const first = await addExistingEmployee(actor, details(number, position), "test");
    expect(first.ok).toBe(true);

    const again = await addExistingEmployee(actor, details(number, await vacantPosition()), "test");
    expect(again.ok).toBeUndefined();
    if (!again.ok) expect(again.error).toMatch(/already on record/);

    const future = await addExistingEmployee(
      actor,
      { ...details(`EMPX${uid()}`, await vacantPosition()), effectiveDate: "2099-01-01" },
      "test",
    );
    expect(future.ok).toBeUndefined();
    if (!future.ok) expect(future.error).toMatch(/cannot have joined in the future/);

    // That first seat is taken now.
    const taken = await addExistingEmployee(actor, details(`EMPX${uid()}`, position), "test");
    expect(taken.ok).toBeUndefined();
    if (!taken.ok) expect(taken.error).toMatch(/already filled/);
  });
});

describe("a refused form", () => {
  it("hands back everything that was typed, so no bank account is lost to a typo", async () => {
    const { addExistingEmployeeAction } = await import("@/app/actions/core-hr");
    const { actAs } = await import("./support/people");
    actAs(null);

    const position = await vacantPosition();
    const body = new FormData();
    for (const [k, v] of Object.entries({
      employeeNumber: `EMPF${uid()}`,
      previousPersonnelNumber: "LEGACY-77",
      effectiveDate: "2019-07-01",
      companyCode: "CO01",
      orgUnitCode: "OU0002",
      positionCode: position,
      firstName: "Meera",
      lastName: "Nair",
      workEmail: "meera.nair@acme.example",
      amount: "68000",
      bankName: "State Bank of India",
      accountNumber: "30123456789",
      ifsc: "SBIN0001234",
      pan: "NOTAPAN",
      uan: "100123456789",
      professionalTaxState: "KARNATAKA",
    })) {
      body.set(k, v);
    }

    const refused = await addExistingEmployeeAction({}, body);
    expect(refused.error).toMatch(/PAN/);
    // The whole form comes back, not just the field that failed.
    expect(refused.values).toMatchObject({
      previousPersonnelNumber: "LEGACY-77",
      bankName: "State Bank of India",
      accountNumber: "30123456789",
      ifsc: "SBIN0001234",
      uan: "100123456789",
      workEmail: "meera.nair@acme.example",
      professionalTaxState: "KARNATAKA",
    });
    // And nothing was written on the way out.
    expect(await one("SELECT is_vacant FROM om_position WHERE code = ?", [position])).toMatchObject({ is_vacant: 1 });
  });
});

describe("the importer writes the same thing", () => {
  it("files bank and statutory details from the spreadsheet, and still no checklist", async () => {
    const number = `EMPI${uid()}`;
    const position = await vacantPosition();
    const started = await startImport(actor, {
      kind: "employees",
      fileName: null,
      uploadedBy: "test",
      rows: [
        {
          employee_number: number,
          first_name: "Imported",
          last_name: "Person",
          hire_date: "2021-04-01",
          company_code: "CO01",
          org_unit_code: "OU0002",
          position_code: position,
          basic_pay: "72000",
          work_schedule_code: "WS01",
          previous_personnel_number: "OLD-9",
          bank_name: "HDFC Bank",
          account_number: "50100123456",
          ifsc: "HDFC0000123",
          pan: "ZYXWV9876U",
          uan: "100999888777",
          professional_tax_state: "karnataka",
          work_email: "imported.person@acme.example",
          weekly_hours: "45",
        },
      ],
    });
    expect(started.ok, started.ok ? "" : started.error).toBe(true);
    if (!started.ok) return;
    expect(started.value.okRows).toBe(1);

    expect((await confirmImport(actor, started.value.id)).ok).toBe(true);
    for (let i = 0; i < 20; i += 1) {
      const batch = await runImportBatch(started.value.id, "test");
      if (batch.completed) break;
    }

    const employee = await one("SELECT * FROM pa_employee WHERE employee_number = ?", [number]);
    expect(employee).toBeDefined();
    expect(employee).toMatchObject({ previous_personnel_number: "OLD-9", hire_date: "2021-04-01" });
    const id = Number(employee!.id);

    expect(await one("SELECT account_number FROM pa_it0009_bank_details WHERE employee_id = ?", [id])).toMatchObject({
      account_number: "50100123456",
    });
    expect(await one("SELECT professional_tax_state FROM pa_it0011_statutory_details WHERE employee_id = ?", [id])).toMatchObject({
      professional_tax_state: "KARNATAKA",
    });
    expect(Number((await one("SELECT weekly_hours FROM pa_it0007_planned_working_time WHERE employee_id = ?", [id]))?.weekly_hours)).toBe(45);
    expect(await one("SELECT id FROM pa_checklist WHERE employee_id = ?", [id])).toBeUndefined();
  });

  it("refuses half a bank account, a bad PAN and a short UAN before writing anything", async () => {
    const position = await vacantPosition();
    const base = {
      first_name: "Checked",
      last_name: "Row",
      hire_date: "2021-04-01",
      company_code: "CO01",
      org_unit_code: "OU0002",
      position_code: position,
      basic_pay: "50000",
      work_schedule_code: "WS01",
    };
    const started = await startImport(actor, {
      kind: "employees",
      fileName: null,
      uploadedBy: "test",
      rows: [
        { ...base, employee_number: `EMPB${uid()}`, bank_name: "HDFC Bank" },
        { ...base, employee_number: `EMPP${uid()}`, pan: "NOTAPAN" },
        { ...base, employee_number: `EMPU${uid()}`, uan: "123" },
      ],
    });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    expect(started.value.okRows).toBe(0);
    expect(started.value.errorRows).toBe(3);

    const rows = await rawClient().execute({
      sql: "SELECT messages FROM app_import_row WHERE import_id = ? ORDER BY id",
      args: [started.value.id],
    });
    const said = rows.rows.map((r) => String(r.messages)).join(" ");
    expect(said).toMatch(/bank name and an account number/);
    expect(said).toMatch(/is not a PAN/);
    expect(said).toMatch(/UAN is 12 digits/);
  });
});
