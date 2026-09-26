import { randomUUID } from "node:crypto";
import { rawClient } from "@/lib/db";
import { OPEN_ENDED } from "@/db/schema";

/**
 * People and periods for payroll tests, each in a personnel area of its own,
 * so a test's runs contain exactly the people it created — the seeded
 * employees and other test files never land in them.
 */

/** Unique across test files, which each run in their own worker. */
const uid = () => randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase();

export async function createArea(): Promise<string> {
  const code = `PT${uid()}`;
  await rawClient().execute({
    sql: `INSERT INTO om_personnel_area (code, company_code, name, location, is_active)
          VALUES (?, 'CO01', ?, 'Test', 1)`,
    args: [code, `Payroll test area ${code}`],
  });
  return code;
}

type PaySlice = { from: string; to?: string; amountRupees: number };

/**
 * A payable employee: org assignment in the area, basic pay slices and a bank
 * account. `createdAt` backdates the records, so a test can control what a
 * later run treats as a change made after it.
 */
export async function hireForPayroll(opts: {
  area: string;
  hireDate: string;
  terminationDate?: string;
  pay: PaySlice[];
  createdAt?: string;
}): Promise<number> {
  const client = rawClient();
  const createdAt = opts.createdAt ?? "2000-01-01T00:00:00.000Z";
  const created = await client.execute({
    sql: `INSERT INTO pa_employee (employee_number, hire_date, employment_status, termination_date, created_at)
          VALUES (?, ?, ?, ?, ?) RETURNING id`,
    args: [
      `ZZP${uid()}`,
      opts.hireDate,
      opts.terminationDate ? "Terminated" : "Active",
      opts.terminationDate ?? null,
      createdAt,
    ],
  });
  const id = Number(created.rows[0].id);

  await client.execute({
    sql: `INSERT INTO pa_it0001_org_assignment
            (employee_id, company_code, area_code, org_unit_code, position_code, cost_center,
             valid_from, valid_to, seq, created_by, created_at)
          VALUES (?, 'CO01', ?, 'OU0002', 'PS0003', 'CC-TEST', ?, ?, 1, 'test', ?)`,
    args: [id, opts.area, opts.hireDate, OPEN_ENDED, createdAt],
  });
  for (const p of opts.pay) await addPay(id, p, createdAt);
  await client.execute({
    sql: `INSERT INTO pa_it0009_bank_details
            (employee_id, bank_name, account_number, ifsc, valid_from, valid_to, seq, created_by, created_at)
          VALUES (?, 'Test Bank', ?, 'TEST0000001', ?, ?, 1, 'test', ?)`,
    args: [id, `ACC${id}`, opts.hireDate, OPEN_ENDED, createdAt],
  });
  return id;
}

/** A basic-pay slice, written directly with an explicit creation time. */
export async function addPay(employeeId: number, p: PaySlice, createdAt: string): Promise<void> {
  await rawClient().execute({
    sql: `INSERT INTO pa_it0008_basic_pay
            (employee_id, pay_scale_type, pay_scale_group, amount_paise, currency,
             valid_from, valid_to, seq, created_by, created_at)
          VALUES (?, 'Monthly salaried', 'L1', ?, 'INR', ?, ?,
                  (SELECT COALESCE(MAX(seq), 0) + 1 FROM pa_it0008_basic_pay
                   WHERE employee_id = ? AND valid_from = ?),
                  'test', ?)`,
    args: [employeeId, p.amountRupees * 100, p.from, p.to ?? OPEN_ENDED, employeeId, p.from, createdAt],
  });
}

/** A period, released for running unless told otherwise. */
export async function createPeriod(
  area: string,
  year: number,
  month: number,
  status: "Open" | "Locked" | "Posted" = "Locked",
): Promise<number> {
  const r = await rawClient().execute({
    sql: `INSERT INTO py_payroll_period (area_code, year, month, status) VALUES (?, ?, ?, ?) RETURNING id`,
    args: [area, year, month, status],
  });
  return Number(r.rows[0].id);
}

export async function postPeriod(periodId: number): Promise<void> {
  await rawClient().execute({
    sql: "UPDATE py_payroll_period SET status = 'Posted' WHERE id = ?",
    args: [periodId],
  });
}

export type StoredLine = { code: string; name: string; kind: string; amount: number; forPeriodId: number | null };

/** A stored result and its lines, for asserting on what a run wrote. */
export async function storedResult(runId: number, employeeId: number) {
  const client = rawClient();
  const r = await client.execute({
    sql: "SELECT * FROM py_payroll_result WHERE run_id = ? AND employee_id = ?",
    args: [runId, employeeId],
  });
  const row = r.rows[0];
  if (!row) return undefined;
  const lines = await client.execute({
    sql: `SELECT wage_type_code, wage_type_name, kind, amount_paise, for_period_id
          FROM py_payroll_result_line WHERE result_id = ? ORDER BY sort_order`,
    args: [row.id],
  });
  const all: StoredLine[] = lines.rows.map((l) => ({
    code: String(l.wage_type_code),
    name: String(l.wage_type_name),
    kind: String(l.kind),
    amount: Number(l.amount_paise),
    forPeriodId: l.for_period_id === null ? null : Number(l.for_period_id),
  }));
  const line = (code: string) => all.filter((l) => l.code === code && l.forPeriodId === null)[0]?.amount ?? 0;
  return {
    id: Number(row.id),
    status: String(row.status),
    errorMessage: row.error_message === null ? null : String(row.error_message),
    gross: Number(row.gross_paise),
    deductions: Number(row.deductions_paise),
    net: Number(row.net_paise),
    workingDays: Number(row.working_days),
    employedDays: Number(row.employed_days),
    unpaidDays: Number(row.unpaid_days),
    lines: all,
    line,
  };
}
