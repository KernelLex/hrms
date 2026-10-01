import "server-only";
import { changeStatement, type Actor as LogActor } from "@/lib/change-log";
import type { NotificationItem } from "@/lib/notifications";
import { formatINR } from "@/lib/money";
import { generateSchedule, benchmarkRateFor, monthlyPerquisite } from "@/lib/engines/loans";
import type { Completion } from "./engine";

/**
 * What deciding a loan request does, inside the engine's transaction.
 *
 * Approving generates the whole EMI schedule at once and moves the loan
 * straight to Active — there is no separate "approved but not yet scheduled"
 * state. Rejecting only marks the request. Either way the employee is told.
 */
export const completeLoan: Completion = async (tx, request, outcome) => {
  const { decision, actor, comment, decidedAt } = outcome;
  const logActor: LogActor = { type: "user", id: actor.userId, name: actor.username };
  const r = await tx.execute({ sql: "SELECT * FROM py_loan WHERE id = ?", args: [Number(request.subjectId)] });
  const loan = r.rows[0] as unknown as Record<string, unknown> | undefined;
  if (!loan) return { error: "That loan no longer exists." };
  if (String(loan.status) !== "Pending") return { error: `That loan was already ${String(loan.status).toLowerCase()}.` };

  const loanId = Number(loan.id);
  const approved = decision === "Approved";
  const nextStatus = approved ? "Active" : "Rejected";
  const claimed = await tx.execute({
    sql: "UPDATE py_loan SET status = ?, decided_at = ? WHERE id = ? AND status = 'Pending'",
    args: [nextStatus, decidedAt, loanId],
  });
  if (claimed.rowsAffected === 0) return { error: "That loan was already decided." };

  let instalments = 0;
  if (approved) {
    const principal = Number(loan.principal_paise);
    const rate = Number(loan.annual_rate_basis_points);
    const schedule = generateSchedule({
      principalPaise: principal,
      annualRateBasisPoints: rate,
      tenureMonths: Number(loan.tenure_months),
      emiPaise: Number(loan.emi_paise),
      startDate: String(loan.start_date),
    });
    const benchmark = await benchmarkRateFor(decidedAt.slice(0, 10));
    for (const row of schedule) {
      const perquisite = monthlyPerquisite(row.openingBalancePaise, principal, rate, benchmark);
      await tx.execute({
        sql: `INSERT INTO py_loan_schedule
                (loan_id, installment_no, due_date, opening_balance_paise, principal_paise, interest_paise, closing_balance_paise, perquisite_value_paise)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [loanId, row.installmentNo, row.dueDate, row.openingBalancePaise, row.principalPaise, row.interestPaise, row.closingBalancePaise, perquisite],
      });
    }
    instalments = schedule.length;
  }

  const logged = changeStatement(logActor, {
    entity: "py_loan",
    entityId: loanId,
    action: "update",
    before: { status: "Pending" },
    after: approved ? { status: "Active", instalments } : { status: "Rejected", decision_note: comment },
  });
  if (logged) await tx.execute(logged);

  const requesterUserId = request.requesterUserId;
  const notices: NotificationItem[] = requesterUserId
    ? [
        {
          userId: requesterUserId,
          kind: "loan.decided",
          title: approved ? "Your loan was approved" : "Your loan was not approved",
          body: approved
            ? `${formatINR(Number(loan.principal_paise))} over ${instalments} instalments of ${formatINR(Number(loan.emi_paise))}, starting ${String(loan.start_date)}.`
            : (comment ?? "Ask HR if you want to know why."),
          link: "/loans-claims/my-loans",
          dedupeKey: `loan.decided:${loanId}`,
        },
      ]
    : [];
  return { notices };
};
