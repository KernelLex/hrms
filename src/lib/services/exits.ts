import "server-only";
import { rawClient } from "@/lib/db";
import { now } from "@/db/schema";
import { changeStatement, systemActor, type Actor as LogActor } from "@/lib/change-log";
import { notificationStatements, notify } from "@/lib/notifications";
import { planRequest, writeRequest, cancelStatements, type Actor } from "@/lib/workflow/engine";
import { PROCESSES } from "@/lib/workflow/processes";
import { writeTimeSlice, readAsOf, SLICED_TABLES } from "@/lib/engines/timeslice";
import { encashLeave } from "@/lib/engines/leave-policy";
import { recoverLoanAtExit } from "@/lib/engines/loans";
import { gratuityYears, computeGratuity, noticeShortfallDays, noticePayPaise } from "@/lib/engines/exits";
import { runPayroll } from "@/lib/engines/payroll";
import { startOffboarding } from "@/lib/services/checklist";
import { formatINR } from "@/lib/money";
import type { Result } from "./result";

/**
 * Resigning starts the "exit" approval flow (reporting manager, then anyone
 * holding HR_ADMIN); `workflow/exit.ts` fixes the last day the moment it is
 * approved. `settleExit` is the rest, run on or after that day — by the
 * daily job automatically, or by hand from the exit board: the termination
 * through the time-slice engine, clearance started, every settlement
 * component queued as a one-off payment, and one off-cycle run that pays
 * them all together.
 */

const one = async (sql: string, args: (string | number)[]) =>
  (await rawClient().execute({ sql, args })).rows[0] as Record<string, unknown> | undefined;
const all = async (sql: string, args: (string | number)[] = []) =>
  (await rawClient().execute({ sql, args })).rows as unknown as Record<string, unknown>[];

export const DEFAULT_NOTICE_DAYS = 30;

const isDate = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d);

export type ExitInput = {
  exitType: "Resignation" | "Termination" | "Retirement";
  requestedLastDay: string;
  reason: string | null;
  noticeDays: number;
};

export async function submitExitRequest(
  requester: Omit<Actor, "userId"> & { userId: number | null },
  logActor: LogActor,
  input: ExitInput,
): Promise<Result<{ id: number; requestId: number }>> {
  if (!requester.employeeId) return { error: "Only an employee may resign." };
  if (!isDate(input.requestedLastDay)) return { error: "Enter a last working day." };
  if (!(input.noticeDays >= 0)) return { error: "Enter a notice period of zero days or more." };

  const existing = await one("SELECT id FROM pa_exit WHERE employee_id = ? AND status IN ('Pending', 'Approved')", [requester.employeeId]);
  if (existing) return { error: "There is already an exit open or waiting on a decision." };

  const summary = `${requester.displayName}: ${input.exitType.toLowerCase()}, last day ${input.requestedLastDay}`;
  const start = {
    process: "exit" as const,
    subjectType: "pa_exit",
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
      body: input.reason ? `"${input.reason}"` : "",
      link: PROCESSES.exit.link,
      dedupeKey: `approval.waiting:exit:${requester.userId ?? requester.displayName}:${Date.now()}:${userId}`,
    })),
  );

  const at = now();
  const tx = await rawClient().transaction("write");
  let id: number;
  let requestId: number;
  try {
    const inserted = await tx.execute({
      sql: `INSERT INTO pa_exit (employee_id, exit_type, reason, requested_last_day, notice_days, status, requested_by, requested_at)
            VALUES (?, ?, ?, ?, ?, 'Pending', ?, ?) RETURNING id`,
      args: [requester.employeeId, input.exitType, input.reason, input.requestedLastDay, input.noticeDays, requester.displayName, at],
    });
    id = Number(inserted.rows[0].id);
    requestId = await writeRequest(tx, { ...start, subjectId: id }, plan);
    const logged = changeStatement(logActor, {
      entity: "pa_exit",
      entityId: id,
      action: "create",
      after: { employeeId: requester.employeeId, exitType: input.exitType, requestedLastDay: input.requestedLastDay, noticeDays: input.noticeDays, status: "Pending" },
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

export async function withdrawExitRequest(actor: Actor, logActor: LogActor, exitId: number): Promise<Result<true>> {
  const exit = await one("SELECT * FROM pa_exit WHERE id = ?", [exitId]);
  if (!exit) return { error: "That exit no longer exists.", code: "not_found" };
  if (exit.employee_id !== actor.employeeId) return { error: "That is not your exit." };
  if (String(exit.status) !== "Pending") return { error: "Only an exit still waiting on a decision can be withdrawn." };

  const tx = await rawClient().transaction("write");
  try {
    await tx.execute({ sql: "UPDATE pa_exit SET status = 'Withdrawn', decided_at = ? WHERE id = ?", args: [now(), exitId] });
    for (const st of await cancelStatements("pa_exit", exitId, actor)) await tx.execute(st);
    const logged = changeStatement(logActor, { entity: "pa_exit", entityId: exitId, action: "update", before: { status: "Pending" }, after: { status: "Withdrawn" }, reason: "Withdrawn" });
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

export async function recordExitInterview(
  logActor: LogActor,
  opts: { exitId: number; primaryReason: string | null; wouldRecommend: boolean | null; comments: string | null; submittedBy: string },
): Promise<Result<true>> {
  const exit = await one("SELECT * FROM pa_exit WHERE id = ?", [opts.exitId]);
  if (!exit) return { error: "That exit no longer exists.", code: "not_found" };
  const at = now();
  await rawClient().execute({
    sql: `INSERT INTO pa_exit_interview (exit_id, primary_reason, would_recommend, comments, submitted_by, submitted_at)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT (exit_id) DO UPDATE SET primary_reason = excluded.primary_reason, would_recommend = excluded.would_recommend, comments = excluded.comments, submitted_at = excluded.submitted_at`,
    args: [opts.exitId, opts.primaryReason, opts.wouldRecommend === null ? null : opts.wouldRecommend ? 1 : 0, opts.comments, opts.submittedBy, at],
  });
  return { ok: true, value: true };
}

/** The settlement's own wage types, for a human label on the statement. */
const COMPONENT_LABELS: Record<string, string> = {
  LENC: "Leave encashment",
  NOTICE: "Notice pay recovery",
  GRAT: "Gratuity",
  LOAN: "Loan recovery",
  CLAIM: "Reimbursement claim",
  REIMB: "Reimbursement claim",
  BONUS: "Bonus",
};

/**
 * Runs the termination and settlement for one approved exit, on or after its
 * last day. Safe to call more than once: an exit already exited is skipped
 * rather than paid twice.
 */
export async function settleExit(logActor: LogActor, exitId: number): Promise<Result<{ runId: number | null }>> {
  const exit = await one("SELECT * FROM pa_exit WHERE id = ?", [exitId]);
  if (!exit) return { error: "That exit no longer exists.", code: "not_found" };
  // Checked before status: once settled, status has already moved on to
  // "Settled", so this is what makes a second call a no-op rather than a
  // refusal — the daily job's own query already excludes it by status, but
  // the manual trigger can still be clicked again.
  if (exit.exited_at) return { ok: true, value: { runId: null } };
  if (String(exit.status) !== "Approved") return { error: "Only an approved exit can be settled." };
  const lastDay = String(exit.approved_last_day);
  const employeeId = Number(exit.employee_id);

  const employee = await one("SELECT hire_date FROM pa_employee WHERE id = ?", [employeeId]);
  if (!employee) return { error: "That employee no longer exists." };

  const tx = await rawClient().transaction("write");
  try {
    await writeTimeSlice(tx, {
      table: SLICED_TABLES.action,
      employeeId,
      validFrom: lastDay,
      data: { action_type: "Termination", reason: String(exit.exit_type) },
      createdBy: logActor.name,
      actor: logActor,
      reason: String(exit.reason ?? exit.exit_type),
    });
    await tx.execute({ sql: "UPDATE pa_employee SET employment_status = 'Terminated', termination_date = ? WHERE id = ?", args: [lastDay, employeeId] });
    const position = await tx.execute({
      sql: `SELECT position_code FROM pa_it0001_org_assignment WHERE employee_id = ? AND valid_from <= ? AND valid_to >= ? LIMIT 1`,
      args: [employeeId, lastDay, lastDay],
    });
    const positionCode = position.rows[0] ? String(position.rows[0].position_code) : null;
    if (positionCode) await tx.execute({ sql: "UPDATE om_position SET is_vacant = 1 WHERE code = ?", args: [positionCode] });
    await tx.execute({ sql: "UPDATE sec_app_user SET is_active = 0 WHERE employee_id = ?", args: [employeeId] });

    const statusLogged = [
      changeStatement(logActor, {
        entity: "pa_employee",
        entityId: employeeId,
        subjectEmployeeId: employeeId,
        action: "update",
        before: { employment_status: "Active" },
        after: { employment_status: "Terminated", termination_date: lastDay },
        reason: String(exit.exit_type),
      }),
      ...(positionCode
        ? [changeStatement(logActor, { entity: "om_position", entityId: positionCode, action: "update", before: { isVacant: false }, after: { isVacant: true }, reason: "Vacated on exit" })]
        : []),
    ];
    for (const st of statusLogged) if (st) await tx.execute(st);

    await startOffboarding(tx, logActor, { employeeId, effectiveDate: lastDay, createdBy: logActor.name });

    // Leave encashment: every quota type with a balance left, paid out in full.
    const year = Number(lastDay.slice(0, 4));
    const quotas = await tx.execute({ sql: "SELECT quota_type_code, entitled_half_days, used_half_days FROM pt_it2006_absence_quota WHERE employee_id = ? AND year = ?", args: [employeeId, year] });
    for (const q of quotas.rows) {
      const remainingDays = (Number(q.entitled_half_days) - Number(q.used_half_days)) / 2;
      if (remainingDays <= 0) continue;
      await encashLeave(tx, { employeeId, quotaTypeCode: String(q.quota_type_code), year, days: remainingDays, paymentDate: lastDay, createdBy: logActor.name, actor: logActor, ignoreAnnualCap: true });
    }

    const basicRow = await readAsOf<{ amount_paise: number }>(SLICED_TABLES.basicPay, employeeId, lastDay);

    // Notice pay: a shortfall recovered, unless HR waived it.
    if (!exit.notice_waived && basicRow) {
      const shortfall = noticeShortfallDays(Number(exit.notice_days), String(exit.requested_at).slice(0, 10), lastDay);
      if (shortfall > 0) {
        const amount = noticePayPaise(basicRow.amount_paise, shortfall);
        if (amount > 0) {
          await tx.execute({
            sql: `INSERT INTO py_it0015_additional_payment (employee_id, wage_type_code, amount_paise, payment_date, created_at) VALUES (?, 'NOTICE', ?, ?, ?)`,
            args: [employeeId, amount, lastDay, now()],
          });
        }
      }
    }

    // Gratuity, once eligible.
    if (basicRow) {
      const years = gratuityYears(String(employee.hire_date), lastDay);
      const gratuity = computeGratuity(basicRow.amount_paise, years);
      if (gratuity.eligible && gratuity.amountPaise > 0) {
        await tx.execute({
          sql: `INSERT INTO py_it0015_additional_payment (employee_id, wage_type_code, amount_paise, payment_date, created_at) VALUES (?, 'GRAT', ?, ?, ?)`,
          args: [employeeId, gratuity.amountPaise, lastDay, now()],
        });
      }
    }

    // The outstanding balance of any active loan, recovered in full.
    const loan = await tx.execute({ sql: "SELECT id FROM py_loan WHERE employee_id = ? AND status = 'Active'", args: [employeeId] });
    if (loan.rows[0]) {
      const recovered = await recoverLoanAtExit(tx, { loanId: Number(loan.rows[0].id), employeeId, recoveryDate: lastDay });
      if ("amountPaise" in recovered) {
        const loanLogged = changeStatement(logActor, {
          entity: "py_loan",
          entityId: Number(loan.rows[0].id),
          subjectEmployeeId: employeeId,
          action: "update",
          before: { status: "Active" },
          after: { status: "Closed", recoveredAtExitPaise: recovered.amountPaise },
          reason: "Recovered in full and final settlement",
        });
        if (loanLogged) await tx.execute(loanLogged);
      }
    }

    await tx.commit();
  } catch (err) {
    await tx.rollback();
    throw err;
  } finally {
    tx.close();
  }

  // The off-cycle run: salary to the last day, and every one-off payment just queued, together.
  // An off-cycle run needs a period already locked for running, the same as
  // any other off-cycle pay — the most recently locked or posted one.
  const area = await one(
    `SELECT pp.id AS period_id FROM py_payroll_period pp
     JOIN pa_it0001_org_assignment oa ON oa.area_code = pp.area_code
     WHERE oa.employee_id = ? AND oa.valid_from <= ? AND oa.valid_to >= ? AND pp.status <> 'Open'
     ORDER BY pp.year DESC, pp.month DESC, pp.id DESC LIMIT 1`,
    [employeeId, lastDay, lastDay],
  );
  if (!area) return { error: "There is no payroll period ready to run for this employee's area yet, so the settlement cannot be paid until one is locked." };

  const progress = await runPayroll({
    periodId: Number(area.period_id),
    runBy: logActor.name,
    runType: "Off-cycle",
    employeeIds: [employeeId],
    reason: "Full and final settlement",
    payDate: lastDay,
  });
  if (!("completed" in progress) || !progress.completed) return { error: "The settlement run did not complete." };
  const runId = progress.runId;

  const result = await one("SELECT gross_paise, net_paise FROM py_payroll_result WHERE run_id = ? AND employee_id = ?", [runId, employeeId]);
  const oneOffs = await all(
    `SELECT p.wage_type_code, p.amount_paise, w.kind FROM py_it0015_additional_payment p
     JOIN py_wage_type w ON w.code = p.wage_type_code WHERE p.employee_id = ? AND p.paid_run_id = ?`,
    [employeeId, runId],
  );

  const at = now();
  const settlement = await rawClient().execute({
    sql: `INSERT INTO py_settlement (exit_id, employee_id, status, run_id, computed_at, paid_at) VALUES (?, ?, 'Paid', ?, ?, ?) RETURNING id`,
    args: [exitId, employeeId, runId, at, at],
  });
  const settlementId = Number(settlement.rows[0].id);
  const lines: { component: string; basis: string; amountPaise: number; sortOrder: number }[] = [];
  if (result) {
    lines.push({ component: "Salary to last day", basis: `Prorated to ${lastDay}`, amountPaise: Number(result.net_paise), sortOrder: 10 });
  }
  let sort = 20;
  for (const o of oneOffs) {
    const code = String(o.wage_type_code);
    const signed = String(o.kind) === "Deduction" ? -Number(o.amount_paise) : Number(o.amount_paise);
    lines.push({ component: COMPONENT_LABELS[code] ?? code, basis: `Wage type ${code}`, amountPaise: signed, sortOrder: sort });
    sort += 10;
  }
  for (const l of lines) {
    await rawClient().execute({
      sql: "INSERT INTO py_settlement_line (settlement_id, component, basis, amount_paise, sort_order) VALUES (?, ?, ?, ?, ?)",
      args: [settlementId, l.component, l.basis, l.amountPaise, l.sortOrder],
    });
  }

  await rawClient().execute({ sql: "UPDATE pa_exit SET status = 'Settled', exited_at = ? WHERE id = ?", args: [at, exitId] });
  const settledLogged = changeStatement(logActor, {
    entity: "pa_exit",
    entityId: exitId,
    subjectEmployeeId: employeeId,
    action: "update",
    before: { status: "Approved" },
    after: { status: "Settled", exitedAt: at },
  });
  if (settledLogged) await rawClient().execute(settledLogged);
  const settlementLogged = changeStatement(logActor, {
    entity: "py_settlement",
    entityId: settlementId,
    subjectEmployeeId: employeeId,
    action: "create",
    after: { exitId, employeeId, status: "Paid", runId },
  });
  if (settlementLogged) await rawClient().execute(settlementLogged);

  const user = await one("SELECT id FROM sec_app_user WHERE employee_id = ?", [employeeId]);
  if (user) {
    await notify([
      {
        userId: Number(user.id),
        kind: "settlement.paid",
        title: "Your final settlement was paid",
        body: result ? `${formatINR(Number(result.net_paise))} net, including every component of your settlement.` : "Your settlement has been paid.",
        link: "/exit",
        dedupeKey: `settlement.paid:${settlementId}`,
      },
    ]);
  }

  return { ok: true, value: { runId } };
}

/** Approved exits whose last day has come and gone, not yet settled — for the daily job. */
export async function processExitsDue(today: string): Promise<number> {
  const due = await all("SELECT id FROM pa_exit WHERE status = 'Approved' AND exited_at IS NULL AND approved_last_day <= ?", [today]);
  let settled = 0;
  for (const row of due) {
    const result = await settleExit(systemActor("exits"), Number(row.id));
    if (result.ok) settled += 1;
  }
  return settled;
}
