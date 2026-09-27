"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/access";
import {
  pyWageType,
  pyPayrollPeriod,
  pyRecurringPayment,
  pyAdditionalPayment,
  pyPayrollRun,
  pyBankTransferFile,
  pyBankTransferLine,
  pyGlPosting,
  pyGlPostingLine,
  pyStatutoryRemittance,
  OPEN_ENDED,
  now,
} from "@/db/schema";
import { startRun, readRunProgress, type RunProgress } from "@/lib/engines/payroll";
import { toPaise } from "@/lib/money";
import { rawClient } from "@/lib/db";
import { actorOf, audited, changeStatement, recordCreate, recordCreated, recordDelete } from "@/lib/change-log";
import { payslipEmailStatements } from "@/lib/payslip-mail";
import { enqueueJob, requeueJob } from "@/lib/jobs/queue";
import { kickJobs } from "@/lib/jobs/runner";
import { addOneOffPayment, addRecurringPayment, recordRemittancePayment } from "@/lib/services/records";

export type ActionState = { error?: string; ok?: boolean; runId?: number };

const OK: ActionState = { ok: true };
const fail = (error: string): ActionState => ({ error });
const str = (v: FormDataEntryValue | null) => (typeof v === "string" ? v.trim() : "");
const opt = (v: FormDataEntryValue | null) => {
  const s = str(v);
  return s.length > 0 ? s : null;
};
const num = (v: FormDataEntryValue | null) => Number(str(v));
const bool = (v: FormDataEntryValue | null) => v === "on" || v === "true" || v === "1";

function revalidatePayroll() {
  revalidatePath("/payroll", "layout");
  revalidatePath("/");
}

/* ------------------------------------------- PY-01 payroll control record */

/**
 * The control record is what stops someone editing the inputs to a period that
 * has already been paid. Open accepts changes, Locked allows the run, Posted
 * is final.
 */
export async function setPeriodStatus(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requirePermission("payroll.post");
  const id = num(form.get("id"));
  const target = str(form.get("status"));

  const period = await db.query.pyPayrollPeriod.findFirst({
    where: eq(pyPayrollPeriod.id, id),
  });
  if (!period) return fail("That period no longer exists.");

  const allowed: Record<string, string[]> = {
    Open: ["Locked"],
    Locked: ["Open", "Posted"],
    Posted: [],
  };
  if (!allowed[period.status]?.includes(target)) {
    return fail(
      period.status === "Posted"
        ? "A posted period cannot be changed."
        : `A ${period.status.toLowerCase()} period cannot move straight to ${target.toLowerCase()}.`,
    );
  }

  let regularRunId: number | null = null;
  if (target === "Posted") {
    const run = await db.query.pyPayrollRun.findFirst({
      where: and(eq(pyPayrollRun.periodId, id), eq(pyPayrollRun.runType, "Regular")),
    });
    if (!run) return fail("Run payroll before posting the period.");
    if (run.status !== "Completed") {
      return fail("The payroll run for this period is still in progress. Let it finish first.");
    }
    regularRunId = run.id;
  }

  await audited(
    actorOf(session),
    { entity: "py_payroll_period", entityId: id },
    () => db.query.pyPayrollPeriod.findFirst({ where: eq(pyPayrollPeriod.id, id) }),
    () =>
      db
        .update(pyPayrollPeriod)
        .set({
          status: target,
          payDate: opt(form.get("payDate")) ?? period.payDate,
          releasedBy: target === "Locked" ? session.username : period.releasedBy,
          releasedAt: target === "Locked" ? now() : period.releasedAt,
          postedAt: target === "Posted" ? now() : period.postedAt,
        })
        .where(eq(pyPayrollPeriod.id, id)),
  );

  // Posting is when payslips become visible, so it is when people hear.
  if (regularRunId !== null) {
    await enqueueJob("payslips.notify", { runId: regularRunId }, { dedupeKey: `payslips.notify:${regularRunId}` });
    await kickJobs();
  }

  revalidatePayroll();
  return OK;
}

/** Whether posting this period emails each person their payslip. */
export async function setPeriodEmail(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requirePermission("payroll.post");
  const id = num(form.get("id"));
  const on = bool(form.get("emailPayslips"));
  const period = await db.query.pyPayrollPeriod.findFirst({ where: eq(pyPayrollPeriod.id, id) });
  if (!period) return fail("That period no longer exists.");
  if (period.status === "Posted") return fail("That period is posted; its payslips have been published.");
  await audited(
    actorOf(session),
    { entity: "py_payroll_period", entityId: id },
    () => db.query.pyPayrollPeriod.findFirst({ where: eq(pyPayrollPeriod.id, id) }),
    () => db.update(pyPayrollPeriod).set({ emailPayslips: on }).where(eq(pyPayrollPeriod.id, id)),
  );
  revalidatePayroll();
  return OK;
}

/**
 * Emails one person's payslip again, deliberately: whatever their
 * preference, and as a new message, so the first one stays on record.
 */
export async function resendPayslip(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requirePermission("payroll.post");
  const resultId = num(form.get("resultId"));
  const published = await rawClient().execute({
    sql: `SELECT r.id FROM py_payroll_result r JOIN py_payroll_run run ON run.id = r.run_id AND run.status = 'Completed'
          JOIN py_payroll_period p ON p.id = run.period_id
          WHERE r.id = ? AND r.status = 'Calculated' AND (p.status = 'Posted' OR run.run_type = 'Off-cycle')`,
    args: [resultId],
  });
  if (!published.rows[0]) return fail("That payslip has not been published yet.");
  const mail = await payslipEmailStatements([resultId], { resend: true });
  if (mail.withoutEmail.length > 0) return fail("There is no email address on their record. Add one first.");
  const logged = await recordStatement(actorOf(session), resultId);
  await rawClient().batch([...mail.statements, ...(logged ? [logged] : [])], "write");
  await kickJobs();
  revalidatePath("/outbox");
  return OK;
}

async function recordStatement(actor: ReturnType<typeof actorOf>, resultId: number) {
  const r = await rawClient().execute({ sql: "SELECT employee_id FROM py_payroll_result WHERE id = ?", args: [resultId] });
  return changeStatement(actor, {
    entity: "py_payroll_result",
    entityId: resultId,
    subjectEmployeeId: Number(r.rows[0]?.employee_id ?? 0) || null,
    action: "update",
    after: { emailed_again: new Date().toISOString() },
    reason: "Payslip emailed again",
  });
}

export async function createPeriod(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requirePermission("payroll.post");
  const areaCode = str(form.get("areaCode"));
  const year = num(form.get("year"));
  const month = num(form.get("month"));

  if (!areaCode) return fail("Choose a personnel area.");
  if (!Number.isInteger(year) || year < 2000) return fail("Enter a year.");
  if (!Number.isInteger(month) || month < 1 || month > 12) return fail("Choose a month.");

  const existing = await db.query.pyPayrollPeriod.findFirst({
    where: and(
      eq(pyPayrollPeriod.areaCode, areaCode),
      eq(pyPayrollPeriod.year, year),
      eq(pyPayrollPeriod.month, month),
    ),
  });
  if (existing) return fail("That period already exists.");

  const [created] = await db
    .insert(pyPayrollPeriod)
    .values({
      areaCode,
      year,
      month,
      payDate: opt(form.get("payDate")),
      status: "Open",
      emailPayslips: form.has("emailPayslips") ? bool(form.get("emailPayslips")) : true,
    })
    .returning();
  await recordCreate(actorOf(session), "py_payroll_period", created.id, created);

  revalidatePayroll();
  return OK;
}

/* ---------------------------------------------------- PY-02 wage types */

export async function saveWageType(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requirePermission("payroll.setup");
  const original = opt(form.get("originalCode"));
  const code = str(form.get("code")).toUpperCase();
  const name = str(form.get("name"));
  const amountType = str(form.get("amountType"));
  const percent = str(form.get("percent"));

  if (!code) return fail("Enter a wage type code.");
  if (!name) return fail("Enter a wage type name.");
  if (amountType === "PercentOfBasic" && !percent) {
    return fail("Enter the percentage of basic.");
  }

  const values = {
    code,
    name,
    kind: str(form.get("kind")) || "Earning",
    amountType,
    percentBasisPoints:
      amountType === "PercentOfBasic" ? Math.round(Number(percent) * 100) : null,
    fixedAmountPaise: null,
    formulaKey: opt(form.get("formulaKey")),
    isTaxable: bool(form.get("isTaxable")),
    isAutomatic: bool(form.get("isAutomatic")),
    glAccount: opt(form.get("glAccount")),
    sortOrder: num(form.get("sortOrder")) || 100,
    isActive: bool(form.get("isActive")),
  };

  if (original) {
    await audited(
      actorOf(session),
      { entity: "py_wage_type", entityId: original },
      () => db.query.pyWageType.findFirst({ where: eq(pyWageType.code, original) }),
      () => db.update(pyWageType).set(values).where(eq(pyWageType.code, original)),
    );
  } else {
    const existing = await db.query.pyWageType.findFirst({
      where: eq(pyWageType.code, code),
    });
    if (existing) return fail(`Wage type ${code} already exists.`);
    await db.insert(pyWageType).values(values);
    await recordCreate(actorOf(session), "py_wage_type", code, values);
  }

  revalidatePayroll();
  return OK;
}

export async function deleteWageType(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requirePermission("payroll.setup");
  const code = str(form.get("code"));

  const used = await db.query.pyRecurringPayment.findFirst({
    where: eq(pyRecurringPayment.wageTypeCode, code),
  });
  if (used) return fail(`${code} is used by a recurring payment. Remove that first.`);

  const before = await db.query.pyWageType.findFirst({ where: eq(pyWageType.code, code) });
  await db.delete(pyWageType).where(eq(pyWageType.code, code));
  if (before) await recordDelete(actorOf(session), "py_wage_type", code, before);
  revalidatePayroll();
  return OK;
}

/* --------------------------------------- IT0014 and IT0015 payments */

export async function saveRecurringPayment(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requirePermission("payroll.setup");
  const amount = num(form.get("amount"));
  if (!Number.isFinite(amount) || amount <= 0) return fail("Enter an amount above zero.");
  const saved = await addRecurringPayment(actorOf(session), {
    employeeId: num(form.get("employeeId")),
    wageTypeCode: str(form.get("wageTypeCode")),
    amountPaise: toPaise(amount),
    startDate: str(form.get("startDate")),
    endDate: str(form.get("endDate")) || OPEN_ENDED,
  });
  if (!saved.ok) return fail(saved.error);
  revalidatePayroll();
  return OK;
}

export async function deleteRecurringPayment(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requirePermission("payroll.setup");
  const id = num(form.get("id"));
  const before = await db.query.pyRecurringPayment.findFirst({ where: eq(pyRecurringPayment.id, id) });
  await db.delete(pyRecurringPayment).where(eq(pyRecurringPayment.id, id));
  if (before) {
    await recordDelete(actorOf(session), "py_it0014_recurring_payment", id, before, before.employeeId);
  }
  revalidatePayroll();
  return OK;
}

export async function saveAdditionalPayment(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requirePermission("payroll.setup");
  const amount = num(form.get("amount"));
  if (!Number.isFinite(amount) || amount <= 0) return fail("Enter an amount above zero.");
  const saved = await addOneOffPayment(actorOf(session), {
    employeeId: num(form.get("employeeId")),
    wageTypeCode: str(form.get("wageTypeCode")),
    amountPaise: toPaise(amount),
    paymentDate: str(form.get("paymentDate")),
  });
  if (!saved.ok) return fail(saved.error);
  revalidatePayroll();
  return OK;
}

export async function deleteAdditionalPayment(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requirePermission("payroll.setup");
  const id = num(form.get("id"));
  const payment = await db.query.pyAdditionalPayment.findFirst({
    where: eq(pyAdditionalPayment.id, id),
  });
  if (payment?.paidRunId) {
    return fail("That payment has been paid in a payroll run, so it stays on record.");
  }
  await db.delete(pyAdditionalPayment).where(eq(pyAdditionalPayment.id, id));
  if (payment) {
    await recordDelete(actorOf(session), "py_it0015_additional_payment", id, payment, payment.employeeId);
  }
  revalidatePayroll();
  return OK;
}

/* ----------------------------------------------------- PY-03 run payroll */

/** Hands a run to the job table and starts working it in the background. */
async function queueRun(runId: number): Promise<void> {
  await requeueJob("payroll.run", { runId }, `payroll.run:${runId}`);
  await kickJobs();
}

/**
 * Starts a run and returns at once. The run is calculated by a background
 * job, a batch at a time, so no request has to calculate the whole
 * organisation inside a serverless time limit, and it finishes whether or
 * not anyone keeps the screen open. The screen only watches.
 */
export async function startRunAction(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requirePermission("payroll.run");
  const periodId = num(form.get("periodId"));
  if (!periodId) return fail("Choose a period.");

  try {
    const { runId, planned } = await startRun({ periodId, runBy: session.username });
    await recordCreate(actorOf(session), "py_payroll_run", runId, {
      period_id: periodId,
      run_type: "Regular",
      planned_count: planned,
    });
    await queueRun(runId);
    return { ok: true, runId };
  } catch (err) {
    return fail(err instanceof Error ? err.message : "The payroll run could not start.");
  }
}

/**
 * An off-cycle run: selected people, outside the monthly run, paying the
 * one-off payments still owed to them — a bonus agreed after the month was
 * run, a final settlement.
 */
export async function startOffCycleAction(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requirePermission("payroll.run");
  const periodId = num(form.get("periodId"));
  const employeeIds = form
    .getAll("employeeId")
    .map((v) => Number(v))
    .filter((n) => Number.isInteger(n) && n > 0);
  const reason = str(form.get("reason"));
  const payDate = str(form.get("payDate"));

  if (!periodId) return fail("Choose a period.");
  if (employeeIds.length === 0) return fail("Choose at least one person to pay.");
  if (!reason) return fail("Say what the run is for, such as a bonus or a final settlement.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(payDate)) return fail("Enter a pay date.");

  try {
    const { runId, planned } = await startRun({
      periodId,
      runBy: session.username,
      runType: "Off-cycle",
      employeeIds,
      reason,
      payDate,
    });
    await recordCreate(actorOf(session), "py_payroll_run", runId, {
      period_id: periodId,
      run_type: "Off-cycle",
      reason,
      pay_date: payDate,
      planned_count: planned,
    });
    await queueRun(runId);
    return { ok: true, runId };
  } catch (err) {
    return fail(err instanceof Error ? err.message : "The off-cycle run could not start.");
  }
}

/**
 * Where a run stands, for the screen to show. If the run is unfinished and
 * nothing is working on it — its job failed, say — it is queued again, so
 * watching a stalled run is also how it resumes.
 */
export async function watchRun(
  runId: number,
): Promise<RunProgress | { error: string }> {
  await requirePermission("payroll.run");
  const id = Number(runId);
  const progress = await readRunProgress(id);
  if (!progress) return { error: "That payroll run no longer exists." };
  if (progress.completed) {
    revalidatePayroll();
    return progress;
  }
  const job = await rawClient().execute({
    sql: "SELECT status, last_error FROM app_job WHERE dedupe_key = ?",
    args: [`payroll.run:${id}`],
  });
  const status = job.rows[0]?.status;
  if (status === "failed") {
    return { error: `The run stopped: ${String(job.rows[0].last_error ?? "an unknown error")}. Resume it to try again.` };
  }
  await kickJobs();
  return progress;
}

/** Puts a stopped run back in the queue. */
export async function resumeRun(runId: number): Promise<RunProgress | { error: string }> {
  await requirePermission("payroll.run");
  const progress = await readRunProgress(Number(runId));
  if (!progress) return { error: "That payroll run no longer exists." };
  if (!progress.completed) await queueRun(Number(runId));
  return progress;
}

/* -------------------------------------------- PY-05 bank, GL, remittance */

export async function generateBankFile(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requirePermission("payroll.post");
  const runId = num(form.get("runId"));
  const paymentDate = str(form.get("paymentDate"));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(paymentDate)) return fail("Enter a payment date.");

  const run = await db.query.pyPayrollRun.findFirst({ where: eq(pyPayrollRun.id, runId) });
  if (!run) return fail("That run no longer exists.");
  if (run.status !== "Completed") return fail("That run is still in progress.");

  // Each payee with the bank account valid on the payment date, in one read.
  const payees = await rawClient().execute({
    sql: `SELECT r.employee_id, r.net_paise,
                 COALESCE(p.first_name || ' ' || p.last_name, e.employee_number) AS name,
                 b.bank_name, b.account_number, b.ifsc
          FROM py_payroll_result r
          JOIN pa_employee e ON e.id = r.employee_id
          LEFT JOIN pa_it0002_personal_data p
            ON p.employee_id = r.employee_id AND p.valid_from <= ?2 AND p.valid_to >= ?2
          LEFT JOIN pa_it0009_bank_details b
            ON b.employee_id = r.employee_id AND b.valid_from <= ?2 AND b.valid_to >= ?2
          WHERE r.run_id = ?1 AND r.status = 'Calculated'
          ORDER BY e.employee_number`,
    args: [runId, paymentDate],
  });
  if (payees.rows.length === 0) return fail("That run has no payable results.");

  const missing = payees.rows.filter((p) => !p.account_number);
  if (missing.length > 0) {
    return fail(
      `${missing.map((p) => String(p.name)).join(", ")} ${missing.length === 1 ? "has" : "have"} no bank account valid on the payment date. Add one, or choose another date.`,
    );
  }

  await db.delete(pyBankTransferFile).where(eq(pyBankTransferFile.runId, runId));

  const [file] = await db
    .insert(pyBankTransferFile)
    .values({
      runId,
      paymentDate,
      format: str(form.get("format")) || "NEFT bulk upload (CSV)",
      totalPaise: payees.rows.reduce((s, p) => s + Number(p.net_paise), 0),
      lineCount: payees.rows.length,
      generatedAt: now(),
      generatedBy: session.username,
    })
    .returning({ id: pyBankTransferFile.id });
  await recordCreate(actorOf(session), "py_bank_transfer_file", file.id, {
    run_id: runId,
    payment_date: paymentDate,
    line_count: payees.rows.length,
    total_paise: payees.rows.reduce((s, p) => s + Number(p.net_paise), 0),
  });

  await db.insert(pyBankTransferLine).values(
    payees.rows.map((p) => ({
      fileId: file.id,
      employeeId: Number(p.employee_id),
      employeeName: String(p.name),
      bankName: String(p.bank_name),
      accountNumber: String(p.account_number),
      ifsc: p.ifsc === null ? null : String(p.ifsc),
      amountPaise: Number(p.net_paise),
    })),
  );

  revalidatePayroll();
  return OK;
}

/**
 * Posts the run to the ledger as a balanced journal: salary expense debited,
 * the payables it creates credited. The two sides are built from the same
 * result lines, so they cannot disagree.
 */
export async function postToLedger(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requirePermission("payroll.post");
  const runId = num(form.get("runId"));
  const postingDate = str(form.get("postingDate"));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(postingDate)) return fail("Enter a posting date.");

  const run = await db.query.pyPayrollRun.findFirst({ where: eq(pyPayrollRun.id, runId) });
  if (!run) return fail("That run no longer exists.");
  if (run.status !== "Completed") return fail("That run is still in progress.");

  // Every line in the run, summed by wage type and by the cost centre of each
  // person's org assignment at the end of the period — one read, not one per
  // employee.
  const aggregate = await rawClient().execute({
    sql: `SELECT l.wage_type_code AS code, MIN(l.wage_type_name) AS name, l.kind,
                 o.cost_center, SUM(l.amount_paise) AS amount
          FROM py_payroll_result_line l
          JOIN py_payroll_result r ON r.id = l.result_id AND r.status = 'Calculated'
          JOIN py_payroll_run run ON run.id = r.run_id
          JOIN py_payroll_period p ON p.id = run.period_id
          LEFT JOIN pa_it0001_org_assignment o
            ON o.employee_id = r.employee_id
           AND o.valid_from <= date(printf('%04d-%02d-01', p.year, p.month), '+1 month', '-1 day')
           AND o.valid_to >= date(printf('%04d-%02d-01', p.year, p.month), '+1 month', '-1 day')
          WHERE r.run_id = ?
          GROUP BY l.wage_type_code, l.kind, o.cost_center`,
    args: [runId],
  });
  if (aggregate.rows.length === 0) return fail("That run has no results to post.");

  type Total = { code: string; name: string; kind: string; costCenter: string | null; amount: number };
  const rows: Total[] = aggregate.rows.map((r) => ({
    code: String(r.code),
    // Arrears lines name their month; the ledger wants the wage type.
    name: String(r.name).replace(/ (arrears )?for [A-Z][a-z]+ \d{4}$/, ""),
    kind: String(r.kind),
    costCenter: r.cost_center === null ? null : String(r.cost_center),
    amount: Number(r.amount),
  }));
  const totals = new Map<string, { name: string; kind: string; amount: number }>();
  for (const r of rows) {
    const t = totals.get(r.code);
    totals.set(r.code, { name: r.name, kind: r.kind, amount: (t?.amount ?? 0) + r.amount });
  }

  const wageTypes = await db.select().from(pyWageType);
  const glOf = new Map(wageTypes.map((w) => [w.code, w.glAccount ?? "5010"]));

  // Posting again replaces the journal; the ERP hears it was deleted.
  for (const gone of await db.delete(pyGlPosting).where(eq(pyGlPosting.runId, runId)).returning()) {
    await recordDelete(actorOf(session), "py_gl_posting", gone.id, gone);
  }
  const [posting] = await db
    .insert(pyGlPosting)
    .values({ runId, postingDate, postedAt: now(), postedBy: session.username })
    .returning({ id: pyGlPosting.id });

  const description = run.runType === "Off-cycle" ? "Off-cycle payroll" : "Payroll run";
  const glLines: {
    postingId: number;
    glAccount: string;
    description: string;
    debitPaise: number;
    creditPaise: number;
    costCenter: string | null;
  }[] = [];

  // Earnings are an expense, charged to the cost centre that incurred it.
  for (const r of rows) {
    if (r.kind !== "Earning" || r.amount === 0) continue;
    glLines.push({
      postingId: posting.id,
      glAccount: glOf.get(r.code) ?? "5010",
      description: `${description} — ${r.name}`,
      debitPaise: r.amount,
      creditPaise: 0,
      costCenter: r.costCenter,
    });
  }

  // Deductions become payables rather than reducing the expense.
  for (const [code, t] of totals) {
    if (t.kind !== "Deduction" || t.amount === 0) continue;
    glLines.push({
      postingId: posting.id,
      glAccount: glOf.get(code) ?? "2110",
      description: `${description} — ${t.name} payable`,
      debitPaise: 0,
      creditPaise: t.amount,
      costCenter: null,
    });
  }

  // What is left is owed to the employees.
  const earningsTotal = rows.filter((r) => r.kind === "Earning").reduce((s, r) => s + r.amount, 0);
  const deductionsTotal = rows.filter((r) => r.kind === "Deduction").reduce((s, r) => s + r.amount, 0);
  const netTotal = earningsTotal - deductionsTotal;
  glLines.push({
    postingId: posting.id,
    glAccount: "2110",
    description: `${description} — salary payable`,
    debitPaise: 0,
    creditPaise: netTotal,
    costCenter: null,
  });

  await db.insert(pyGlPostingLine).values(glLines);

  // Statutory amounts fall due from the same totals.
  await db.delete(pyStatutoryRemittance).where(eq(pyStatutoryRemittance.runId, runId));
  const dueDate = (day: number) => {
    const d = new Date(`${postingDate}T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + 1, day);
    return d.toISOString().slice(0, 10);
  };

  const pf = totals.get("PF")?.amount ?? 0;
  const tds = totals.get("TDS")?.amount ?? 0;
  const remittances: {
    runId: number;
    authority: string;
    amountPaise: number;
    dueDate: string;
    status: string;
  }[] = [];
  if (pf > 0) {
    remittances.push({ runId, authority: "EPFO (provident fund)", amountPaise: pf, dueDate: dueDate(15), status: "Due" });
  }
  if (tds > 0) {
    remittances.push({ runId, authority: "Income Tax Department (TDS)", amountPaise: tds, dueDate: dueDate(7), status: "Due" });
  }
  if (remittances.length > 0) {
    // Logged, so the ERP hears remittance.due.
    await recordCreated(actorOf(session), "py_statutory_remittance", await db.insert(pyStatutoryRemittance).values(remittances).returning());
  }
  await recordCreate(actorOf(session), "py_gl_posting", posting.id, {
    run_id: runId,
    posting_date: postingDate,
    line_count: glLines.length,
    debit_paise: glLines.reduce((s, l) => s + l.debitPaise, 0),
    credit_paise: glLines.reduce((s, l) => s + l.creditPaise, 0),
  });

  revalidatePayroll();
  return OK;
}

export async function markRemitted(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requirePermission("payroll.post");
  const saved = await recordRemittancePayment(actorOf(session), num(form.get("id")), {
    reference: opt(form.get("reference")),
  });
  if (!saved.ok) return fail(saved.error);
  revalidatePayroll();
  return OK;
}
