import "server-only";
import type { InStatement } from "@libsql/client";
import { changeStatement, type Actor as LogActor } from "@/lib/change-log";
import { writeTimeSlice } from "@/lib/engines/timeslice";
import { formatDate } from "@/lib/dates";
import { SECTIONS, describeChange, isSection } from "@/lib/corrections-values";
import type { NotificationItem } from "@/lib/notifications";
import type { Completion } from "./engine";

/**
 * What deciding a correction does, inside the engine's transaction.
 *
 * Approving writes the new values through the time-slice engine from the
 * effective date — the old record is closed the day before, never
 * overwritten — and the change log says who asked and who approved.
 * Rejecting only marks the request. Either way the employee is told.
 */
export const completeCorrection: Completion = async (tx, request, outcome) => {
  const { decision, actor, comment, decidedAt } = outcome;
  const logActor: LogActor = { type: "user", id: actor.userId, name: actor.username };
  const r = await tx.execute({ sql: "SELECT * FROM pa_change_request WHERE id = ?", args: [Number(request.subjectId)] });
  const change = r.rows[0] as unknown as Record<string, unknown> | undefined;
  if (!change) return { error: "That request no longer exists." };

  const id = Number(change.id);
  const employeeId = Number(change.employee_id);
  const section = String(change.section);
  if (!isSection(section)) return { error: "That request is for something that cannot be changed this way." };
  const subtype = change.subtype === null ? null : String(change.subtype);
  const effective = String(change.effective_date);
  const approved = decision === "Approved";

  const claimed = await tx.execute({
    sql: "UPDATE pa_change_request SET status = ?, decided_at = ?, decision_note = ? WHERE id = ? AND status = 'Pending'",
    args: [decision, decidedAt, comment, id],
  });
  if (claimed.rowsAffected === 0) return { error: `That request was already ${String(change.status).toLowerCase()}.` };

  const statements: (InStatement | null)[] = [
    changeStatement(logActor, {
      entity: "pa_change_request",
      entityId: id,
      subjectEmployeeId: employeeId,
      action: "update",
      before: { status: "Pending" },
      after: { status: decision, decision_note: comment },
    }),
  ];
  for (const st of statements) if (st) await tx.execute(st);

  if (approved) {
    // Everyone who approved a step, this one included, for the record.
    const earlier = await tx.execute({
      sql: "SELECT DISTINCT actor_name FROM wf_action WHERE request_id = ? AND decision = 'Approved'",
      args: [request.id],
    });
    const approvers = [...new Set([...earlier.rows.map((a) => String(a.actor_name)), actor.username])];
    const reason = `Requested by ${String(change.requested_by_name)}; approved by ${approvers.join(" and ")}`;
    const proposed = JSON.parse(String(change.proposed)) as Record<string, string | null>;
    const fields = Object.fromEntries(Object.keys(SECTIONS[section].fields).map((f) => [f, proposed[f] ?? null]));
    const common = { employeeId, validFrom: effective, createdBy: actor.username, actor: logActor, reason };

    if (section === "personal") {
      await writeTimeSlice(tx, { ...common, table: "pa_it0002_personal_data", data: fields });
    } else if (section === "bank") {
      await writeTimeSlice(tx, { ...common, table: "pa_it0009_bank_details", data: fields });
    } else if (section === "address") {
      await writeTimeSlice(tx, {
        ...common,
        table: "pa_it0006_address",
        match: { column: "address_type", value: subtype ?? "Permanent" },
        data: { address_type: subtype ?? "Permanent", ...fields },
      });
    } else {
      await writeTimeSlice(tx, {
        ...common,
        table: "pa_it0105_communication",
        match: { column: "comm_type", value: subtype ?? "" },
        data: { comm_type: subtype ?? "", value: fields.value },
      });
    }
  }

  const user = await tx.execute({
    sql: "SELECT id FROM sec_app_user WHERE employee_id = ? AND is_active = 1 LIMIT 1",
    args: [employeeId],
  });
  const what = describeChange(section, subtype).toLowerCase();
  const notices: NotificationItem[] = user.rows[0]
    ? [
        {
          userId: Number(user.rows[0].id),
          kind: "change_request.decided",
          title: approved ? `Your change to your ${what} was approved` : `Your change to your ${what} was not approved`,
          body: approved
            ? `It applies from ${formatDate(effective)}.${comment ? ` ${comment}` : ""}`
            : (comment ?? "Ask HR if you want to know why, or send it again with more detail."),
          link: "/me",
          dedupeKey: `change_request.decided:${id}`,
        },
      ]
    : [];
  return { notices };
};
