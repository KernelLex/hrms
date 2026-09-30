import "server-only";
import type { InStatement } from "@libsql/client";
import { rawClient } from "@/lib/db";
import { now } from "@/db/schema";
import { changeStatement, type Actor } from "@/lib/change-log";
import {
  calendarDaysBetween,
  calendarFor,
  formatDays,
  matchPolicy,
  policyFor,
  postLedger,
  balancesFor,
  rowToPolicy,
  shortfall,
  workingDaysBetween,
  type LeavePolicyRow,
} from "./quota";

/**
 * What a leave policy actually does once entitlement exists: accrue it a
 * period at a time, close a year out into what carries forward and what
 * lapses, forecast a balance ahead of today, and turn compensatory-off
 * earning, use and encashment into the same ledger every other credit and
 * debit goes through.
 */

type Executor = { execute: (s: InStatement) => Promise<{ rows: unknown[]; rowsAffected: number }> };

/* ------------------------------------------------------------------ accrual */

function monthEnd(year: number, month: number): string {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
}
function monthStart(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

/**
 * Grants what one month is worth, for every employee an active policy
 * currently covers — monthly-frequency policies get their usual slice, and
 * yearly-frequency policies get their whole year the first month the
 * employee is eligible for it, pro-rated from the hire date if the policy
 * says to. Safe to run twice for the same month: each grant is checked
 * against the ledger by a ref id unique to the policy, employee and period
 * before it is posted.
 *
 * Everything a policy match needs — the policies, every employee's area and
 * grade, what has already been posted this year — is read once up front, the
 * same batch-then-apply shape `time-evaluation.ts` and `payroll.ts` use, so
 * this scales with the company, not with a query per employee per policy.
 */
export async function accrueForPeriod(
  tx: Executor,
  opts: { year: number; month: number; employeeIds?: number[]; createdBy: string; actor: Actor },
): Promise<{ granted: number }> {
  const { year, month, createdBy, actor } = opts;
  const from = monthStart(year, month);
  const to = monthEnd(year, month);
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  const only = opts.employeeIds?.length ? opts.employeeIds : null;

  const [policiesR, employeesR, factsR, postedR] = await Promise.all([
    rawClient().execute({ sql: "SELECT * FROM pt_leave_policy WHERE is_active = 1", args: [] }),
    rawClient().execute({
      sql: `SELECT id, hire_date FROM pa_employee
            WHERE hire_date <= ? AND (termination_date IS NULL OR termination_date >= ?)
            ${only ? `AND id IN (${only.map(() => "?").join(", ")})` : ""}`,
      args: only ? [to, from, ...only] : [to, from],
    }),
    rawClient().execute({
      sql: `SELECT o.employee_id, o.area_code, p.pay_scale_group FROM pa_it0001_org_assignment o
            LEFT JOIN pa_it0008_basic_pay p ON p.employee_id = o.employee_id AND p.valid_from <= ?1 AND p.valid_to >= ?1
            WHERE o.valid_from <= ?1 AND o.valid_to >= ?1`,
      args: [to],
    }),
    rawClient().execute({
      sql: "SELECT employee_id, quota_type_code, ref_id FROM pt_quota_ledger WHERE ref_type = 'pt_leave_policy' AND year = ?",
      args: [year],
    }),
  ]);

  const byQuotaType = new Map<string, LeavePolicyRow[]>();
  for (const p of policiesR.rows) {
    const policy = rowToPolicy(p as unknown as Record<string, unknown>);
    if (!byQuotaType.has(policy.quotaTypeCode)) byQuotaType.set(policy.quotaTypeCode, []);
    byQuotaType.get(policy.quotaTypeCode)!.push(policy);
  }
  const factsOf = new Map<number, { areaCode: string | null; grade: string | null }>();
  for (const r of factsR.rows) {
    factsOf.set(Number(r.employee_id), {
      areaCode: r.area_code === null ? null : String(r.area_code),
      grade: r.pay_scale_group === null ? null : String(r.pay_scale_group),
    });
  }
  const posted = new Set(postedR.rows.map((r) => `${r.employee_id}:${r.quota_type_code}:${r.ref_id}`));

  let granted = 0;
  for (const e of employeesR.rows as unknown as { id: number; hire_date: string }[]) {
    const employeeId = Number(e.id);
    const hireDate = e.hire_date;
    const facts = factsOf.get(employeeId) ?? { areaCode: null, grade: null };

    for (const [quotaTypeCode, candidates] of byQuotaType) {
      const policy = matchPolicy(candidates, facts.grade, facts.areaCode);
      if (!policy) continue;

      if (policy.accrualFrequency === "Monthly") {
        if (hireDate > to) continue;
        const refId = `${policy.code}:${year}-${String(month).padStart(2, "0")}`;
        if (posted.has(`${employeeId}:${quotaTypeCode}:${refId}`)) continue;

        const monthlyShare = Math.round(policy.entitlementHalfDaysPerYear / 12);
        let halfDays = monthlyShare;
        if (hireDate > from) {
          if (!policy.proRataForJoiners) continue;
          const totalDays = calendarDaysBetween(from, to);
          const employedDays = calendarDaysBetween(hireDate, to);
          halfDays = Math.round((monthlyShare * employedDays) / totalDays);
        }
        if (halfDays <= 0) continue;
        await postLedger(tx, {
          employeeId,
          quotaTypeCode,
          year,
          entryType: "Accrual",
          halfDays,
          note: `${policy.name}: monthly accrual`,
          refType: "pt_leave_policy",
          refId,
          createdBy,
          actor,
        });
        granted += 1;
      } else {
        const refId = `${policy.code}:${year}`;
        if (posted.has(`${employeeId}:${quotaTypeCode}:${refId}`)) continue;

        const proRated = hireDate > yearStart;
        let halfDays = policy.entitlementHalfDaysPerYear;
        if (proRated && policy.proRataForJoiners) {
          const totalDays = calendarDaysBetween(yearStart, yearEnd);
          const employedDays = calendarDaysBetween(hireDate, yearEnd);
          halfDays = Math.round((policy.entitlementHalfDaysPerYear * employedDays) / totalDays);
        }
        if (halfDays <= 0) continue;
        await postLedger(tx, {
          employeeId,
          quotaTypeCode,
          year,
          entryType: "Accrual",
          halfDays,
          note: `${policy.name}: yearly entitlement${proRated && policy.proRataForJoiners ? " (pro-rated)" : ""}`,
          refType: "pt_leave_policy",
          refId,
          createdBy,
          actor,
        });
        granted += 1;
      }
    }
  }
  return { granted };
}

/* ---------------------------------------------------------------- year end */

/**
 * Closes out one year's balance against the policy governing it today: up to
 * the carry-forward cap moves into the next year as its own credit, and
 * whatever is left lapses — both as ledger entries, so the closed year's
 * balance lands on exactly zero and nothing is double-counted on a re-run.
 *
 * Different policies can lapse on different dates, so this can run every day
 * against last year without over-closing: a balance is left alone until
 * `asOf` (MM-DD, India time) reaches its own policy's `lapseOn`.
 */
export async function runYearEnd(
  tx: Executor,
  opts: { year: number; asOf?: string; employeeIds?: number[]; createdBy: string; actor: Actor },
): Promise<{ processed: number }> {
  const { year, createdBy, actor } = opts;
  const only = opts.employeeIds?.length ? opts.employeeIds : null;
  const [balancesR, policiesR, factsR, postedR] = await Promise.all([
    rawClient().execute({
      sql: `SELECT employee_id, quota_type_code, entitled_half_days, used_half_days FROM pt_it2006_absence_quota
            WHERE year = ? ${only ? `AND employee_id IN (${only.map(() => "?").join(", ")})` : ""}`,
      args: only ? [year, ...only] : [year],
    }),
    rawClient().execute({ sql: "SELECT * FROM pt_leave_policy WHERE is_active = 1", args: [] }),
    rawClient().execute({
      sql: `SELECT o.employee_id, o.area_code, p.pay_scale_group FROM pa_it0001_org_assignment o
            LEFT JOIN pa_it0008_basic_pay p ON p.employee_id = o.employee_id AND p.valid_from <= ?1 AND p.valid_to >= ?1
            WHERE o.valid_from <= ?1 AND o.valid_to >= ?1`,
      args: [`${year}-12-31`],
    }),
    rawClient().execute({
      sql: "SELECT employee_id, quota_type_code, ref_id FROM pt_quota_ledger WHERE ref_type = 'pt_leave_policy' AND year = ?",
      args: [year],
    }),
  ]);

  const byQuotaType = new Map<string, LeavePolicyRow[]>();
  for (const p of policiesR.rows) {
    const policy = rowToPolicy(p as unknown as Record<string, unknown>);
    if (!byQuotaType.has(policy.quotaTypeCode)) byQuotaType.set(policy.quotaTypeCode, []);
    byQuotaType.get(policy.quotaTypeCode)!.push(policy);
  }
  const factsOf = new Map<number, { areaCode: string | null; grade: string | null }>();
  for (const r of factsR.rows) {
    factsOf.set(Number(r.employee_id), {
      areaCode: r.area_code === null ? null : String(r.area_code),
      grade: r.pay_scale_group === null ? null : String(r.pay_scale_group),
    });
  }
  const posted = new Set(postedR.rows.map((r) => `${r.employee_id}:${r.quota_type_code}:${r.ref_id}`));

  let processed = 0;
  for (const b of balancesR.rows) {
    const employeeId = Number(b.employee_id);
    const quotaTypeCode = String(b.quota_type_code);
    const remaining = Number(b.entitled_half_days) - Number(b.used_half_days);
    if (remaining <= 0) continue;

    const facts = factsOf.get(employeeId) ?? { areaCode: null, grade: null };
    const policy = matchPolicy(byQuotaType.get(quotaTypeCode) ?? [], facts.grade, facts.areaCode);
    if (!policy) continue;
    if (opts.asOf !== undefined && opts.asOf < policy.lapseOn) continue;

    const refId = `${policy.code}:${year}-close`;
    if (posted.has(`${employeeId}:${quotaTypeCode}:${refId}`)) continue;

    const carry = Math.min(remaining, policy.carryForwardCapHalfDays);
    const lapse = remaining - carry;

    if (carry > 0) {
      await postLedger(tx, {
        employeeId,
        quotaTypeCode,
        year,
        entryType: "CarryForward",
        halfDays: -carry,
        note: `${policy.name}: carried to ${year + 1}`,
        refType: "pt_leave_policy",
        refId,
        createdBy,
        actor,
      });
      await postLedger(tx, {
        employeeId,
        quotaTypeCode,
        year: year + 1,
        entryType: "CarryForward",
        halfDays: carry,
        note: `${policy.name}: carried from ${year}`,
        refType: "pt_leave_policy",
        refId,
        createdBy,
        actor,
      });
    }
    if (lapse > 0) {
      await postLedger(tx, {
        employeeId,
        quotaTypeCode,
        year,
        entryType: "Lapse",
        halfDays: -lapse,
        note: `${policy.name}: lapsed`,
        refType: "pt_leave_policy",
        refId,
        createdBy,
        actor,
      });
    }
    processed += 1;
  }
  return { processed };
}

/* ----------------------------------------------------------------- forecast */

/**
 * The balance on `asOfDate`, assuming approved leave between now and then
 * (already reflected in the running balance the moment it was approved) and
 * adding whatever monthly accrual will land between now and then. Yearly
 * accrual is not projected forward, since it lands all at once on a date
 * this prototype does not pin down in advance.
 */
export async function forecastBalance(employeeId: number, quotaTypeCode: string, asOfDate: string): Promise<number> {
  const today = new Date().toISOString().slice(0, 10);
  const year = Number(asOfDate.slice(0, 4));
  const balances = await balancesFor(employeeId, year);
  let units = balances.find((b) => b.quotaTypeCode === quotaTypeCode)?.balanceUnits ?? 0;
  if (asOfDate <= today) return units;

  const policy = await policyFor(employeeId, quotaTypeCode, asOfDate);
  if (policy?.accrualFrequency === "Monthly" && year === Number(today.slice(0, 4))) {
    const monthsAhead = Number(asOfDate.slice(5, 7)) - Number(today.slice(5, 7));
    if (monthsAhead > 0) units += Math.round(policy.entitlementHalfDaysPerYear / 12) * monthsAhead;
  }
  return units;
}

/* --------------------------------------------------------------- comp-off */

/** Earned by working a holiday or a weekend; banked until it expires. */
export async function earnCompOff(
  tx: Executor,
  opts: {
    employeeId: number;
    earnedOn: string;
    halfDays: number;
    expiryDays?: number;
    sourceAttendanceId?: number | null;
    note?: string | null;
    createdBy: string;
    actor: Actor;
  },
): Promise<void> {
  const { employeeId, earnedOn, halfDays, createdBy, actor } = opts;
  if (halfDays <= 0) return;
  const expiresOn = shiftDate(earnedOn, opts.expiryDays ?? 90);
  const at = now();
  const inserted = await tx.execute({
    sql: `INSERT INTO pt_comp_off (employee_id, earned_on, expires_on, half_days, status, source_attendance_id, note, created_by, created_at)
          VALUES (?, ?, ?, ?, 'Available', ?, ?, ?, ?) RETURNING id`,
    args: [employeeId, earnedOn, expiresOn, halfDays, opts.sourceAttendanceId ?? null, opts.note ?? null, createdBy, at],
  });
  const id = Number((inserted.rows[0] as Record<string, unknown>).id);
  const logged = changeStatement(actor, {
    entity: "pt_comp_off",
    entityId: id,
    subjectEmployeeId: employeeId,
    action: "create",
    after: { employeeId, earnedOn, expiresOn, halfDays, status: "Available" },
  });
  if (logged) await tx.execute(logged);
}

function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export type CompOffBalance = { availableHalfDays: number; expiringSoon: { id: number; halfDays: number; expiresOn: string }[] };

/** What is still available, oldest-expiring first. */
export async function compOffBalance(employeeId: number, asOf?: string): Promise<CompOffBalance> {
  const date = asOf ?? new Date().toISOString().slice(0, 10);
  const r = await rawClient().execute({
    sql: `SELECT id, half_days, expires_on FROM pt_comp_off
          WHERE employee_id = ? AND status = 'Available' AND expires_on >= ?
          ORDER BY expires_on ASC`,
    args: [employeeId, date],
  });
  const rows = r.rows.map((row) => ({ id: Number(row.id), halfDays: Number(row.half_days), expiresOn: String(row.expires_on) }));
  return {
    availableHalfDays: rows.reduce((s, x) => s + x.halfDays, 0),
    expiringSoon: rows.filter((x) => x.expiresOn <= shiftDate(date, 14)),
  };
}

/**
 * Spends comp-off, oldest-expiring grant first, refusing to overdraw —
 * splitting a grant across a partial use so nothing is wasted or double-spent.
 */
export async function consumeCompOff(
  tx: Executor,
  opts: { employeeId: number; halfDays: number; refType: string; refId: string | number; asOf?: string; createdBy: string; actor: Actor },
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const { employeeId, halfDays, createdBy, actor } = opts;
  if (halfDays <= 0) return { ok: true };
  const today = opts.asOf ?? new Date().toISOString().slice(0, 10);

  const available = await tx.execute({
    sql: `SELECT id, half_days FROM pt_comp_off
          WHERE employee_id = ? AND status = 'Available' AND expires_on >= ?
          ORDER BY expires_on ASC, id ASC`,
    args: [employeeId, today],
  });
  const availableRows = available.rows as unknown as Record<string, unknown>[];
  const total = availableRows.reduce((s, r) => s + Number(r.half_days), 0);
  if (halfDays > total) return { ok: false, reason: shortfall(halfDays, total) };

  let remaining = halfDays;
  for (const row of availableRows) {
    if (remaining <= 0) break;
    const id = Number(row.id);
    const grant = Number(row.half_days);
    const take = Math.min(grant, remaining);

    if (take === grant) {
      const claimed = await tx.execute({
        sql: "UPDATE pt_comp_off SET status = 'Used' WHERE id = ? AND status = 'Available'",
        args: [id],
      });
      if (claimed.rowsAffected === 0) return { ok: false, reason: "The balance changed a moment ago. Try again." };
    } else {
      // Splits the grant: this part is used now, the rest stays available.
      const claimed = await tx.execute({
        sql: "UPDATE pt_comp_off SET half_days = half_days - ? WHERE id = ? AND status = 'Available' AND half_days >= ?",
        args: [take, id, take],
      });
      if (claimed.rowsAffected === 0) return { ok: false, reason: "The balance changed a moment ago. Try again." };
      const original = await tx.execute({ sql: "SELECT earned_on, expires_on, source_attendance_id FROM pt_comp_off WHERE id = ?", args: [id] });
      const src = original.rows[0] as Record<string, unknown>;
      const earnedOn = String(src.earned_on);
      const expiresOn = String(src.expires_on);
      const sourceAttendanceId = src.source_attendance_id === null ? null : Number(src.source_attendance_id);
      await tx.execute({
        sql: `INSERT INTO pt_comp_off (employee_id, earned_on, expires_on, half_days, status, source_attendance_id, note, created_by, created_at)
              VALUES (?, ?, ?, ?, 'Used', ?, ?, ?, ?)`,
        args: [employeeId, earnedOn, expiresOn, take, sourceAttendanceId, `Split from grant #${id}`, createdBy, now()],
      });
    }
    remaining -= take;
  }

  const logged = changeStatement(actor, {
    entity: "pt_comp_off",
    entityId: `${employeeId}:use`,
    subjectEmployeeId: employeeId,
    action: "update",
    before: { availableHalfDays: total },
    after: { availableHalfDays: total - halfDays },
    reason: `Used against ${opts.refType} ${opts.refId}`,
  });
  if (logged) await tx.execute(logged);
  return { ok: true };
}

/** Marks anything still 'Available' past its expiry date. Run daily. */
export async function expireCompOffs(tx: Executor, opts: { asOf: string; actor: Actor }): Promise<{ expired: number }> {
  const due = await tx.execute({
    sql: "SELECT id, employee_id FROM pt_comp_off WHERE status = 'Available' AND expires_on < ?",
    args: [opts.asOf],
  });
  const dueRows = due.rows as unknown as Record<string, unknown>[];
  if (dueRows.length === 0) return { expired: 0 };
  const ids = dueRows.map((r) => Number(r.id));
  await tx.execute({
    sql: `UPDATE pt_comp_off SET status = 'Expired' WHERE id IN (${ids.map(() => "?").join(", ")})`,
    args: ids,
  });
  for (const row of dueRows) {
    const logged = changeStatement(opts.actor, {
      entity: "pt_comp_off",
      entityId: Number(row.id),
      subjectEmployeeId: Number(row.employee_id),
      action: "update",
      before: { status: "Available" },
      after: { status: "Expired" },
    });
    if (logged) await tx.execute(logged);
  }
  return { expired: dueRows.length };
}

/* --------------------------------------------------------------- encashment */

/** The pay-per-day rate encashment uses: current basic, over the month's working days. */
async function dailyRatePaise(employeeId: number, asOf: string, calendarCode: string): Promise<number> {
  const basic = await rawClient().execute({
    sql: `SELECT amount_paise FROM pa_it0008_basic_pay WHERE employee_id = ? AND valid_from <= ? AND valid_to >= ? ORDER BY valid_from DESC LIMIT 1`,
    args: [employeeId, asOf, asOf],
  });
  const basicPaise = basic.rows[0] ? Number(basic.rows[0].amount_paise) : 0;
  const year = Number(asOf.slice(0, 4));
  const month = Number(asOf.slice(5, 7));
  const w = await workingDaysBetween(monthStart(year, month), monthEnd(year, month), calendarCode);
  return w > 0 ? Math.round(basicPaise / w) : 0;
}

/**
 * Encashes days out of a balance at the policy's daily rate, within what the
 * policy allows for the year, and queues the payment as an IT0015 additional
 * payment — the same table an off-cycle bonus uses, so payroll pays it
 * through the very next run without any encashment-specific code there.
 */
export async function encashLeave(
  tx: Executor,
  opts: { employeeId: number; quotaTypeCode: string; year: number; days: number; paymentDate: string; createdBy: string; actor: Actor },
): Promise<{ ok: true; amountPaise: number } | { ok: false; reason: string }> {
  const { employeeId, quotaTypeCode, year, paymentDate, createdBy, actor } = opts;
  const units = Math.round(opts.days * 2);
  if (units <= 0) return { ok: false, reason: "Enter how many days to encash." };

  const policy = await policyFor(employeeId, quotaTypeCode, paymentDate);
  if (!policy) return { ok: false, reason: "No leave policy governs this quota type for this employee." };
  if (policy.encashableHalfDaysPerYear <= 0) return { ok: false, reason: `${policy.name} does not allow encashment.` };

  const already = await rawClient().execute({
    sql: `SELECT COALESCE(SUM(-half_days), 0) AS n FROM pt_quota_ledger
          WHERE employee_id = ? AND quota_type_code = ? AND year = ? AND entry_type = 'Encashment'`,
    args: [employeeId, quotaTypeCode, year],
  });
  const usedUp = Number(already.rows[0].n);
  if (usedUp + units > policy.encashableHalfDaysPerYear) {
    return { ok: false, reason: `Only ${formatDays(Math.max(0, policy.encashableHalfDaysPerYear - usedUp))} days are still encashable this year.` };
  }

  const quotaRow = await tx.execute({
    sql: "SELECT * FROM pt_it2006_absence_quota WHERE employee_id = ? AND quota_type_code = ? AND year = ?",
    args: [employeeId, quotaTypeCode, year],
  });
  const quota = quotaRow.rows[0] as unknown as Record<string, unknown> | undefined;
  if (!quota) return { ok: false, reason: `No ${quotaTypeCode} entitlement exists for ${year} yet.` };
  const remaining = Number(quota.entitled_half_days) - Number(quota.used_half_days);
  if (units > remaining) return { ok: false, reason: shortfall(units, remaining) };

  const calendarCode = await calendarFor(employeeId, paymentDate);
  const rate = await dailyRatePaise(employeeId, paymentDate, calendarCode);
  const amountPaise = Math.round((rate * units) / 2);

  await postLedger(tx, {
    employeeId,
    quotaTypeCode,
    year,
    entryType: "Encashment",
    halfDays: -units,
    note: `Encashed ${formatDays(units)} days at ${(rate / 100).toFixed(2)}/day`,
    refType: "py_it0015_additional_payment",
    refId: paymentDate,
    createdBy,
    actor,
  });

  const inserted = await tx.execute({
    sql: `INSERT INTO py_it0015_additional_payment (employee_id, wage_type_code, amount_paise, payment_date, created_at)
          VALUES (?, 'LENC', ?, ?, ?) RETURNING id`,
    args: [employeeId, amountPaise, paymentDate, now()],
  });
  const id = Number((inserted.rows[0] as Record<string, unknown>).id);
  const logged = changeStatement(actor, {
    entity: "py_it0015_additional_payment",
    entityId: id,
    subjectEmployeeId: employeeId,
    action: "create",
    after: { employeeId, wageTypeCode: "LENC", amountPaise, paymentDate },
    reason: `Leave encashment: ${formatDays(units)} days`,
  });
  if (logged) await tx.execute(logged);

  return { ok: true, amountPaise };
}
