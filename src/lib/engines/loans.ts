import "server-only";
import type { InStatement } from "@libsql/client";
import { rawClient } from "@/lib/db";
import { now } from "@/db/schema";
import { changeStatement, systemActor } from "@/lib/change-log";

/**
 * The loan engine: an EMI schedule, a prepayment, closure, and the monthly
 * perquisite value a concessional loan carries.
 *
 * An instalment reaches payroll the same way an encashment or an overtime
 * payment already does — queued onto `py_it0015_additional_payment`, the one
 * rail every one-off payment shares — so the payroll engine itself needs no
 * change to deduct it exactly once.
 */

type Executor = { execute: (s: InStatement) => Promise<{ rows: unknown[]; rowsAffected: number }> };

export type ScheduleRow = {
  installmentNo: number;
  dueDate: string;
  openingBalancePaise: number;
  principalPaise: number;
  interestPaise: number;
  closingBalancePaise: number;
};

/** `date` plus `n` months, clamped to the shorter month's last day rather than overflowing into the one after. */
function addMonths(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d.toISOString().slice(0, 10);
}

/** A standard EMI, reducing balance, rounded to the nearest paisa. 0% interest just divides the principal evenly. */
export function computeEmi(principalPaise: number, annualRateBasisPoints: number, tenureMonths: number): number {
  if (annualRateBasisPoints === 0) return Math.round(principalPaise / tenureMonths);
  const r = annualRateBasisPoints / 10_000 / 12;
  const factor = Math.pow(1 + r, tenureMonths);
  return Math.round((principalPaise * r * factor) / (factor - 1));
}

/**
 * The amortisation schedule an approved loan generates once, from its start
 * date: each instalment's own interest on the balance it started the month
 * with, the rest recovering principal, and the last instalment closing the
 * balance to exactly zero whatever rounding the others left.
 */
export function generateSchedule(opts: {
  principalPaise: number;
  annualRateBasisPoints: number;
  tenureMonths: number;
  emiPaise: number;
  startDate: string;
}): ScheduleRow[] {
  const { principalPaise, annualRateBasisPoints, tenureMonths, emiPaise, startDate } = opts;
  const r = annualRateBasisPoints / 10_000 / 12;
  const rows: ScheduleRow[] = [];
  let balance = principalPaise;
  for (let i = 1; i <= tenureMonths; i++) {
    const opening = balance;
    const interest = Math.round(opening * r);
    const isLast = i === tenureMonths;
    const principal = isLast ? opening : Math.min(opening, emiPaise - interest);
    const closing = opening - principal;
    rows.push({ installmentNo: i, dueDate: addMonths(startDate, i), openingBalancePaise: opening, principalPaise: principal, interestPaise: interest, closingBalancePaise: closing });
    balance = closing;
  }
  return rows;
}

/** The SBI-style benchmark rate rule 3(7)(i) compares a loan's own rate against, as of a date. */
export async function benchmarkRateFor(date: string): Promise<number> {
  const r = await rawClient().execute({
    sql: "SELECT rate_basis_points FROM py_loan_benchmark_rate WHERE valid_from <= ? AND valid_to >= ? ORDER BY valid_from DESC LIMIT 1",
    args: [date, date],
  });
  return r.rows[0] ? Number(r.rows[0].rate_basis_points) : 0;
}

const PERQUISITE_EXEMPT_PRINCIPAL_PAISE = 2_000_000; // ₹20,000, rule 3(7)(i)

/**
 * What rule 3(7)(i) would add to taxable income for one month: the gap
 * between the benchmark rate and what the loan actually charges, on the
 * balance the month started with — nothing for a small loan, and nothing
 * once the loan's own rate already meets or beats the benchmark.
 */
export function monthlyPerquisite(openingBalancePaise: number, principalPaise: number, loanRateBasisPoints: number, benchmarkRateBasisPoints: number): number {
  if (principalPaise <= PERQUISITE_EXEMPT_PRINCIPAL_PAISE) return 0;
  const diff = benchmarkRateBasisPoints - loanRateBasisPoints;
  if (diff <= 0) return 0;
  return Math.round((openingBalancePaise * diff) / 10_000 / 12);
}

/**
 * A lump-sum prepayment against the balance as of today: reduces the balance
 * immediately, then recomputes every instalment not yet queued from the
 * smaller balance at the same EMI, so what shortens is how many instalments
 * are left, not the size of each. A prepayment that clears the balance
 * entirely closes the loan.
 */
export async function prepayLoan(
  tx: Executor,
  opts: { loanId: number; amountPaise: number; date: string; createdBy: string },
): Promise<{ error: string } | { schedule: ScheduleRow[]; closed: boolean }> {
  if (!(opts.amountPaise > 0)) return { error: "Enter a prepayment above zero." };
  const loanRows = await tx.execute({ sql: "SELECT * FROM py_loan WHERE id = ?", args: [opts.loanId] });
  const loan = loanRows.rows[0] as Record<string, unknown> | undefined;
  if (!loan) return { error: "That loan no longer exists." };
  if (String(loan.status) !== "Active") return { error: "Only an active loan can be prepaid." };

  const scheduleRows = await tx.execute({ sql: "SELECT * FROM py_loan_schedule WHERE loan_id = ? ORDER BY installment_no", args: [opts.loanId] });
  const schedule = scheduleRows.rows as unknown as Record<string, unknown>[];
  const queued = schedule.filter((s) => s.additional_payment_id !== null);
  const unqueued = schedule.filter((s) => s.additional_payment_id === null);
  if (unqueued.length === 0) return { error: "Nothing is left on this loan to prepay." };
  const balanceNow = queued.length > 0 ? Number(queued[queued.length - 1].closing_balance_paise) : Number(loan.principal_paise);
  if (opts.amountPaise > balanceNow) return { error: "The prepayment cannot be more than the outstanding balance." };

  await tx.execute({
    sql: "INSERT INTO py_loan_prepayment (loan_id, payment_date, amount_paise, created_by, created_at) VALUES (?, ?, ?, ?, ?)",
    args: [opts.loanId, opts.date, opts.amountPaise, opts.createdBy, now()],
  });
  for (const s of unqueued) await tx.execute({ sql: "DELETE FROM py_loan_schedule WHERE id = ?", args: [Number(s.id)] });

  const emi = Number(loan.emi_paise);
  const rate = Number(loan.annual_rate_basis_points);
  const r = rate / 10_000 / 12;
  const startDate = String(loan.start_date);
  const firstNewNo = Number(unqueued[0].installment_no);

  const rows: ScheduleRow[] = [];
  let balance = balanceNow - opts.amountPaise;
  let n = firstNewNo;
  while (balance > 0) {
    const opening = balance;
    const interest = Math.round(opening * r);
    const principal = Math.min(opening, Math.max(1, emi - interest));
    const closing = opening - principal;
    rows.push({ installmentNo: n, dueDate: addMonths(startDate, n), openingBalancePaise: opening, principalPaise: principal, interestPaise: interest, closingBalancePaise: closing });
    balance = closing;
    n += 1;
  }
  for (const row of rows) {
    await tx.execute({
      sql: `INSERT INTO py_loan_schedule (loan_id, installment_no, due_date, opening_balance_paise, principal_paise, interest_paise, closing_balance_paise, perquisite_value_paise)
            VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
      args: [opts.loanId, row.installmentNo, row.dueDate, row.openingBalancePaise, row.principalPaise, row.interestPaise, row.closingBalancePaise],
    });
  }
  const closed = rows.length === 0;
  if (closed) await tx.execute({ sql: "UPDATE py_loan SET status = 'Closed' WHERE id = ?", args: [opts.loanId] });
  return { schedule: rows, closed };
}

/** Stops future recovery: deletes whatever instalments were not yet queued onto payroll, and closes the loan. */
export async function closeLoan(tx: Executor, loanId: number): Promise<{ error?: string }> {
  const loanRows = await tx.execute({ sql: "SELECT status FROM py_loan WHERE id = ?", args: [loanId] });
  const loan = loanRows.rows[0] as Record<string, unknown> | undefined;
  if (!loan) return { error: "That loan no longer exists." };
  if (String(loan.status) !== "Active") return { error: "Only an active loan can be closed." };
  await tx.execute({ sql: "DELETE FROM py_loan_schedule WHERE loan_id = ? AND additional_payment_id IS NULL", args: [loanId] });
  await tx.execute({ sql: "UPDATE py_loan SET status = 'Closed' WHERE id = ?", args: [loanId] });
  return {};
}

/**
 * Queues whatever instalments have come due since this last ran: one
 * `py_it0015_additional_payment` each, dated to the instalment's own due
 * date so the regular run of that month picks it up. A loan that has just
 * queued its last instalment closes itself.
 */
export async function queueDueLoanInstallments(asOfDate: string): Promise<number> {
  const due = await rawClient().execute({
    sql: `SELECT s.id, s.loan_id, s.due_date, s.principal_paise, s.interest_paise, l.employee_id
          FROM py_loan_schedule s JOIN py_loan l ON l.id = s.loan_id
          WHERE l.status = 'Active' AND s.additional_payment_id IS NULL AND s.due_date <= ?
          ORDER BY s.loan_id, s.installment_no`,
    args: [asOfDate],
  });
  let queued = 0;
  for (const row of due.rows) {
    const amount = Number(row.principal_paise) + Number(row.interest_paise);
    const inserted = await rawClient().execute({
      sql: `INSERT INTO py_it0015_additional_payment (employee_id, wage_type_code, amount_paise, payment_date, created_at)
            VALUES (?, 'LOAN', ?, ?, ?) RETURNING id`,
      args: [Number(row.employee_id), amount, String(row.due_date), now()],
    });
    await rawClient().execute({
      sql: "UPDATE py_loan_schedule SET additional_payment_id = ? WHERE id = ?",
      args: [Number(inserted.rows[0].id), Number(row.id)],
    });
    queued += 1;

    const remaining = await rawClient().execute({
      sql: "SELECT COUNT(*) AS n FROM py_loan_schedule WHERE loan_id = ? AND additional_payment_id IS NULL",
      args: [Number(row.loan_id)],
    });
    if (Number(remaining.rows[0].n) === 0) {
      await rawClient().execute({ sql: "UPDATE py_loan SET status = 'Closed' WHERE id = ?", args: [Number(row.loan_id)] });
      // Logged, so the ERP hears loan.closed even when nobody closed it by hand.
      const logged = changeStatement(systemActor("loans"), {
        entity: "py_loan",
        entityId: Number(row.loan_id),
        subjectEmployeeId: Number(row.employee_id),
        action: "update",
        before: { status: "Active" },
        after: { status: "Closed" },
      });
      if (logged) await rawClient().execute(logged);
    }
  }
  return queued;
}
