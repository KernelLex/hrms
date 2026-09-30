import "server-only";
import { changeStatement, type Actor as LogActor } from "@/lib/change-log";
import { recordPunches, finalizeAttendanceDay } from "@/lib/engines/attendance";
import { formatDateRange } from "@/lib/dates";
import type { NotificationItem } from "@/lib/notifications";
import type { Completion } from "./engine";

/**
 * What deciding a regularisation does, inside the engine's transaction.
 *
 * Approving adds the claimed in and out as punches from a "Regularised"
 * pseudo-device, then re-runs the same day-finalising logic a punch import
 * would — so an approved regularisation corrects the day exactly the way a
 * missed punch, if it had been recorded, would have. Rejecting only marks
 * the request; the day stands as the punches already show it.
 */
export const completeRegularisation: Completion = async (tx, request, outcome) => {
  const { decision, actor, comment, decidedAt } = outcome;
  const logActor: LogActor = { type: "user", id: actor.userId, name: actor.username };
  const r = await tx.execute({ sql: "SELECT * FROM pt_regularisation WHERE id = ?", args: [Number(request.subjectId)] });
  const req = r.rows[0] as unknown as Record<string, unknown> | undefined;
  if (!req) return { error: "That regularisation no longer exists." };

  const id = Number(req.id);
  const employeeId = Number(req.employee_id);
  const date = String(req.date);

  const claimed = await tx.execute({
    sql: "UPDATE pt_regularisation SET status = ?, decided_at = ?, decided_by_employee_id = ?, decision_note = ? WHERE id = ? AND status = 'Pending'",
    args: [decision, decidedAt, actor.employeeId, comment, id],
  });
  if (claimed.rowsAffected === 0) return { error: `That request was already ${String(req.status).toLowerCase()}.` };

  const logged = changeStatement(logActor, {
    entity: "pt_regularisation",
    entityId: id,
    subjectEmployeeId: employeeId,
    action: "update",
    before: { status: "Pending" },
    after: { status: decision, decisionNote: comment },
  });
  if (logged) await tx.execute(logged);

  if (decision === "Approved") {
    const punches = [];
    if (req.claimed_in) punches.push({ employeeId, deviceCode: "REGULARISED", at: String(req.claimed_in), direction: "In" as const, source: "Regularised" as const });
    if (req.claimed_out) punches.push({ employeeId, deviceCode: "REGULARISED", at: String(req.claimed_out), direction: "Out" as const, source: "Regularised" as const });
    if (punches.length > 0) await recordPunches(tx, punches);
    await finalizeAttendanceDay(tx, employeeId, date, logActor);
  }

  const user = await tx.execute({ sql: "SELECT id FROM sec_app_user WHERE employee_id = ? AND is_active = 1 LIMIT 1", args: [employeeId] });
  const range = formatDateRange(date, date);
  const notices: NotificationItem[] = user.rows[0]
    ? [
        {
          userId: Number(user.rows[0].id),
          kind: "regularisation.decided",
          title: decision === "Approved" ? `Your attendance for ${range} was corrected` : `Your regularisation for ${range} was not approved`,
          body: comment ?? (decision === "Approved" ? "The day now shows what you claimed." : "Talk to your manager if you want to ask again."),
          link: "/time/my-attendance",
          dedupeKey: `regularisation.decided:${id}`,
        },
      ]
    : [];
  return { notices };
};
