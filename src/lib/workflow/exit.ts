import "server-only";
import { changeStatement, type Actor as LogActor } from "@/lib/change-log";
import { usersWithPermission, type NotificationItem } from "@/lib/notifications";
import { noticeShortfallDays } from "@/lib/engines/exits";
import type { Completion } from "./engine";

/**
 * What deciding a resignation does, inside the engine's transaction.
 *
 * Approving fixes the last day at what was asked for and leaves everything
 * else — clearance, the termination itself, the settlement — for the last
 * day: nothing is paid or changed on the record yet. Rejecting only marks
 * the exit, so the employee's record is untouched and they keep working.
 *
 * One thing is told at approval rather than left to the last day: a last day
 * that does not serve the notice period. Whoever runs payroll hears about it
 * as soon as it is approved, because the shortfall is theirs to recover — or
 * for HR to waive on the exit board — and waiting until the settlement runs
 * would be too late to decide either.
 */
export const completeExit: Completion = async (tx, request, outcome) => {
  const { decision, actor, comment, decidedAt } = outcome;
  const logActor: LogActor = { type: "user", id: actor.userId, name: actor.username };
  const r = await tx.execute({ sql: "SELECT * FROM pa_exit WHERE id = ?", args: [Number(request.subjectId)] });
  const exit = r.rows[0] as unknown as Record<string, unknown> | undefined;
  if (!exit) return { error: "That exit no longer exists." };
  if (String(exit.status) !== "Pending") return { error: `That exit was already ${String(exit.status).toLowerCase()}.` };

  const exitId = Number(exit.id);
  const approved = decision === "Approved";
  const lastDay = String(exit.requested_last_day);
  const claimed = await tx.execute({
    sql: "UPDATE pa_exit SET status = ?, decided_at = ?, decision_note = ?, approved_last_day = ? WHERE id = ? AND status = 'Pending'",
    args: [approved ? "Approved" : "Rejected", decidedAt, comment, approved ? lastDay : null, exitId],
  });
  if (claimed.rowsAffected === 0) return { error: "That exit was already decided." };

  const logged = changeStatement(logActor, {
    entity: "pa_exit",
    entityId: exitId,
    subjectEmployeeId: Number(exit.employee_id),
    action: "update",
    before: { status: "Pending" },
    after: approved ? { status: "Approved", approvedLastDay: lastDay } : { status: "Rejected", decisionNote: comment },
  });
  if (logged) await tx.execute(logged);

  const requesterUserId = request.requesterUserId;
  const notices: NotificationItem[] = requesterUserId
    ? [
        {
          userId: requesterUserId,
          kind: "exit.decided",
          title: approved ? "Your resignation was accepted" : "Your resignation was not accepted",
          body: approved ? `Your last day is ${lastDay}.` : (comment ?? "Ask HR if you want to know why."),
          link: "/exit",
          dedupeKey: `exit.decided:${exitId}`,
        },
      ]
    : [];

  if (approved && !exit.notice_waived) {
    const shortfall = noticeShortfallDays(Number(exit.notice_days), String(exit.requested_at).slice(0, 10), lastDay);
    if (shortfall > 0) {
      for (const userId of await usersWithPermission("payroll.run")) {
        notices.push({
          userId,
          kind: "exit.notice_shortfall",
          title: `${request.summary.split(":")[0]} is leaving ${shortfall} day${shortfall === 1 ? "" : "s"} short of notice`,
          body: `Their last day is ${lastDay}. The shortfall is recovered in their final settlement at their basic pay, unless HR waives it on the exit board.`,
          link: "/exits",
          dedupeKey: `exit.notice_shortfall:${exitId}:${userId}`,
        });
      }
    }
  }
  return { notices };
};
