"use server";

import { revalidatePath } from "next/cache";
import { and, eq, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import {
  pyWageType,
  pyPayrollPeriod,
  pyRecurringPayment,
  pyAdditionalPayment,
  pyPayrollRun,
  pyPayrollResult,
  pyPayrollResultLine,
  pyBankTransferFile,
  pyBankTransferLine,
  pyGlPosting,
  pyGlPostingLine,
  pyStatutoryRemittance,
  OPEN_ENDED,
  now,
} from "@/db/schema";
import { runPayroll } from "@/lib/engines/payroll";
import { readAsOf, SLICED_TABLES } from "@/lib/engines/timeslice";
import { toPaise } from "@/lib/money";
import { getEmployee, fullName } from "@/lib/repositories/employees";

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
  const session = await requireRole("HR_ADMIN");
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

  if (target === "Posted") {
    const run = await db.query.pyPayrollRun.findFirst({
      where: eq(pyPayrollRun.periodId, id),
    });
    if (!run) return fail("Run payroll before posting the period.");
  }

  await db
    .update(pyPayrollPeriod)
    .set({
      status: target,
      payDate: opt(form.get("payDate")) ?? period.payDate,
      releasedBy: target === "Locked" ? session.username : period.releasedBy,
      releasedAt: target === "Locked" ? now() : period.releasedAt,
      postedAt: target === "Posted" ? now() : period.postedAt,
    })
    .where(eq(pyPayrollPeriod.id, id));

  revalidatePayroll();
  return OK;
}

export async function createPeriod(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  await requireRole("HR_ADMIN");
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

  await db.insert(pyPayrollPeriod).values({
    areaCode,
    year,
    month,
    payDate: opt(form.get("payDate")),
    status: "Open",
  });

  revalidatePayroll();
  return OK;
}

/* ---------------------------------------------------- PY-02 wage types */

export async function saveWageType(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  await requireRole("HR_ADMIN");
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
    await db.update(pyWageType).set(values).where(eq(pyWageType.code, original));
  } else {
    const existing = await db.query.pyWageType.findFirst({
      where: eq(pyWageType.code, code),
    });
    if (existing) return fail(`Wage type ${code} already exists.`);
    await db.insert(pyWageType).values(values);
  }

  revalidatePayroll();
  return OK;
}

export async function deleteWageType(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  await requireRole("HR_ADMIN");
  const code = str(form.get("code"));

  const used = await db.query.pyRecurringPayment.findFirst({
    where: eq(pyRecurringPayment.wageTypeCode, code),
  });
  if (used) return fail(`${code} is used by a recurring payment. Remove that first.`);

  await db.delete(pyWageType).where(eq(pyWageType.code, code));
  revalidatePayroll();
  return OK;
}

/* --------------------------------------- IT0014 and IT0015 payments */

export async function saveRecurringPayment(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  await requireRole("HR_ADMIN");
  const amount = num(form.get("amount"));
  if (!Number.isFinite(amount) || amount <= 0) return fail("Enter an amount above zero.");

  const startDate = str(form.get("startDate"));
  const endDate = str(form.get("endDate")) || OPEN_ENDED;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return fail("Enter a start date.");
  if (endDate < startDate) return fail("The end date falls before the start date.");

  await db.insert(pyRecurringPayment).values({
    employeeId: num(form.get("employeeId")),
    wageTypeCode: str(form.get("wageTypeCode")),
    amountPaise: toPaise(amount),
    startDate,
    endDate,
    createdAt: now(),
  });

  revalidatePayroll();
  return OK;
}

export async function deleteRecurringPayment(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  await requireRole("HR_ADMIN");
  await db.delete(pyRecurringPayment).where(eq(pyRecurringPayment.id, num(form.get("id"))));
  revalidatePayroll();
  return OK;
}

export async function saveAdditionalPayment(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  await requireRole("HR_ADMIN");
  const amount = num(form.get("amount"));
  if (!Number.isFinite(amount) || amount <= 0) return fail("Enter an amount above zero.");

  const paymentDate = str(form.get("paymentDate"));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(paymentDate)) return fail("Enter a payment date.");

  await db.insert(pyAdditionalPayment).values({
    employeeId: num(form.get("employeeId")),
    wageTypeCode: str(form.get("wageTypeCode")),
    amountPaise: toPaise(amount),
    paymentDate,
    createdAt: now(),
  });

  revalidatePayroll();
  return OK;
}

export async function deleteAdditionalPayment(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  await requireRole("HR_ADMIN");
  await db
    .delete(pyAdditionalPayment)
    .where(eq(pyAdditionalPayment.id, num(form.get("id"))));
  revalidatePayroll();
  return OK;
}

/* ----------------------------------------------------- PY-03 run payroll */

export async function runPayrollAction(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireRole("HR_ADMIN");
  const periodId = num(form.get("periodId"));
  if (!periodId) return fail("Choose a period.");

  try {
    const { runId } = await runPayroll({ periodId, runBy: session.username });
    revalidatePayroll();
    return { ok: true, runId };
  } catch (err) {
    return fail(err instanceof Error ? err.message : "The payroll run failed.");
  }
}

/* -------------------------------------------- PY-05 bank, GL, remittance */

export async function generateBankFile(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireRole("HR_ADMIN");
  const runId = num(form.get("runId"));
  const paymentDate = str(form.get("paymentDate"));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(paymentDate)) return fail("Enter a payment date.");

  const results = await db
    .select()
    .from(pyPayrollResult)
    .where(and(eq(pyPayrollResult.runId, runId), eq(pyPayrollResult.status, "Calculated")));

  if (results.length === 0) return fail("That run has no payable results.");

  await db.delete(pyBankTransferFile).where(eq(pyBankTransferFile.runId, runId));

  const [file] = await db
    .insert(pyBankTransferFile)
    .values({
      runId,
      paymentDate,
      format: str(form.get("format")) || "NEFT bulk upload (CSV)",
      totalPaise: results.reduce((s, r) => s + r.netPaise, 0),
      lineCount: results.length,
      generatedAt: now(),
      generatedBy: session.username,
    })
    .returning({ id: pyBankTransferFile.id });

  for (const r of results) {
    const bank = await readAsOf<{
      bank_name: string;
      account_number: string;
      ifsc: string | null;
    }>(SLICED_TABLES.bankDetails, r.employeeId, paymentDate);
    const employee = await getEmployee(r.employeeId);

    await db.insert(pyBankTransferLine).values({
      fileId: file.id,
      employeeId: r.employeeId,
      employeeName: employee ? fullName(employee) : `Employee ${r.employeeId}`,
      bankName: bank?.bank_name ?? "—",
      accountNumber: bank?.account_number ?? "—",
      ifsc: bank?.ifsc ?? null,
      amountPaise: r.netPaise,
    });
  }

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
  const session = await requireRole("HR_ADMIN");
  const runId = num(form.get("runId"));
  const postingDate = str(form.get("postingDate"));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(postingDate)) return fail("Enter a posting date.");

  const results = await db
    .select({ id: pyPayrollResult.id, net: pyPayrollResult.netPaise })
    .from(pyPayrollResult)
    .where(and(eq(pyPayrollResult.runId, runId), eq(pyPayrollResult.status, "Calculated")));
  if (results.length === 0) return fail("That run has no results to post.");

  // Aggregate every line across the run, by wage type.
  const totals = new Map<string, { name: string; kind: string; amount: number }>();
  for (const r of results) {
    const rowLines = await db
      .select()
      .from(pyPayrollResultLine)
      .where(eq(pyPayrollResultLine.resultId, r.id));
    for (const l of rowLines) {
      const existing = totals.get(l.wageTypeCode);
      totals.set(l.wageTypeCode, {
        name: l.wageTypeName,
        kind: l.kind,
        amount: (existing?.amount ?? 0) + l.amountPaise,
      });
    }
  }

  const wageTypes = await db.select().from(pyWageType);
  const glOf = new Map(wageTypes.map((w) => [w.code, w.glAccount ?? "5010"]));

  await db.delete(pyGlPosting).where(eq(pyGlPosting.runId, runId));
  const [posting] = await db
    .insert(pyGlPosting)
    .values({ runId, postingDate, postedAt: now(), postedBy: session.username })
    .returning({ id: pyGlPosting.id });

  const description = "Payroll run";
  const glLines: {
    postingId: number;
    glAccount: string;
    description: string;
    debitPaise: number;
    creditPaise: number;
    costCenter: string | null;
  }[] = [];

  // Earnings are an expense.
  for (const [code, t] of totals) {
    if (t.kind !== "Earning" || t.amount === 0) continue;
    glLines.push({
      postingId: posting.id,
      glAccount: glOf.get(code) ?? "5010",
      description: `${description} — ${t.name}`,
      debitPaise: t.amount,
      creditPaise: 0,
      costCenter: null,
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
  const netTotal = results.reduce((s, r) => s + r.net, 0);
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
    await db.insert(pyStatutoryRemittance).values(remittances);
  }

  revalidatePayroll();
  return OK;
}

export async function markRemitted(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  await requireRole("HR_ADMIN");
  const id = num(form.get("id"));
  await db
    .update(pyStatutoryRemittance)
    .set({
      status: "Remitted",
      remittedAt: now(),
      reference: opt(form.get("reference")),
    })
    .where(eq(pyStatutoryRemittance.id, id));
  revalidatePayroll();
  return OK;
}

/** The most recent run for a period, used by several screens. */
export async function latestRunForPeriod(periodId: number) {
  return db.query.pyPayrollRun.findFirst({
    where: eq(pyPayrollRun.periodId, periodId),
    orderBy: [desc(pyPayrollRun.runAt)],
  });
}
