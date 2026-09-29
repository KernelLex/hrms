import "server-only";
import { rawClient } from "@/lib/db";
import { changeStatement, type Actor as LogActor } from "@/lib/change-log";
import { notificationStatements } from "@/lib/notifications";
import { planRequest, writeRequest, type Actor } from "@/lib/workflow/engine";
import { PROCESSES } from "@/lib/workflow/processes";
import type { Result } from "./result";

/**
 * A manager asking to grow the structure: a new position, before it exists.
 * Goes through the "headcount" approval flow (manager, then HR, then a
 * finance role by default); approved, `workflow/headcount.ts` opens the
 * position. My team and the API both come through here.
 */

export type HeadcountInput = {
  orgUnitCode: string;
  jobCode: string;
  title: string;
  grade: string | null;
  budgetPaise: number;
  reason: string | null;
};

const one = async (sql: string, args: (string | number)[]) =>
  (await rawClient().execute({ sql, args })).rows[0] as Record<string, unknown> | undefined;

export async function submitHeadcountRequest(
  requester: Omit<Actor, "userId"> & { userId: number | null },
  logActor: LogActor,
  input: HeadcountInput,
): Promise<Result<{ id: number; requestId: number }>> {
  const title = input.title.trim();
  if (!title) return { error: "Name the position, such as \"Senior developer\"." };
  if (!(input.budgetPaise > 0)) return { error: "Enter the monthly budget for the role." };

  const [unit, job] = await Promise.all([
    one("SELECT * FROM om_org_unit WHERE code = ? AND is_active = 1", [input.orgUnitCode]),
    one("SELECT * FROM om_job WHERE code = ? AND is_active = 1", [input.jobCode]),
  ]);
  if (!unit) return { error: "That department does not exist." };
  if (!job) return { error: "That job does not exist." };

  const summary = `${requester.displayName}: ${title} in ${String(unit.name)}`;
  const start = {
    process: "headcount" as const,
    subjectType: "om_headcount_request",
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
      body: `A new position asked for, budgeted at the monthly figure given.${input.reason ? ` "${input.reason}"` : ""}`,
      link: PROCESSES.headcount.link,
      dedupeKey: `approval.waiting:headcount:${requester.userId ?? requester.displayName}:${Date.now()}:${userId}`,
    })),
  );

  const at = new Date().toISOString();
  const tx = await rawClient().transaction("write");
  let id: number;
  let requestId: number;
  try {
    const inserted = await tx.execute({
      sql: `INSERT INTO om_headcount_request
              (org_unit_code, job_code, title, grade, budget_paise, reason, requested_by_employee_id,
               requested_by_name, status, requested_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Pending', ?) RETURNING id`,
      args: [input.orgUnitCode, input.jobCode, title, input.grade, input.budgetPaise, input.reason, requester.employeeId, requester.displayName, at],
    });
    id = Number(inserted.rows[0].id);
    requestId = await writeRequest(tx, { ...start, subjectId: id }, plan);
    const logged = changeStatement(logActor, {
      entity: "om_headcount_request",
      entityId: id,
      action: "create",
      after: { orgUnitCode: input.orgUnitCode, jobCode: input.jobCode, title, grade: input.grade, budgetPaise: input.budgetPaise, status: "Pending" },
      reason: input.reason,
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
