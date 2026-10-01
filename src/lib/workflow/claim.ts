import "server-only";
import { changeStatement, type Actor as LogActor } from "@/lib/change-log";
import type { NotificationItem } from "@/lib/notifications";
import { formatINR } from "@/lib/money";
import { queueClaimPayment } from "@/lib/engines/claims";
import type { Completion } from "./engine";

/**
 * What deciding a claim does, inside the engine's transaction.
 *
 * Approving queues the whole claim as one one-off payment — through the same
 * `py_it0015_additional_payment` rail leave encashment, overtime and a loan
 * instalment already use — on the wage type its category's taxability picks:
 * REIMB if it is not taxable, CLAIM if it is. Rejecting only marks the claim.
 */
export const completeClaim: Completion = async (tx, request, outcome) => {
  const { decision, actor, comment, decidedAt } = outcome;
  const logActor: LogActor = { type: "user", id: actor.userId, name: actor.username };
  const r = await tx.execute({ sql: "SELECT * FROM py_claim WHERE id = ?", args: [Number(request.subjectId)] });
  const claim = r.rows[0] as unknown as Record<string, unknown> | undefined;
  if (!claim) return { error: "That claim no longer exists." };
  if (String(claim.status) !== "Pending") return { error: `That claim was already ${String(claim.status).toLowerCase()}.` };

  const claimId = Number(claim.id);
  const approved = decision === "Approved";
  const claimed = await tx.execute({
    sql: "UPDATE py_claim SET status = ?, decided_at = ?, decision_note = ? WHERE id = ? AND status = 'Pending'",
    args: [approved ? "Approved" : "Rejected", decidedAt, comment, claimId],
  });
  if (claimed.rowsAffected === 0) return { error: "That claim was already decided." };

  if (approved) {
    await queueClaimPayment(tx, logActor, {
      claimId,
      employeeId: Number(claim.employee_id),
      categoryCode: String(claim.category_code),
      totalAmountPaise: Number(claim.total_amount_paise),
      paymentDate: decidedAt.slice(0, 10),
    });
  }

  const logged = changeStatement(logActor, {
    entity: "py_claim",
    entityId: claimId,
    action: "update",
    before: { status: "Pending" },
    after: { status: approved ? "Approved" : "Rejected", decision_note: comment },
  });
  if (logged) await tx.execute(logged);

  const requesterUserId = request.requesterUserId;
  const notices: NotificationItem[] = requesterUserId
    ? [
        {
          userId: requesterUserId,
          kind: "claim.decided",
          title: approved ? "Your claim was approved" : "Your claim was not approved",
          body: approved
            ? `${formatINR(Number(claim.total_amount_paise))} will be paid in the next payroll run.`
            : (comment ?? "Ask HR if you want to know why."),
          link: "/loans-claims/my-claims",
          dedupeKey: `claim.decided:${claimId}`,
        },
      ]
    : [];
  return { notices };
};
