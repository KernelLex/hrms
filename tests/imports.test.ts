import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { rawClient } from "@/lib/db";
import { OPEN_ENDED } from "@/db/schema";
import { systemActor } from "@/lib/change-log";
import { calculateEmployee } from "@/lib/engines/payroll";
import { hire } from "@/lib/services/people";
import { startImport, confirmImport, runImportBatch, getImport, importRows, type ImportSummary } from "@/lib/services/imports";
import type { Result } from "@/lib/services/result";
import { createArea, hireForPayroll } from "./support/payroll-fixtures";

/**
 * Bulk import: nothing is written by the dry run, only what passed is
 * written on confirm, and a row already on record is skipped rather than
 * written twice — which is what makes re-importing the same file a no-op.
 */

const hrActor = systemActor("test");
const one = async (sql: string, args: (string | number)[] = []) =>
  (await rawClient().execute({ sql, args })).rows[0] as Record<string, unknown> | undefined;

function unwrap<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(r.error);
  return r.value;
}

async function vacantPosition(orgUnitCode = "OU0002"): Promise<string> {
  const code = `PZ${randomUUID().slice(0, 8).toUpperCase()}`;
  await rawClient().execute({
    sql: `INSERT INTO om_position (code, title, org_unit_code, job_code, reports_to_code, is_manager, is_vacant, valid_from, valid_to, is_active)
          VALUES (?, ?, ?, 'JB0001', NULL, 0, 1, '2020-01-01', ?, 1)`,
    args: [code, `Test role ${code}`, orgUnitCode, OPEN_ENDED],
  });
  return code;
}

async function runToCompletion(importId: number): Promise<ImportSummary> {
  for (let guard = 0; guard < 200; guard += 1) {
    const progress = await runImportBatch(importId, "test");
    if (progress.completed) return (await getImport(importId))!;
  }
  throw new Error("The import did not finish after 200 batches.");
}

describe("importing positions", () => {
  it("checks rows without writing, then writes only what passed", async () => {
    const unit = "OU0002";
    const badUnit = "OU-NOPE";
    const code = `PI${randomUUID().slice(0, 6).toUpperCase()}`;
    const rows = [
      { position_code: code, title: "Import test role", org_unit_code: unit, job_code: "JB0001" },
      { position_code: `PI${randomUUID().slice(0, 6).toUpperCase()}`, title: "Bad row", org_unit_code: badUnit, job_code: "JB0001" },
      { position_code: "PS0001", title: "Already exists", org_unit_code: unit, job_code: "JB0001" },
    ];
    const summary = unwrap(await startImport(hrActor, { kind: "org_structure", rows, fileName: "positions.csv", uploadedBy: "hr.admin" }));
    expect(summary.status).toBe("Validated");
    expect(summary).toMatchObject({ totalRows: 3, okRows: 1, errorRows: 1, skippedRows: 1 });
    expect(await one("SELECT code FROM om_position WHERE code = ?", [code])).toBeUndefined();

    const errorRow = (await importRows(summary.id, { outcome: "error" }))[0];
    expect(errorRow.messages.join(" ")).toMatch(/department/i);

    const confirmed = await confirmImport(hrActor, summary.id);
    expect(confirmed.ok).toBe(true);
    const finished = await runToCompletion(summary.id);
    expect(finished).toMatchObject({ status: "Completed", writtenRows: 1, skippedRows: 1, errorRows: 1 });

    const created = await one("SELECT * FROM om_position WHERE code = ?", [code]);
    expect(created).toMatchObject({ title: "Import test role", org_unit_code: unit, is_vacant: 1 });
  });

  it("changes nothing the second time the same file is imported", async () => {
    const code = `PI${randomUUID().slice(0, 6).toUpperCase()}`;
    const rows = [{ position_code: code, title: "Once only", org_unit_code: "OU0002", job_code: "JB0001" }];

    const first = unwrap(await startImport(hrActor, { kind: "org_structure", rows, fileName: null, uploadedBy: "hr.admin" }));
    await confirmImport(hrActor, first.id);
    await runToCompletion(first.id);
    const countAfterFirst = Number((await one("SELECT COUNT(*) AS n FROM om_position"))!.n);

    const second = unwrap(await startImport(hrActor, { kind: "org_structure", rows, fileName: null, uploadedBy: "hr.admin" }));
    expect(second).toMatchObject({ okRows: 0, skippedRows: 1 });
    // Nothing to confirm — every row was already on record.
    const countAfterSecond = Number((await one("SELECT COUNT(*) AS n FROM om_position"))!.n);
    expect(countAfterSecond).toBe(countAfterFirst);
  });
});

describe("importing employees", () => {
  it("hires into a vacant position, and will not import the same number twice", async () => {
    const position = await vacantPosition();
    const number = `EMPI${randomUUID().slice(0, 6).toUpperCase()}`;
    const row = {
      employee_number: number,
      first_name: "Imported",
      last_name: "Person",
      hire_date: "2023-06-01",
      company_code: "CO01",
      area_code: "PA01",
      org_unit_code: "OU0002",
      position_code: position,
      basic_pay: "55000",
      work_schedule_code: "WS01",
    };
    const started = unwrap(await startImport(hrActor, { kind: "employees", rows: [row], fileName: null, uploadedBy: "hr.admin" }));
    expect(started).toMatchObject({ okRows: 1, errorRows: 0 });
    await confirmImport(hrActor, started.id);
    const finished = await runToCompletion(started.id);
    expect(finished.writtenRows).toBe(1);

    const employee = await one("SELECT id, employment_status FROM pa_employee WHERE employee_number = ?", [number]);
    expect(employee!.employment_status).toBe("Active");
    const pay = await one("SELECT amount_paise FROM pa_it0008_basic_pay WHERE employee_id = ?", [Number(employee!.id)]);
    expect(Number(pay!.amount_paise)).toBe(5_500_000);
    expect((await one("SELECT is_vacant FROM om_position WHERE code = ?", [position]))!.is_vacant).toBe(0);
    // No checklist or probation review: an imported employee is not a fresh hire.
    expect(await one("SELECT id FROM pa_checklist WHERE employee_id = ?", [Number(employee!.id)])).toBeUndefined();

    const again = unwrap(await startImport(hrActor, { kind: "employees", rows: [row], fileName: null, uploadedBy: "hr.admin" }));
    expect(again).toMatchObject({ okRows: 0, skippedRows: 1 });
  });

  it(
    "imports 5,000 employees with their dated history in batches, and a repeat import writes nothing",
    async () => {
      const N = 5000;
      const stamp = randomUUID().slice(0, 6).toUpperCase();

      const positionValues: string[] = [];
      const positionArgs: (string | number)[] = [];
      const rows: Record<string, string>[] = [];
      for (let i = 0; i < N; i += 1) {
        const code = `PB${stamp}${String(i).padStart(4, "0")}`;
        positionValues.push("(?, ?, 'OU0002', 'JB0001', NULL, 0, 1, '2020-01-01', ?, 1)");
        positionArgs.push(code, `Bulk role ${i}`, OPEN_ENDED);
        rows.push({
          employee_number: `EB${stamp}${String(i).padStart(4, "0")}`,
          first_name: "Bulk",
          last_name: `Employee${i}`,
          hire_date: "2023-01-01",
          company_code: "CO01",
          org_unit_code: "OU0002",
          position_code: code,
          basic_pay: "40000",
          work_schedule_code: "WS01",
        });
      }
      // In chunks: a single statement of 5,000 value groups is its own kind of
      // slow, and would also risk SQLite's limit on bound parameters per call.
      const POSITION_CHUNK = 200;
      for (let i = 0; i < positionValues.length; i += POSITION_CHUNK) {
        const chunk = positionValues.slice(i, i + POSITION_CHUNK);
        const args = positionArgs.slice(i * 3, (i + chunk.length) * 3);
        await rawClient().execute({
          sql: `INSERT INTO om_position (code, title, org_unit_code, job_code, reports_to_code, is_manager, is_vacant, valid_from, valid_to, is_active)
                VALUES ${chunk.join(", ")}`,
          args,
        });
      }

      const started = unwrap(await startImport(hrActor, { kind: "employees", rows, fileName: "bulk.csv", uploadedBy: "hr.admin" }));
      expect(started).toMatchObject({ totalRows: N, okRows: N, errorRows: 0 });

      await confirmImport(hrActor, started.id);
      // Batched: still Importing partway through, not everything in one pass.
      const partial = await runImportBatch(started.id, "test");
      expect(partial.completed).toBe(false);
      expect(partial.written).toBeGreaterThan(0);
      expect(partial.written).toBeLessThan(N);

      const finished = await runToCompletion(started.id);
      expect(finished).toMatchObject({ status: "Completed", writtenRows: N, errorRows: 0 });
      const count = await one("SELECT COUNT(*) AS n FROM pa_employee WHERE employee_number LIKE ?", [`EB${stamp}%`]);
      expect(Number(count!.n)).toBe(N);

      const again = unwrap(await startImport(hrActor, { kind: "employees", rows, fileName: "bulk.csv", uploadedBy: "hr.admin" }));
      expect(again).toMatchObject({ okRows: 0, skippedRows: N });
      const stillCount = await one("SELECT COUNT(*) AS n FROM pa_employee WHERE employee_number LIKE ?", [`EB${stamp}%`]);
      expect(Number(stillCount!.n)).toBe(N);
    },
    180_000,
  );
});

describe("importing opening balances", () => {
  it("records leave taken so far, and will not double it on a repeat import", async () => {
    const position = await vacantPosition();
    const hired = unwrap(
      await hire(
        hrActor,
        {
          actionType: "Hire",
          effectiveDate: "2020-01-01",
          reason: null,
          companyCode: "CO01",
          areaCode: "PA01",
          orgUnitCode: "OU0002",
          positionCode: position,
          costCenter: null,
          firstName: "Balance",
          lastName: "Test",
          dateOfBirth: null,
          gender: null,
          payScaleGroup: "L1",
          amountPaise: 5_000_000,
          currency: "INR",
          workScheduleCode: "WS01",
        },
        "test",
      ),
    );
    const number = (await one("SELECT employee_number FROM pa_employee WHERE id = ?", [hired.employeeId]))!.employee_number;

    const row = { employee_number: String(number), quota_type_code: "ANNUAL", quota_year: "2025", entitled_days: "18", used_days: "4.5" };
    const started = unwrap(await startImport(hrActor, { kind: "opening_balances", rows: [row], fileName: null, uploadedBy: "hr.admin" }));
    expect(started).toMatchObject({ okRows: 1 });
    await confirmImport(hrActor, started.id);
    await runToCompletion(started.id);

    const quota = await one("SELECT * FROM pt_it2006_absence_quota WHERE employee_id = ? AND quota_type_code = 'ANNUAL' AND year = 2025", [hired.employeeId]);
    expect(quota).toMatchObject({ entitled_half_days: 36, used_half_days: 9 });

    const again = unwrap(await startImport(hrActor, { kind: "opening_balances", rows: [row], fileName: null, uploadedBy: "hr.admin" }));
    expect(again).toMatchObject({ okRows: 0, skippedRows: 1 });
  });

  it("reduces the TDS projected for the next month once actual tax paid before go-live is on record", async () => {
    // hireForPayroll, not the hire action: calculateEmployee needs a bank
    // account on record (IT0009), which this fixture gives it directly.
    // Hired well before this financial year, so several months are
    // "unrecorded" and, without an opening balance, assumed at today's rate.
    const area = await createArea();
    const employeeId = await hireForPayroll({
      area,
      hireDate: "2023-04-01",
      pay: [{ from: "2023-04-01", amountRupees: 100_000 }], // comfortably taxable
    });
    const number = (await one("SELECT employee_number FROM pa_employee WHERE id = ?", [employeeId]))!.employee_number;

    const tdsOf = async () => {
      const result = await calculateEmployee({ employeeId, year: 2025, month: 9 });
      return result.lines.find((l) => l.wageTypeCode === "TDS")?.amountPaise ?? 0;
    };

    const before = await tdsOf();
    expect(before).toBeGreaterThan(0);

    // What was actually withheld before this system existed — set high
    // enough to leave nothing owing, so the reduction cannot be a coincidence
    // of rounding: it is the opening balance's tds_deducted taking effect.
    const row = { employee_number: String(number), as_of_month: "2025-08", gross_paid: "1000000", tds_deducted: "2000000" };
    const started = unwrap(await startImport(hrActor, { kind: "opening_balances", rows: [row], fileName: null, uploadedBy: "hr.admin" }));
    expect(started).toMatchObject({ okRows: 1 });
    await confirmImport(hrActor, started.id);
    await runToCompletion(started.id);

    const after = await tdsOf();
    expect(after).toBe(0);
    expect(after).toBeLessThan(before);
  });
});
