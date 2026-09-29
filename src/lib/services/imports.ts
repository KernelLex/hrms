import "server-only";
import type { InValue } from "@libsql/client";
import { rawClient } from "@/lib/db";
import { OPEN_ENDED, now } from "@/db/schema";
import { changeStatement, recordChanges, type Actor } from "@/lib/change-log";
import { financialYearOf } from "@/lib/engines/tax";
import { toCsv } from "@/lib/csv";
import { toPaise } from "@/lib/money";
import { todayInIndia } from "@/lib/dates";
import { GENDERS } from "@/lib/corrections-values";
import { enqueueJob } from "@/lib/jobs/queue";
import type { Result } from "./result";

/**
 * Bulk import: loading a company's own data in, from a spreadsheet or from
 * the ERP.
 *
 * Nothing is written until every row has been checked. Uploading validates
 * each row on its own and against what is already on record, and stores the
 * verdict per row — the dry run HR reads before deciding. Confirming commits
 * the rows that passed, a batch at a time on the job table, so a file of
 * thousands does not depend on one request surviving.
 *
 * Re-importing the same file changes nothing: every kind has a natural key,
 * and a row whose key is already on record is skipped rather than written
 * twice. That is what makes an interrupted import safe to run again.
 *
 * The screens and `POST /v1/imports` both come through here, so a
 * spreadsheet and the ERP's own bulk load face the same checks.
 */

export const IMPORT_KINDS = ["org_structure", "employees", "opening_balances"] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];

export function isImportKind(value: unknown): value is ImportKind {
  return typeof value === "string" && (IMPORT_KINDS as readonly string[]).includes(value);
}

export const IMPORT_LABELS: Record<ImportKind, { label: string; description: string }> = {
  org_structure: {
    label: "Positions",
    description:
      "Positions against departments and jobs that already exist, each with who it reports to and what it is budgeted at. Load the managers' positions before the ones that report to them.",
  },
  employees: {
    label: "Employees",
    description:
      "People with the records payroll needs: their number, name, joining date, where they sit, and their basic pay. Each goes into a vacant position, which it fills.",
  },
  opening_balances: {
    label: "Opening balances",
    description:
      "What each person earned and paid in tax before this system held their history, and their leave balances. Without these, a mid-year switchover deducts the wrong tax for the rest of the year.",
  },
};

/** The columns each kind's template has, in order, and which are needed. */
const COLUMNS: Record<ImportKind, { name: string; required: boolean; hint: string }[]> = {
  org_structure: [
    { name: "position_code", required: true, hint: "PS0101" },
    { name: "title", required: true, hint: "Senior software engineer" },
    { name: "org_unit_code", required: true, hint: "OU0002" },
    { name: "job_code", required: true, hint: "JB0001" },
    { name: "reports_to_code", required: false, hint: "PS0001" },
    { name: "is_manager", required: false, hint: "no" },
    { name: "budget", required: false, hint: "90000" },
    { name: "valid_from", required: false, hint: "2026-04-01" },
  ],
  employees: [
    { name: "employee_number", required: true, hint: "EMP2001" },
    { name: "first_name", required: true, hint: "Meera" },
    { name: "last_name", required: true, hint: "Nair" },
    { name: "date_of_birth", required: false, hint: "1994-07-19" },
    { name: "gender", required: false, hint: "Female" },
    { name: "hire_date", required: true, hint: "2023-05-02" },
    { name: "company_code", required: true, hint: "CO01" },
    { name: "area_code", required: false, hint: "PA01" },
    { name: "org_unit_code", required: true, hint: "OU0002" },
    { name: "position_code", required: true, hint: "PS0101" },
    { name: "cost_centre", required: false, hint: "CC-IT-01" },
    { name: "pay_scale_group", required: false, hint: "L3" },
    { name: "basic_pay", required: true, hint: "68000" },
    { name: "work_schedule_code", required: true, hint: "WS01" },
  ],
  opening_balances: [
    { name: "employee_number", required: true, hint: "EMP2001" },
    { name: "as_of_month", required: false, hint: "2026-08" },
    { name: "gross_paid", required: false, hint: "340000" },
    { name: "tds_deducted", required: false, hint: "18500" },
    { name: "quota_type_code", required: false, hint: "ANNUAL" },
    { name: "quota_year", required: false, hint: "2026" },
    { name: "entitled_days", required: false, hint: "18" },
    { name: "used_days", required: false, hint: "4.5" },
  ],
};

/** The empty spreadsheet to fill in: the header row, and one row of examples. */
export function templateFor(kind: ImportKind): string {
  const cols = COLUMNS[kind];
  return toCsv([cols.map((c) => c.name), cols.map((c) => c.hint)]);
}

export function columnsFor(kind: ImportKind): { name: string; required: boolean; hint: string }[] {
  return COLUMNS[kind];
}

/* ------------------------------------------------------------- row checks */

export type RowVerdict = {
  key: string | null;
  outcome: "ok" | "skipped" | "error";
  messages: string[];
};

type Row = Record<string, string>;

const str = (row: Row, name: string) => (row[name] ?? "").trim();
const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);
const isMonth = (v: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
const truthy = (v: string) => ["yes", "true", "1", "y"].includes(v.toLowerCase());

/** A number of rupees, days or anything else a spreadsheet writes loosely. */
function numberOf(value: string): number | null {
  if (value === "") return null;
  const n = Number(value.replace(/[,₹\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

const one = async (sql: string, args: InValue[]): Promise<Record<string, unknown> | undefined> =>
  (await rawClient().execute({ sql, args })).rows[0] as Record<string, unknown> | undefined;

/**
 * Reference data — companies, departments, jobs, schedules — repeats across
 * a bulk file far more than employee or position codes do: a 5,000-row
 * spreadsheet might name a handful of departments. A dry run reads nothing
 * mid-flight, so caching those lookups for its own duration is always
 * accurate, and turns thousands of repeat round trips into a handful.
 */
type Cache = Map<string, Record<string, unknown> | undefined>;

async function cachedOne(cache: Cache, sql: string, args: InValue[]): Promise<Record<string, unknown> | undefined> {
  const key = `${sql}\u0000${args.join("\u0000")}`;
  if (cache.has(key)) return cache.get(key);
  const row = await one(sql, args);
  cache.set(key, row);
  return row;
}

/* -------------------------------------------------------- org structure */

async function checkPosition(row: Row, cache: Cache): Promise<RowVerdict> {
  const code = str(row, "position_code").toUpperCase();
  const messages: string[] = [];
  if (!code) return { key: null, outcome: "error", messages: ["A position code is needed."] };

  const existing = await one("SELECT code FROM om_position WHERE code = ?", [code]);
  if (existing) return { key: code, outcome: "skipped", messages: [`${code} is already on record.`] };

  if (!str(row, "title")) messages.push("A title is needed.");
  const unit = str(row, "org_unit_code");
  const job = str(row, "job_code");
  if (!unit) messages.push("A department code is needed.");
  else if (!(await cachedOne(cache, "SELECT code FROM om_org_unit WHERE code = ? AND is_active = 1", [unit]))) {
    messages.push(`There is no active department ${unit}. Add it on the Org structure screen first.`);
  }
  if (!job) messages.push("A job code is needed.");
  else if (!(await cachedOne(cache, "SELECT code FROM om_job WHERE code = ? AND is_active = 1", [job]))) {
    messages.push(`There is no active job ${job}. Add it on the Org structure screen first.`);
  }
  const reportsTo = str(row, "reports_to_code").toUpperCase();
  if (reportsTo) {
    if (reportsTo === code) messages.push("A position cannot report to itself.");
    else if (!(await cachedOne(cache, "SELECT code FROM om_position WHERE code = ?", [reportsTo]))) {
      messages.push(`There is no position ${reportsTo} to report to. Import the managers' positions first.`);
    }
  }
  const budget = str(row, "budget");
  if (budget && !(numberOf(budget)! > 0)) messages.push("A budget is a monthly figure in rupees.");
  const from = str(row, "valid_from");
  if (from && !isDate(from)) messages.push("Valid from is a date, as 2026-04-01.");

  return { key: code, outcome: messages.length ? "error" : "ok", messages };
}

async function writePosition(row: Row, actor: Actor): Promise<RowVerdict> {
  const verdict = await checkPosition(row, new Map());
  if (verdict.outcome !== "ok") return verdict;
  const code = str(row, "position_code").toUpperCase();
  const budget = str(row, "budget");
  const values = {
    code,
    title: str(row, "title"),
    orgUnitCode: str(row, "org_unit_code"),
    jobCode: str(row, "job_code"),
    reportsToCode: str(row, "reports_to_code").toUpperCase() || null,
    isManager: truthy(str(row, "is_manager")),
    budgetPaise: budget ? toPaise(numberOf(budget)!) : null,
    validFrom: str(row, "valid_from") || todayInIndia(),
  };
  await rawClient().execute({
    sql: `INSERT INTO om_position (code, title, org_unit_code, job_code, reports_to_code, is_manager, is_vacant,
            budget_paise, valid_from, valid_to, is_active)
          VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, 1)`,
    args: [values.code, values.title, values.orgUnitCode, values.jobCode, values.reportsToCode, values.isManager ? 1 : 0, values.budgetPaise, values.validFrom, OPEN_ENDED],
  });
  await recordChanges(actor, [{ entity: "om_position", entityId: code, action: "create", after: values, reason: "Imported" }]);
  return { key: code, outcome: "ok", messages: [] };
}

/* -------------------------------------------------------------- employees */

async function checkEmployee(row: Row, cache: Cache): Promise<RowVerdict> {
  const number = str(row, "employee_number").toUpperCase();
  const messages: string[] = [];
  if (!number) return { key: null, outcome: "error", messages: ["An employee number is needed."] };

  const existing = await one("SELECT id FROM pa_employee WHERE employee_number = ?", [number]);
  if (existing) return { key: number, outcome: "skipped", messages: [`${number} is already on record.`] };

  if (!str(row, "first_name")) messages.push("A first name is needed.");
  if (!str(row, "last_name")) messages.push("A last name is needed.");

  const hireDate = str(row, "hire_date");
  if (!isDate(hireDate)) messages.push("A joining date is needed, as 2023-05-02.");
  const dob = str(row, "date_of_birth");
  if (dob && !isDate(dob)) messages.push("A date of birth is a date, as 1994-07-19.");
  const gender = str(row, "gender");
  if (gender && !(GENDERS as readonly string[]).includes(gender)) {
    messages.push(`Gender is one of ${GENDERS.join(", ")}.`);
  }

  const company = str(row, "company_code");
  if (!company) messages.push("A company code is needed.");
  else if (!(await cachedOne(cache, "SELECT code FROM om_company WHERE code = ?", [company]))) messages.push(`There is no company ${company}.`);

  const area = str(row, "area_code");
  if (area && !(await cachedOne(cache, "SELECT code FROM om_personnel_area WHERE code = ?", [area]))) {
    messages.push(`There is no personnel area ${area}.`);
  }

  const unit = str(row, "org_unit_code");
  if (!unit) messages.push("A department code is needed.");
  else if (!(await cachedOne(cache, "SELECT code FROM om_org_unit WHERE code = ?", [unit]))) messages.push(`There is no department ${unit}.`);

  const position = str(row, "position_code").toUpperCase();
  if (!position) messages.push("A position code is needed.");
  else {
    // Never cached: two rows naming the same position both read "vacant" at
    // the dry run regardless — writing is what actually decides between
    // them, so this has to be a fresh read there, not a cached one here.
    const p = await one("SELECT code, is_vacant FROM om_position WHERE code = ?", [position]);
    if (!p) messages.push(`There is no position ${position}. Import the positions first.`);
    else if (Number(p.is_vacant) !== 1) messages.push(`${position} is already filled.`);
  }

  const pay = numberOf(str(row, "basic_pay"));
  if (!(pay !== null && pay > 0)) messages.push("A basic salary above zero is needed, in rupees a month.");

  const schedule = str(row, "work_schedule_code");
  if (!schedule) messages.push("A work schedule code is needed.");
  else if (!(await cachedOne(cache, "SELECT code FROM pt_work_schedule_rule WHERE code = ?", [schedule]))) {
    messages.push(`There is no work schedule ${schedule}.`);
  }

  return { key: number, outcome: messages.length ? "error" : "ok", messages };
}

/**
 * One employee and the dated records payroll needs, in one transaction —
 * the same chain the hire action writes, without the onboarding checklist
 * and probation review: an imported employee joined long before today, and
 * their induction is not this system's to run.
 */
async function writeEmployee(row: Row, actor: Actor, createdBy: string): Promise<RowVerdict> {
  const verdict = await checkEmployee(row, new Map());
  if (verdict.outcome !== "ok") return verdict;

  const number = str(row, "employee_number").toUpperCase();
  const hireDate = str(row, "hire_date");
  const position = str(row, "position_code").toUpperCase();
  const amountPaise = toPaise(numberOf(str(row, "basic_pay"))!);
  const createdAt = now();

  const tx = await rawClient().transaction("write");
  try {
    const inserted = await tx.execute({
      sql: `INSERT INTO pa_employee (employee_number, hire_date, employment_status, created_at)
            VALUES (?, ?, 'Active', ?) RETURNING id`,
      args: [number, hireDate, createdAt],
    });
    const employeeId = Number(inserted.rows[0].id);
    const common = [employeeId, hireDate, OPEN_ENDED, 1, createdBy, createdAt];

    await tx.execute({
      sql: `INSERT INTO pa_it0000_action (employee_id, valid_from, valid_to, seq, created_by, created_at, action_type, reason)
            VALUES (?,?,?,?,?,?,'Hire','Imported')`,
      args: common,
    });
    await tx.execute({
      sql: `INSERT INTO pa_it0001_org_assignment (employee_id, valid_from, valid_to, seq, created_by, created_at,
              company_code, area_code, sub_area_code, org_unit_code, position_code, cost_center)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      args: [...common, str(row, "company_code"), str(row, "area_code") || null, null, str(row, "org_unit_code"), position, str(row, "cost_centre") || null],
    });
    await tx.execute({
      sql: `INSERT INTO pa_it0002_personal_data (employee_id, valid_from, valid_to, seq, created_by, created_at,
              first_name, last_name, date_of_birth, gender, marital_status, nationality)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      args: [...common, str(row, "first_name"), str(row, "last_name"), str(row, "date_of_birth") || null, str(row, "gender") || null, null, null],
    });
    await tx.execute({
      sql: `INSERT INTO pa_it0007_planned_working_time (employee_id, valid_from, valid_to, seq, created_by, created_at,
              work_schedule_code, weekly_hours, employment_percent)
            VALUES (?,?,?,?,?,?,?,40,100)`,
      args: [...common, str(row, "work_schedule_code")],
    });
    await tx.execute({
      sql: `INSERT INTO pa_it0008_basic_pay (employee_id, valid_from, valid_to, seq, created_by, created_at,
              pay_scale_type, pay_scale_area, pay_scale_group, amount_paise, currency)
            VALUES (?,?,?,?,?,?,'Monthly salaried',NULL,?,?,'INR')`,
      args: [...common, str(row, "pay_scale_group") || null, amountPaise],
    });
    await tx.execute({ sql: "UPDATE om_position SET is_vacant = 0 WHERE code = ?", args: [position] });

    const logged = [
      changeStatement(actor, {
        entity: "pa_employee",
        entityId: employeeId,
        subjectEmployeeId: employeeId,
        action: "create",
        after: {
          employeeNumber: number,
          hireDate,
          firstName: str(row, "first_name"),
          lastName: str(row, "last_name"),
          companyCode: str(row, "company_code"),
          orgUnitCode: str(row, "org_unit_code"),
          positionCode: position,
          amountPaise,
        },
        reason: "Imported",
      }),
      changeStatement(actor, {
        entity: "om_position",
        entityId: position,
        action: "update",
        before: { isVacant: true },
        after: { isVacant: false },
        reason: `Filled by ${number}`,
      }),
    ];
    for (const st of logged) if (st) await tx.execute(st);
    await tx.commit();
  } catch (err) {
    await tx.rollback();
    return { key: number, outcome: "error", messages: [err instanceof Error ? err.message : "The row could not be written."] };
  } finally {
    tx.close();
  }
  return { key: number, outcome: "ok", messages: [] };
}

/* ------------------------------------------------------- opening balances */

/** What a row asks for: pay and tax so far, leave taken so far, or both. */
type Balances = {
  employeeId: number;
  payTax: { financialYear: string; asOfYm: number; grossPaise: number; tdsPaise: number } | null;
  leave: { quotaTypeCode: string; year: number; entitledHalfDays: number; usedHalfDays: number } | null;
};

async function readBalances(row: Row): Promise<{ messages: string[]; balances: Balances | null; key: string | null }> {
  const number = str(row, "employee_number").toUpperCase();
  const messages: string[] = [];
  if (!number) return { messages: ["An employee number is needed."], balances: null, key: null };

  const employee = await one("SELECT id FROM pa_employee WHERE employee_number = ?", [number]);
  if (!employee) {
    return { messages: [`There is no employee ${number}. Import the employees first.`], balances: null, key: number };
  }

  const asOf = str(row, "as_of_month");
  const gross = numberOf(str(row, "gross_paid"));
  const tds = numberOf(str(row, "tds_deducted"));
  let payTax: Balances["payTax"] = null;
  if (asOf || gross !== null || tds !== null) {
    if (!isMonth(asOf)) messages.push("A month the figures run to is needed, as 2026-08.");
    if (gross !== null && gross < 0) messages.push("Gross paid cannot be negative.");
    if (tds !== null && tds < 0) messages.push("Tax deducted cannot be negative.");
    if (isMonth(asOf)) {
      payTax = {
        financialYear: financialYearOf(`${asOf}-01`),
        asOfYm: Number(asOf.slice(0, 4)) * 100 + Number(asOf.slice(5, 7)),
        grossPaise: toPaise(gross ?? 0),
        tdsPaise: toPaise(tds ?? 0),
      };
    }
  }

  const quota = str(row, "quota_type_code").toUpperCase();
  const quotaYear = numberOf(str(row, "quota_year"));
  const entitled = numberOf(str(row, "entitled_days"));
  const used = numberOf(str(row, "used_days"));
  let leave: Balances["leave"] = null;
  if (quota || quotaYear !== null || entitled !== null || used !== null) {
    if (!quota) messages.push("A quota type code is needed for a leave balance, such as ANNUAL.");
    else if (!(await one("SELECT code FROM pt_quota_type WHERE code = ? AND is_active = 1", [quota]))) {
      messages.push(`There is no active quota type ${quota}.`);
    }
    if (quotaYear === null || !Number.isInteger(quotaYear)) messages.push("A quota year is needed, as 2026.");
    if (entitled !== null && entitled < 0) messages.push("Entitled days cannot be negative.");
    if (used !== null && used < 0) messages.push("Days used cannot be negative.");
    if (quota && quotaYear !== null && Number.isInteger(quotaYear)) {
      leave = {
        quotaTypeCode: quota,
        year: quotaYear,
        entitledHalfDays: Math.round((entitled ?? 0) * 2),
        usedHalfDays: Math.round((used ?? 0) * 2),
      };
    }
  }

  if (!payTax && !leave && messages.length === 0) {
    messages.push("Nothing to import: give the pay and tax so far, a leave balance, or both.");
  }
  return { messages, balances: { employeeId: Number(employee.id), payTax, leave }, key: number };
}

async function checkBalances(row: Row): Promise<RowVerdict> {
  const { messages, balances, key } = await readBalances(row);
  if (messages.length > 0 || !balances) return { key, outcome: "error", messages };

  const already: string[] = [];
  if (balances.payTax) {
    const existing = await one("SELECT id FROM py_opening_balance WHERE employee_id = ? AND financial_year = ?", [
      balances.employeeId,
      balances.payTax.financialYear,
    ]);
    if (existing) already.push(`Pay and tax for ${balances.payTax.financialYear} are already on record.`);
  }
  if (balances.leave) {
    const existing = await one(
      "SELECT id FROM pt_it2006_absence_quota WHERE employee_id = ? AND quota_type_code = ? AND year = ?",
      [balances.employeeId, balances.leave.quotaTypeCode, balances.leave.year],
    );
    if (existing) already.push(`The ${balances.leave.quotaTypeCode} balance for ${balances.leave.year} is already on record.`);
  }
  const parts = (balances.payTax ? 1 : 0) + (balances.leave ? 1 : 0);
  if (already.length === parts) return { key, outcome: "skipped", messages: already };
  return { key, outcome: "ok", messages: already };
}

async function writeBalances(row: Row, actor: Actor, createdBy: string): Promise<RowVerdict> {
  const verdict = await checkBalances(row);
  if (verdict.outcome !== "ok") return verdict;
  const { balances, key } = await readBalances(row);
  if (!balances) return verdict;

  const messages = [...verdict.messages];
  const at = now();
  if (balances.payTax) {
    const p = balances.payTax;
    const written = await rawClient().execute({
      sql: `INSERT OR IGNORE INTO py_opening_balance
              (employee_id, financial_year, as_of_ym, gross_paid_paise, tds_deducted_paise, created_by, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [balances.employeeId, p.financialYear, p.asOfYm, p.grossPaise, p.tdsPaise, createdBy, at],
    });
    if (written.rowsAffected > 0) {
      await recordChanges(actor, [
        {
          entity: "py_opening_balance",
          entityId: `${balances.employeeId}:${p.financialYear}`,
          subjectEmployeeId: balances.employeeId,
          action: "create",
          after: { financialYear: p.financialYear, asOfYm: p.asOfYm, grossPaidPaise: p.grossPaise, tdsDeductedPaise: p.tdsPaise },
          reason: "Imported",
        },
      ]);
    }
  }
  if (balances.leave) {
    const l = balances.leave;
    const written = await rawClient().execute({
      sql: `INSERT OR IGNORE INTO pt_it2006_absence_quota
              (employee_id, quota_type_code, year, entitled_half_days, used_half_days, created_at)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [balances.employeeId, l.quotaTypeCode, l.year, l.entitledHalfDays, l.usedHalfDays, at],
    });
    if (written.rowsAffected > 0) {
      await recordChanges(actor, [
        {
          entity: "pt_it2006_absence_quota",
          entityId: `${balances.employeeId}:${l.quotaTypeCode}:${l.year}`,
          subjectEmployeeId: balances.employeeId,
          action: "create",
          after: { quotaTypeCode: l.quotaTypeCode, year: l.year, entitledHalfDays: l.entitledHalfDays, usedHalfDays: l.usedHalfDays },
          reason: "Imported",
        },
      ]);
    }
  }
  return { key, outcome: "ok", messages };
}

/* ------------------------------------------------------------ the engine */

const CHECKS: Record<ImportKind, (row: Row, cache: Cache) => Promise<RowVerdict>> = {
  org_structure: checkPosition,
  employees: checkEmployee,
  opening_balances: checkBalances,
};

const WRITES: Record<ImportKind, (row: Row, actor: Actor, createdBy: string) => Promise<RowVerdict>> = {
  org_structure: (row, actor) => writePosition(row, actor),
  employees: writeEmployee,
  opening_balances: writeBalances,
};

export type ImportSummary = {
  id: number;
  kind: ImportKind;
  fileName: string | null;
  status: "Validating" | "Validated" | "Importing" | "Completed" | "Failed";
  totalRows: number;
  okRows: number;
  errorRows: number;
  skippedRows: number;
  writtenRows: number;
  uploadedBy: string;
  uploadedAt: string;
  confirmedAt: string | null;
  finishedAt: string | null;
};

function summaryOf(r: Record<string, unknown>): ImportSummary {
  return {
    id: Number(r.id),
    kind: String(r.kind) as ImportKind,
    fileName: r.file_name === null ? null : String(r.file_name),
    status: String(r.status) as ImportSummary["status"],
    totalRows: Number(r.total_rows),
    okRows: Number(r.ok_rows),
    errorRows: Number(r.error_rows),
    skippedRows: Number(r.skipped_rows),
    writtenRows: Number(r.written_rows),
    uploadedBy: String(r.uploaded_by),
    uploadedAt: String(r.uploaded_at),
    confirmedAt: r.confirmed_at === null ? null : String(r.confirmed_at),
    finishedAt: r.finished_at === null ? null : String(r.finished_at),
  };
}

/** Rows are checked and stored in chunks, so a large file is never one giant batch. */
const VALIDATE_CHUNK = 200;

/**
 * The dry run: checks every row and records the verdict, writing nothing to
 * the records themselves. What comes back is the report HR reads before
 * confirming.
 */
export async function startImport(
  actor: Actor,
  input: { kind: ImportKind; rows: Row[]; fileName: string | null; uploadedBy: string },
): Promise<Result<ImportSummary>> {
  if (input.rows.length === 0) return { error: "That file has no rows under its header." };
  if (input.rows.length > 20_000) return { error: "That file has more than 20,000 rows. Split it and import the parts." };

  const at = new Date().toISOString();
  const created = await rawClient().execute({
    sql: `INSERT INTO app_import (kind, file_name, status, total_rows, uploaded_by, uploaded_at)
          VALUES (?, ?, 'Validating', ?, ?, ?) RETURNING id`,
    args: [input.kind, input.fileName, input.rows.length, input.uploadedBy, at],
  });
  const id = Number(created.rows[0].id);

  const check = CHECKS[input.kind];
  // Shared for the whole dry run: nothing is written while it runs, so a
  // department or job read once stays correct for every later row that
  // names it.
  const cache: Cache = new Map();
  const counts = { ok: 0, error: 0, skipped: 0 };
  for (let i = 0; i < input.rows.length; i += VALIDATE_CHUNK) {
    const chunk = input.rows.slice(i, i + VALIDATE_CHUNK);
    // Each row's checks are independent reads, so a chunk runs concurrently
    // rather than one row's round trips at a time — the difference between a
    // large file taking seconds and taking minutes.
    const verdicts = await Promise.all(chunk.map((row) => check(row, cache)));
    const statements = verdicts.map((verdict, offset) => {
      counts[verdict.outcome] += 1;
      return {
        sql: `INSERT INTO app_import_row (import_id, row_number, key, data, outcome, messages)
              VALUES (?, ?, ?, ?, ?, ?)`,
        args: [id, i + offset + 1, verdict.key, JSON.stringify(chunk[offset]), verdict.outcome, verdict.messages.length ? JSON.stringify(verdict.messages) : null] as InValue[],
      };
    });
    await rawClient().batch(statements, "write");
  }

  await rawClient().execute({
    sql: "UPDATE app_import SET status = 'Validated', ok_rows = ?, error_rows = ?, skipped_rows = ? WHERE id = ?",
    args: [counts.ok, counts.error, counts.skipped, id],
  });
  await recordChanges(actor, [
    {
      entity: "app_import",
      entityId: id,
      action: "create",
      after: { kind: input.kind, fileName: input.fileName, totalRows: input.rows.length, okRows: counts.ok, errorRows: counts.error, skippedRows: counts.skipped },
    },
  ]);
  const summary = await getImport(id);
  return summary ? { ok: true, value: summary } : { error: "The import could not be read back." };
}

/** Commits the rows that passed, on the job table. */
export async function confirmImport(actor: Actor, id: number): Promise<Result<ImportSummary>> {
  const found = await getImport(id);
  if (!found) return { error: "That import no longer exists.", code: "not_found" };
  if (found.status === "Importing") return { ok: true, value: found };
  if (found.status !== "Validated") {
    return { error: `That import was already ${found.status.toLowerCase()}.`, code: "conflict" };
  }
  if (found.okRows === 0) return { error: "No row in that file can be imported. Correct it and upload it again." };

  const at = new Date().toISOString();
  await rawClient().execute({
    sql: "UPDATE app_import SET status = 'Importing', confirmed_at = ? WHERE id = ? AND status = 'Validated'",
    args: [at, id],
  });
  await recordChanges(actor, [
    { entity: "app_import", entityId: id, action: "update", before: { status: "Validated" }, after: { status: "Importing" } },
  ]);
  const notifyUserId = actor.type === "user" ? actor.id : null;
  await enqueueJob("import.run", { importId: id, createdBy: actor.name, notifyUserId }, { dedupeKey: `import.run:${id}` });
  return { ok: true, value: { ...found, status: "Importing", confirmedAt: at } };
}

/** How many rows one pass of the job writes before it comes back for more. */
const WRITE_BATCH = 100;

/**
 * Writes the next batch of an import. Called by the job handler until it
 * says the import is done, so a file of thousands is written in steady
 * pieces rather than one transaction that could time out halfway.
 */
export async function runImportBatch(importId: number, createdBy: string): Promise<{ completed: boolean; written: number }> {
  const found = await getImport(importId);
  if (!found || found.status !== "Importing") return { completed: true, written: 0 };

  const pending = await rawClient().execute({
    sql: "SELECT id, row_number, data FROM app_import_row WHERE import_id = ? AND outcome = 'ok' ORDER BY row_number LIMIT ?",
    args: [importId, WRITE_BATCH],
  });
  const actor: Actor = { type: "system", id: null, name: `import ${importId}` };
  const write = WRITES[found.kind];

  let written = 0;
  let skipped = 0;
  let failed = 0;
  for (const r of pending.rows) {
    const row = JSON.parse(String(r.data)) as Row;
    let verdict: RowVerdict;
    try {
      verdict = await write(row, actor, createdBy);
    } catch (err) {
      verdict = { key: null, outcome: "error", messages: [err instanceof Error ? err.message : "The row could not be written."] };
    }
    const outcome = verdict.outcome === "ok" ? "written" : verdict.outcome;
    if (outcome === "written") written += 1;
    else if (outcome === "skipped") skipped += 1;
    else failed += 1;
    await rawClient().execute({
      sql: "UPDATE app_import_row SET outcome = ?, messages = ? WHERE id = ?",
      args: [outcome, verdict.messages.length ? JSON.stringify(verdict.messages) : null, Number(r.id)],
    });
  }

  await rawClient().execute({
    sql: `UPDATE app_import
          SET written_rows = written_rows + ?, skipped_rows = skipped_rows + ?, error_rows = error_rows + ?,
              ok_rows = MAX(0, ok_rows - ?)
          WHERE id = ?`,
    args: [written, skipped, failed, written + skipped + failed, importId],
  });

  const left = await one("SELECT COUNT(*) AS n FROM app_import_row WHERE import_id = ? AND outcome = 'ok'", [importId]);
  const completed = Number(left?.n ?? 0) === 0;
  if (completed) {
    await rawClient().execute({
      sql: "UPDATE app_import SET status = 'Completed', finished_at = ? WHERE id = ?",
      args: [new Date().toISOString(), importId],
    });
    await recordChanges({ type: "system", id: null, name: "import" }, [
      { entity: "app_import", entityId: importId, action: "update", before: { status: "Importing" }, after: { status: "Completed" } },
    ]);
  }
  return { completed, written };
}

/* -------------------------------------------------------------- reading */

export async function getImport(id: number): Promise<ImportSummary | null> {
  const row = await one("SELECT * FROM app_import WHERE id = ?", [id]);
  return row ? summaryOf(row) : null;
}

export type ImportRow = {
  rowNumber: number;
  key: string | null;
  outcome: string;
  messages: string[];
  data: Record<string, string>;
};

export async function importRows(
  id: number,
  opts: { outcome?: string; limit?: number; offset?: number } = {},
): Promise<ImportRow[]> {
  const where = ["import_id = ?"];
  const args: InValue[] = [id];
  if (opts.outcome) {
    where.push("outcome = ?");
    args.push(opts.outcome);
  }
  const r = await rawClient().execute({
    sql: `SELECT row_number, key, outcome, messages, data FROM app_import_row
          WHERE ${where.join(" AND ")} ORDER BY row_number LIMIT ? OFFSET ?`,
    args: [...args, opts.limit ?? 50, opts.offset ?? 0],
  });
  return r.rows.map((row) => ({
    rowNumber: Number(row.row_number),
    key: row.key === null ? null : String(row.key),
    outcome: String(row.outcome),
    messages: row.messages ? (JSON.parse(String(row.messages)) as string[]) : [],
    data: JSON.parse(String(row.data)) as Record<string, string>,
  }));
}

export async function listImports(limit = 20): Promise<ImportSummary[]> {
  const r = await rawClient().execute({
    sql: "SELECT * FROM app_import ORDER BY id DESC LIMIT ?",
    args: [limit],
  });
  return r.rows.map((row) => summaryOf(row as unknown as Record<string, unknown>));
}
