import "server-only";
import { rawClient } from "@/lib/db";
import { now } from "@/db/schema";
import { changeStatement, type Actor as LogActor } from "@/lib/change-log";
import { notificationStatements } from "@/lib/notifications";
import { planRequest, writeRequest, cancelStatements, type Actor } from "@/lib/workflow/engine";
import { PROCESSES } from "@/lib/workflow/processes";
import { computeEmi, prepayLoan, closeLoan } from "@/lib/engines/loans";
import { formatINR } from "@/lib/money";
import type { Result } from "./result";

/**
 * Asking for a loan starts the "loan" approval flow (their reporting
 * manager, falling back to HR exactly as any step with nobody to fill it
 * does); `workflow/loan.ts` generates the EMI schedule the moment it is
 * approved. Prepaying and closing an active loan act straight away — they
 * are not asked for, they are things HR or the employee just does.
 */

const one = async (sql: string, args: (string | number)[]) =>
  (await rawClient().execute({ sql, args })).rows[0] as Record<string, unknown> | undefined;

export type LoanInput = {
  loanType: string;
  principalPaise: number;
  annualRateBasisPoints: number;
  tenureMonths: number;
  startDate: string;
  reason: string | null;
};

const isDate = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d);

export async function submitLoanRequest(
  requester: Omit<Actor, "userId"> & { userId: number | null },
  logActor: LogActor,
  input: LoanInput,
): Promise<Result<{ id: number; requestId: number }>> {
  if (!requester.employeeId) return { error: "Only an employee may ask for a loan." };
  const loanType = input.loanType.trim();
  if (!loanType) return { error: "Choose what the loan is for." };
  if (!(input.principalPaise > 0)) return { error: "Enter an amount above zero." };
  if (input.annualRateBasisPoints < 0) return { error: "The interest rate cannot be negative." };
  if (!(input.tenureMonths > 0 && input.tenureMonths <= 120)) return { error: "Choose a tenure from 1 to 120 months." };
  if (!isDate(input.startDate)) return { error: "Enter a start date." };

  const existing = await one("SELECT id FROM py_loan WHERE employee_id = ? AND status IN ('Pending', 'Active')", [requester.employeeId]);
  if (existing) return { error: "There is already a loan open or waiting on a decision. Close it before asking for another." };

  const emiPaise = computeEmi(input.principalPaise, input.annualRateBasisPoints, input.tenureMonths);
  const summary = `${requester.displayName}: ${loanType} loan of ${formatINR(input.principalPaise)}`;
  const start = {
    process: "loan" as const,
    subjectType: "py_loan",
    subjectId: 0,
    subjectEmployeeId: requester.employeeId,
    requester: requester as Actor,
    summary,
    facts: {},
  };
  let plan: Awaited<ReturnType<typeof planRequest>>;
  try {
    plan = await planRequest(start);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "The request could not be started." };
  }

  const notices = await notificationStatements(
    plan.recipients.map((userId) => ({
      userId,
      kind: "approval.waiting" as const,
      title: `Waiting for your approval: ${summary}`,
      body: `${formatINR(emiPaise)} a month for ${input.tenureMonths} months, from ${input.startDate}.${input.reason ? ` "${input.reason}"` : ""}`,
      link: PROCESSES.loan.link,
      dedupeKey: `approval.waiting:loan:${requester.userId ?? requester.displayName}:${Date.now()}:${userId}`,
    })),
  );

  const at = now();
  const tx = await rawClient().transaction("write");
  let id: number;
  let requestId: number;
  try {
    const inserted = await tx.execute({
      sql: `INSERT INTO py_loan
              (employee_id, loan_type, principal_paise, annual_rate_basis_points, tenure_months, emi_paise, start_date, reason, status, requested_by, requested_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Pending', ?, ?) RETURNING id`,
      args: [requester.employeeId, loanType, input.principalPaise, input.annualRateBasisPoints, input.tenureMonths, emiPaise, input.startDate, input.reason, requester.displayName, at],
    });
    id = Number(inserted.rows[0].id);
    requestId = await writeRequest(tx, { ...start, subjectId: id }, plan);
    const logged = changeStatement(logActor, {
      entity: "py_loan",
      entityId: id,
      action: "create",
      after: { employeeId: requester.employeeId, loanType, principalPaise: input.principalPaise, emiPaise, tenureMonths: input.tenureMonths, status: "Pending" },
      reason: input.reason,
      subjectEmployeeId: requester.employeeId,
    });
    for (const st of [...(logged ? [logged] : []), ...notices]) await tx.execute(st);
    await tx.commit();
  } catch (err) {
    await tx.rollback();
    throw err;
  } finally {
    tx.close();
  }
  return { ok: true, value: { id, requestId } };
}

export async function withdrawLoanRequest(actor: Actor, logActor: LogActor, loanId: number): Promise<Result<true>> {
  const loan = await one("SELECT * FROM py_loan WHERE id = ?", [loanId]);
  if (!loan) return { error: "That loan no longer exists.", code: "not_found" };
  if (loan.employee_id !== actor.employeeId) return { error: "That is not your loan." };
  if (String(loan.status) !== "Pending") return { error: "Only a loan still waiting on a decision can be withdrawn." };

  const tx = await rawClient().transaction("write");
  try {
    await tx.execute({ sql: "UPDATE py_loan SET status = 'Rejected', decided_at = ? WHERE id = ?", args: [now(), loanId] });
    for (const st of await cancelStatements("py_loan", loanId, actor)) await tx.execute(st);
    const logged = changeStatement(logActor, { entity: "py_loan", entityId: loanId, action: "update", before: { status: "Pending" }, after: { status: "Rejected" }, reason: "Withdrawn" });
    if (logged) await tx.execute(logged);
    await tx.commit();
  } catch (err) {
    await tx.rollback();
    throw err;
  } finally {
    tx.close();
  }
  return { ok: true, value: true };
}

export async function recordPrepayment(
  logActor: LogActor,
  opts: { loanId: number; amountPaise: number; date: string; createdBy: string },
): Promise<Result<{ closed: boolean }>> {
  if (!isDate(opts.date)) return { error: "Enter a date." };
  const tx = await rawClient().transaction("write");
  try {
    const result = await prepayLoan(tx, opts);
    if ("error" in result) {
      await tx.rollback();
      return { error: result.error };
    }
    const loan = await tx.execute({ sql: "SELECT employee_id FROM py_loan WHERE id = ?", args: [opts.loanId] });
    const logged = changeStatement(logActor, {
      entity: "py_loan",
      entityId: opts.loanId,
      action: "update",
      before: {},
      after: { prepaymentPaise: opts.amountPaise, remainingInstalments: result.schedule.length, closed: result.closed },
      subjectEmployeeId: loan.rows[0] ? Number(loan.rows[0].employee_id) : null,
    });
    if (logged) await tx.execute(logged);
    await tx.commit();
    return { ok: true, value: { closed: result.closed } };
  } catch (err) {
    await tx.rollback();
    throw err;
  } finally {
    tx.close();
  }
}

export async function closeLoanRequest(logActor: LogActor, loanId: number): Promise<Result<true>> {
  const before = await one("SELECT employee_id FROM py_loan WHERE id = ?", [loanId]);
  const tx = await rawClient().transaction("write");
  try {
    const result = await closeLoan(tx, loanId);
    if (result.error) {
      await tx.rollback();
      return { error: result.error };
    }
    const logged = changeStatement(logActor, {
      entity: "py_loan",
      entityId: loanId,
      action: "update",
      before: { status: "Active" },
      after: { status: "Closed" },
      subjectEmployeeId: before ? Number(before.employee_id) : null,
    });
    if (logged) await tx.execute(logged);
    await tx.commit();
  } catch (err) {
    await tx.rollback();
    throw err;
  } finally {
    tx.close();
  }
  return { ok: true, value: true };
}
