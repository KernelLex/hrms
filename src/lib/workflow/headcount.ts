import "server-only";
import { changeStatement, type Actor as LogActor } from "@/lib/change-log";
import { OPEN_ENDED } from "@/db/schema";
import type { NotificationItem } from "@/lib/notifications";
import type { Completion } from "./engine";

/**
 * What deciding a headcount request does, inside the engine's transaction.
 *
 * Approving opens a new position against the department and job asked for —
 * vacant, carrying the budget asked for — so recruitment can open a
 * requisition against it like any other vacant position. Rejecting only
 * marks the request. Either way the manager who asked is told.
 */
export const completeHeadcount: Completion = async (tx, request, outcome) => {
  const { decision, actor, comment, decidedAt } = outcome;
  const logActor: LogActor = { type: "user", id: actor.userId, name: actor.username };
  const r = await tx.execute({ sql: "SELECT * FROM om_headcount_request WHERE id = ?", args: [Number(request.subjectId)] });
  const req = r.rows[0] as unknown as Record<string, unknown> | undefined;
  if (!req) return { error: "That request no longer exists." };
  if (String(req.status) !== "Pending") return { error: `That request was already ${String(req.status).toLowerCase()}.` };

  const requestId = Number(req.id);
  const claimed = await tx.execute({
    sql: "UPDATE om_headcount_request SET status = ?, decided_at = ?, decision_note = ? WHERE id = ? AND status = 'Pending'",
    args: [decision, decidedAt, comment, requestId],
  });
  if (claimed.rowsAffected === 0) return { error: `That request was already ${String(req.status).toLowerCase()}.` };

  const statements = [
    changeStatement(logActor, {
      entity: "om_headcount_request",
      entityId: requestId,
      action: "update",
      before: { status: "Pending" },
      after: { status: decision, decision_note: comment },
    }),
  ];
  for (const st of statements) if (st) await tx.execute(st);

  let positionCode: string | null = null;
  if (decision === "Approved") {
    const last = await tx.execute(
      "SELECT code FROM om_position WHERE code LIKE 'PS%' ORDER BY CAST(SUBSTR(code, 3) AS INTEGER) DESC LIMIT 1",
    );
    const lastNumber = last.rows[0] ? Number(String(last.rows[0].code).replace(/\D/g, "")) : 0;
    positionCode = `PS${String(lastNumber + 1).padStart(4, "0")}`;

    await tx.execute({
      sql: `INSERT INTO om_position (code, title, org_unit_code, job_code, is_manager, is_vacant, budget_paise, valid_from, valid_to, is_active)
            VALUES (?, ?, ?, ?, 0, 1, ?, ?, ?, 1)`,
      args: [positionCode, String(req.title), String(req.org_unit_code), String(req.job_code), Number(req.budget_paise), decidedAt.slice(0, 10), OPEN_ENDED],
    });
    await tx.execute({ sql: "UPDATE om_headcount_request SET position_code = ? WHERE id = ?", args: [positionCode, requestId] });
    const logged = changeStatement(logActor, {
      entity: "om_position",
      entityId: positionCode,
      action: "create",
      after: { title: req.title, orgUnitCode: req.org_unit_code, jobCode: req.job_code, budgetPaise: req.budget_paise, isVacant: true },
      reason: `Opened by headcount request #${requestId}`,
    });
    if (logged) await tx.execute(logged);
  }

  const approved = decision === "Approved";
  const requesterUserId = request.requesterUserId;
  const notices: NotificationItem[] = requesterUserId
    ? [
        {
          userId: requesterUserId,
          kind: "headcount_request.decided",
          title: approved ? `Your headcount request for ${String(req.title)} was approved` : `Your headcount request for ${String(req.title)} was not approved`,
          body: approved
            ? `${positionCode} is now open for recruitment to hire against.${comment ? ` ${comment}` : ""}`
            : (comment ?? "Ask HR if you want to know why."),
          link: "/headcount-requests",
          dedupeKey: `headcount_request.decided:${requestId}`,
        },
      ]
    : [];
  return { notices };
};
