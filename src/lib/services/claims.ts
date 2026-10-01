import "server-only";
import { rawClient } from "@/lib/db";
import { now } from "@/db/schema";
import { todayInIndia } from "@/lib/dates";
import { changeStatement, type Actor as LogActor } from "@/lib/change-log";
import { notificationStatements } from "@/lib/notifications";
import { planRequest, writeRequest, cancelStatements, type Actor } from "@/lib/workflow/engine";
import { PROCESSES } from "@/lib/workflow/processes";
import { queueClaimPayment } from "@/lib/engines/claims";
import { formatINR } from "@/lib/money";
import type { Result } from "./result";

/**
 * Submitting a claim checks it against the category's limit for the
 * employee's own grade right away, then starts the "claim" approval flow
 * (their reporting manager, then anyone holding the Finance role);
 * `workflow/claim.ts` pays it the moment it is approved. A claim the ERP's
 * own approval process already decided skips that flow entirely — it is
 * written straight in as Approved and paid the same way.
 */

const one = async (sql: string, args: (string | number)[]) =>
  (await rawClient().execute({ sql, args })).rows[0] as Record<string, unknown> | undefined;

export type ClaimLineInput = { date: string; description: string; amountPaise: number };
export type ClaimInput = { categoryCode: string; claimDate: string; lines: ClaimLineInput[] };

const isDate = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d);

/** The employee's own pay-scale group as of today — what a claim category's limit is set by. */
async function gradeOf(employeeId: number): Promise<string | null> {
  const today = todayInIndia();
  const r = await one(
    `SELECT pay_scale_group FROM pa_it0008_basic_pay
     WHERE employee_id = ? AND valid_from <= ? AND valid_to >= ? ORDER BY valid_from DESC LIMIT 1`,
    [employeeId, today, today],
  );
  return r?.pay_scale_group ? String(r.pay_scale_group) : null;
}

/** The category's limit for this grade — the grade-specific row if there is one, else the category's own default. */
async function limitFor(categoryCode: string, grade: string | null): Promise<number> {
  if (grade) {
    const specific = await one("SELECT annual_limit_paise FROM py_claim_category_limit WHERE category_code = ? AND grade = ?", [categoryCode, grade]);
    if (specific) return Number(specific.annual_limit_paise);
  }
  const category = await one("SELECT default_annual_limit_paise FROM py_claim_category WHERE code = ?", [categoryCode]);
  return category ? Number(category.default_annual_limit_paise) : 0;
}

/** What this employee has already claimed in this category this calendar year, pending or approved — a rejected claim never counted against the limit. */
async function claimedThisYear(employeeId: number, categoryCode: string, year: number): Promise<number> {
  const r = await one(
    `SELECT COALESCE(SUM(total_amount_paise), 0) AS total FROM py_claim
     WHERE employee_id = ? AND category_code = ? AND status IN ('Pending', 'Approved')
       AND claim_date >= ? AND claim_date <= ?`,
    [employeeId, categoryCode, `${year}-01-01`, `${year}-12-31`],
  );
  return r ? Number(r.total) : 0;
}

export async function submitClaimRequest(
  requester: Omit<Actor, "userId"> & { userId: number | null },
  logActor: LogActor,
  input: ClaimInput,
): Promise<Result<{ id: number; requestId: number }>> {
  if (!requester.employeeId) return { error: "Only an employee may submit a claim." };
  if (!isDate(input.claimDate)) return { error: "Enter a claim date." };
  if (input.lines.length === 0) return { error: "Add at least one line." };
  for (const l of input.lines) {
    if (!isDate(l.date)) return { error: "Enter a date for every line." };
    if (!l.description.trim()) return { error: "Describe every line." };
    if (!(l.amountPaise > 0)) return { error: "Every line needs an amount above zero." };
  }

  const category = await one("SELECT * FROM py_claim_category WHERE code = ? AND is_active = 1", [input.categoryCode]);
  if (!category) return { error: "That claim category does not exist." };

  const total = input.lines.reduce((s, l) => s + l.amountPaise, 0);
  const grade = await gradeOf(requester.employeeId);
  const limit = await limitFor(input.categoryCode, grade);
  const claimedSoFar = await claimedThisYear(requester.employeeId, input.categoryCode, Number(input.claimDate.slice(0, 4)));
  if (claimedSoFar + total > limit) {
    return { error: `This would take ${String(category.name)} claims this year to ${formatINR(claimedSoFar + total)}, over the ${formatINR(limit)} limit.` };
  }

  const summary = `${requester.displayName}: ${String(category.name)} claim of ${formatINR(total)}`;
  const start = {
    process: "claim" as const,
    subjectType: "py_claim",
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
      body: `${input.lines.length} line${input.lines.length === 1 ? "" : "s"}, ${formatINR(total)} in all.`,
      link: PROCESSES.claim.link,
      dedupeKey: `approval.waiting:claim:${requester.userId ?? requester.displayName}:${Date.now()}:${userId}`,
    })),
  );

  const at = now();
  const tx = await rawClient().transaction("write");
  let id: number;
  let requestId: number;
  try {
    const inserted = await tx.execute({
      sql: `INSERT INTO py_claim (employee_id, category_code, claim_date, total_amount_paise, status, requested_at)
            VALUES (?, ?, ?, ?, 'Pending', ?) RETURNING id`,
      args: [requester.employeeId, input.categoryCode, input.claimDate, total, at],
    });
    id = Number(inserted.rows[0].id);
    for (const l of input.lines) {
      await tx.execute({
        sql: "INSERT INTO py_claim_line (claim_id, line_date, description, amount_paise) VALUES (?, ?, ?, ?)",
        args: [id, l.date, l.description.trim(), l.amountPaise],
      });
    }
    requestId = await writeRequest(tx, { ...start, subjectId: id }, plan);
    const logged = changeStatement(logActor, {
      entity: "py_claim",
      entityId: id,
      action: "create",
      after: { employeeId: requester.employeeId, categoryCode: input.categoryCode, totalAmountPaise: total, lines: input.lines.length, status: "Pending" },
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

export async function withdrawClaimRequest(actor: Actor, logActor: LogActor, claimId: number): Promise<Result<true>> {
  const claim = await one("SELECT * FROM py_claim WHERE id = ?", [claimId]);
  if (!claim) return { error: "That claim no longer exists.", code: "not_found" };
  if (claim.employee_id !== actor.employeeId) return { error: "That is not your claim." };
  if (String(claim.status) !== "Pending") return { error: "Only a claim still waiting on a decision can be withdrawn." };

  const tx = await rawClient().transaction("write");
  try {
    await tx.execute({ sql: "UPDATE py_claim SET status = 'Rejected', decided_at = ? WHERE id = ?", args: [now(), claimId] });
    for (const st of await cancelStatements("py_claim", claimId, actor)) await tx.execute(st);
    const logged = changeStatement(logActor, { entity: "py_claim", entityId: claimId, action: "update", before: { status: "Pending" }, after: { status: "Rejected" }, reason: "Withdrawn" });
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

export type ExternalClaimInput = { employeeId: number; categoryCode: string; claimDate: string; lines: ClaimLineInput[] };

/**
 * A claim the ERP's own approval process already decided, arriving to be
 * paid through payroll instead of being retyped on screen. Still checked
 * against the category's limit — an HRMS payroll and tax policy the ERP's
 * own process has no reason to know — then written straight in as Approved
 * and queued for payment, with no HRMS-side approval step to wait on.
 */
export async function recordExternalClaim(logActor: LogActor, input: ExternalClaimInput): Promise<Result<{ id: number; wageTypeCode: string }>> {
  if (!isDate(input.claimDate)) return { error: "Enter a claim date." };
  if (input.lines.length === 0) return { error: "Add at least one line." };
  for (const l of input.lines) {
    if (!isDate(l.date)) return { error: "Enter a date for every line." };
    if (!l.description.trim()) return { error: "Describe every line." };
    if (!(l.amountPaise > 0)) return { error: "Every line needs an amount above zero." };
  }

  const category = await one("SELECT * FROM py_claim_category WHERE code = ? AND is_active = 1", [input.categoryCode]);
  if (!category) return { error: "That claim category does not exist." };

  const total = input.lines.reduce((s, l) => s + l.amountPaise, 0);
  const grade = await gradeOf(input.employeeId);
  const limit = await limitFor(input.categoryCode, grade);
  const claimedSoFar = await claimedThisYear(input.employeeId, input.categoryCode, Number(input.claimDate.slice(0, 4)));
  if (claimedSoFar + total > limit) {
    return { error: `This would take ${String(category.name)} claims this year to ${formatINR(claimedSoFar + total)}, over the ${formatINR(limit)} limit.` };
  }

  const at = now();
  const tx = await rawClient().transaction("write");
  try {
    const inserted = await tx.execute({
      sql: `INSERT INTO py_claim (employee_id, category_code, claim_date, total_amount_paise, status, requested_at, decided_at)
            VALUES (?, ?, ?, ?, 'Approved', ?, ?) RETURNING id`,
      args: [input.employeeId, input.categoryCode, input.claimDate, total, at, at],
    });
    const id = Number(inserted.rows[0].id);
    for (const l of input.lines) {
      await tx.execute({
        sql: "INSERT INTO py_claim_line (claim_id, line_date, description, amount_paise) VALUES (?, ?, ?, ?)",
        args: [id, l.date, l.description.trim(), l.amountPaise],
      });
    }
    const logged = changeStatement(logActor, {
      entity: "py_claim",
      entityId: id,
      action: "create",
      after: { employeeId: input.employeeId, categoryCode: input.categoryCode, totalAmountPaise: total, lines: input.lines.length, status: "Approved" },
      subjectEmployeeId: input.employeeId,
      reason: "Submitted already approved, from the ERP",
    });
    if (logged) await tx.execute(logged);
    const { wageTypeCode } = await queueClaimPayment(tx, logActor, {
      claimId: id,
      employeeId: input.employeeId,
      categoryCode: input.categoryCode,
      totalAmountPaise: total,
      paymentDate: input.claimDate,
    });
    await tx.commit();
    return { ok: true, value: { id, wageTypeCode } };
  } catch (err) {
    await tx.rollback();
    throw err;
  } finally {
    tx.close();
  }
}
