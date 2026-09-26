import "server-only";
import { rawClient } from "@/lib/db";
import { financialYearOf } from "@/lib/engines/tax";
import { formatDate, formatTime } from "@/lib/dates";

/**
 * Reads behind the three home screens.
 *
 * Each role's home asks a handful of aggregate questions — how many requests
 * are waiting, how much tax is undeposited — so each is one SQL statement
 * returning a count or a sum, never a list fetched only to be counted.
 */

type Row = Record<string, unknown>;

async function all<T = Row>(sql: string, args: (string | number | null)[] = []): Promise<T[]> {
  const result = await rawClient().execute({ sql, args });
  return result.rows as unknown as T[];
}

async function one<T = Row>(sql: string, args: (string | number | null)[] = []): Promise<T> {
  return (await all<T>(sql, args))[0];
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/* ------------------------------------------------------------ shared */

export type UpcomingEvent = {
  date: string;
  kind: "holiday" | "leave" | "interview" | "birthday" | "anniversary";
  title: string;
  detail?: string;
  href?: string;
};

const EMPLOYEE_NAME = `
  COALESCE(
    (SELECT p.first_name || ' ' || p.last_name FROM pa_it0002_personal_data p
      WHERE p.employee_id = e.id AND p.valid_from <= ?1 AND p.valid_to >= ?1 LIMIT 1),
    e.employee_number)`;

export async function holidaysBetween(from: string, to: string): Promise<UpcomingEvent[]> {
  const rows = await all<{ date: string; name: string }>(
    `SELECT date, name FROM pt_holiday WHERE date BETWEEN ? AND ? ORDER BY date`,
    [from, to],
  );
  return rows.map((r) => ({ date: r.date, kind: "holiday", title: r.name, detail: "Public holiday" }));
}

/**
 * Approved leave overlapping a window. Leave that started before the window
 * but is still running shows on the window's first day, so "away today" is
 * not missed just because it began last week.
 */
export async function leaveBetween(
  today: string,
  from: string,
  to: string,
  employeeIds: number[] | null,
): Promise<UpcomingEvent[]> {
  if (employeeIds !== null && employeeIds.length === 0) return [];
  const filter =
    employeeIds === null ? "" : `AND a.employee_id IN (${employeeIds.map(() => "?").join(",")})`;
  const rows = await all<{
    start_date: string;
    end_date: string;
    type: string;
    name: string;
    employee_id: number;
  }>(
    `SELECT a.start_date, a.end_date, t.name AS type, a.employee_id,
            ${EMPLOYEE_NAME} AS name
     FROM pt_it2001_absence a
     JOIN pa_employee e ON e.id = a.employee_id
     JOIN pt_absence_type t ON t.code = a.absence_type_code
     WHERE a.start_date <= ?3 AND a.end_date >= ?2 ${filter}
     ORDER BY a.start_date`,
    [today, from, to, ...(employeeIds ?? [])],
  );
  return rows.map((r) => ({
    date: r.start_date < from ? from : r.start_date,
    kind: "leave",
    title: r.name,
    detail: `${r.type}, ${r.start_date === r.end_date ? "one day" : `until ${formatDate(r.end_date)}`}`,
    href: `/core-hr/${r.employee_id}`,
  }));
}

/**
 * Birthdays and work anniversaries in a window, matched on month and day so a
 * window across the new year works. A 29 February birthday is marked on the
 * 28th in a year without one.
 */
export async function celebrationsBetween(
  from: string,
  days: number,
  employeeIds: number[] | null,
): Promise<UpcomingEvent[]> {
  if (employeeIds !== null && employeeIds.length === 0) return [];
  const dates = Array.from({ length: days }, (_, i) => addDays(from, i));
  const byMonthDay = new Map<string, string>();
  for (const d of dates) {
    byMonthDay.set(d.slice(5), d);
    const year = Number(d.slice(0, 4));
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    if (d.slice(5) === "02-28" && !leap) byMonthDay.set("02-29", d);
  }
  const keys = [...byMonthDay.keys()];
  const marks = keys.map(() => "?").join(", ");
  const scope = employeeIds ? `AND e.id IN (${employeeIds.map(() => "?").join(", ")})` : "";

  const rows = await all<{ id: number; name: string; dob: string | null; hire_date: string }>(
    `SELECT e.id, e.hire_date, p.date_of_birth AS dob,
            COALESCE(p.first_name || ' ' || p.last_name, e.employee_number) AS name
     FROM pa_employee e
     LEFT JOIN pa_it0002_personal_data p
       ON p.employee_id = e.id AND p.valid_from <= ? AND p.valid_to >= ?
     WHERE e.employment_status != 'Terminated' ${scope}
       AND (substr(p.date_of_birth, 6) IN (${marks}) OR substr(e.hire_date, 6) IN (${marks}))`,
    [from, from, ...(employeeIds ?? []), ...keys, ...keys],
  );

  const events: UpcomingEvent[] = [];
  for (const r of rows) {
    const birthday = r.dob ? byMonthDay.get(r.dob.slice(5)) : undefined;
    if (birthday) {
      events.push({ date: birthday, kind: "birthday", title: r.name, detail: "Birthday", href: undefined });
    }
    const anniversary = byMonthDay.get(r.hire_date.slice(5));
    if (anniversary) {
      const years = Number(anniversary.slice(0, 4)) - Number(r.hire_date.slice(0, 4));
      if (years >= 1) {
        events.push({
          date: anniversary,
          kind: "anniversary",
          title: r.name,
          detail: `${years} ${years === 1 ? "year" : "years"} at the company`,
        });
      }
    }
  }
  return events;
}

/* ---------------------------------------------------------- HR admin */

export type HrHome = {
  headcount: number;
  positions: number;
  vacancies: number;
  onLeaveToday: number;
  pendingLeave: number;
  latestRun: {
    year: number;
    month: number;
    netTotalPaise: number;
    employeeCount: number;
    errorCount: number;
    periodStatus: string;
  } | null;
  unrunPeriods: { year: number; month: number; status: string }[];
  overdueRemittances: { authority: string; amountPaise: number; dueDate: string }[];
  dueSoonRemittances: { authority: string; amountPaise: number; dueDate: string }[];
  undepositedTdsPaise: number;
  undepositedQuarters: number;
  offered: number;
  draftIncrements: number;
  approvedIncrements: number;
  openCalibrations: number;
  missingBank: { id: number; name: string }[];
  upcoming: UpcomingEvent[];
};

export async function hrHome(today: string): Promise<HrHome> {
  const horizon = addDays(today, 13);

  const [
    counts,
    latestRun,
    unrunPeriods,
    remittances,
    tds,
    pipeline,
    missingBank,
    interviews,
    holidays,
    leave,
  ] = await Promise.all([
    one<{
      headcount: number;
      positions: number;
      vacancies: number;
      on_leave: number;
      pending_leave: number;
      draft_inc: number;
      approved_inc: number;
      open_cal: number;
    }>(
      `SELECT
         (SELECT COUNT(*) FROM pa_employee WHERE employment_status != 'Terminated') AS headcount,
         (SELECT COUNT(*) FROM om_position WHERE is_active = 1) AS positions,
         (SELECT COUNT(*) FROM om_position WHERE is_active = 1 AND is_vacant = 1) AS vacancies,
         (SELECT COUNT(DISTINCT employee_id) FROM pt_it2001_absence
            WHERE start_date <= ?1 AND end_date >= ?1) AS on_leave,
         (SELECT COUNT(*) FROM pt_leave_request WHERE status = 'Pending') AS pending_leave,
         (SELECT COUNT(*) FROM pm_increment_recommendation WHERE status = 'Draft') AS draft_inc,
         (SELECT COUNT(*) FROM pm_increment_recommendation WHERE status = 'Approved') AS approved_inc,
         (SELECT COUNT(*) FROM pm_calibration WHERE status != 'Finalised') AS open_cal`,
      [today],
    ),
    one<{
      year: number;
      month: number;
      net_total_paise: number;
      employee_count: number;
      error_count: number;
      status: string;
    }>(
      `SELECT p.year, p.month, p.status, r.net_total_paise, r.employee_count, r.error_count
       FROM py_payroll_run r JOIN py_payroll_period p ON p.id = r.period_id
       WHERE r.run_type = 'Regular' AND r.status = 'Completed'
       ORDER BY r.run_at DESC LIMIT 1`,
    ),
    all<{ year: number; month: number; status: string }>(
      `SELECT DISTINCT p.year, p.month, p.status FROM py_payroll_period p
       WHERE p.status != 'Posted'
         AND NOT EXISTS (SELECT 1 FROM py_payroll_run r
                         WHERE r.period_id = p.id AND r.run_type = 'Regular' AND r.status = 'Completed')
         AND (p.year * 100 + p.month) <= (CAST(substr(?1, 1, 4) AS INTEGER) * 100
                                          + CAST(substr(?1, 6, 2) AS INTEGER))
       ORDER BY p.year, p.month`,
      [today],
    ),
    all<{ authority: string; amount_paise: number; due_date: string }>(
      `SELECT authority, SUM(amount_paise) AS amount_paise, MIN(due_date) AS due_date
       FROM py_statutory_remittance
       WHERE status = 'Due' AND due_date <= ?
       GROUP BY authority, due_date < ?
       ORDER BY due_date`,
      [addDays(today, 7), today],
    ),
    one<{ amount: number | null; quarters: number }>(
      `SELECT SUM(tds_deducted_paise) AS amount,
              COUNT(DISTINCT financial_year || '-' || quarter) AS quarters
       FROM tds_deduction_register
       WHERE tds_deducted_paise > 0 AND deposit_date IS NULL`,
    ),
    one<{ offered: number }>(`SELECT COUNT(*) AS offered FROM rc_application WHERE stage = 'Offered'`),
    all<{ id: number; name: string }>(
      `SELECT e.id, ${EMPLOYEE_NAME} AS name
       FROM pa_employee e
       WHERE e.employment_status = 'Active'
         AND NOT EXISTS (SELECT 1 FROM pa_it0009_bank_details b
                         WHERE b.employee_id = e.id AND b.valid_from <= ?1 AND b.valid_to >= ?1)
       ORDER BY e.employee_number`,
      [today],
    ),
    all<{ date: string; time: string | null; round: string; candidate: string }>(
      `SELECT i.scheduled_date AS date, i.scheduled_time AS time, i.round, c.full_name AS candidate
       FROM rc_interview i
       JOIN rc_application a ON a.id = i.application_id
       JOIN rc_candidate c ON c.id = a.candidate_id
       WHERE i.scheduled_date BETWEEN ? AND ?
       ORDER BY i.scheduled_date, i.scheduled_time`,
      [today, horizon],
    ),
    holidaysBetween(today, horizon),
    leaveBetween(today, today, horizon, null),
  ]);
  const celebrations = await celebrationsBetween(today, 14, null);

  const overdue = remittances.filter((r) => r.due_date < today);
  const dueSoon = remittances.filter((r) => r.due_date >= today);

  const upcoming: UpcomingEvent[] = [
    ...holidays,
    ...leave,
    ...celebrations,
    ...interviews.map<UpcomingEvent>((i) => ({
      date: i.date,
      kind: "interview",
      title: i.candidate,
      detail: `${i.round}${i.time ? `, ${formatTime(i.time)}` : ""}`,
      href: "/recruitment/interviews",
    })),
  ].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  return {
    headcount: counts.headcount,
    positions: counts.positions,
    vacancies: counts.vacancies,
    onLeaveToday: counts.on_leave,
    pendingLeave: counts.pending_leave,
    latestRun: latestRun
      ? {
          year: latestRun.year,
          month: latestRun.month,
          netTotalPaise: latestRun.net_total_paise,
          employeeCount: latestRun.employee_count,
          errorCount: latestRun.error_count,
          periodStatus: latestRun.status,
        }
      : null,
    unrunPeriods: dedupeMonths(unrunPeriods),
    overdueRemittances: overdue.map((r) => ({
      authority: r.authority,
      amountPaise: r.amount_paise,
      dueDate: r.due_date,
    })),
    dueSoonRemittances: dueSoon.map((r) => ({
      authority: r.authority,
      amountPaise: r.amount_paise,
      dueDate: r.due_date,
    })),
    undepositedTdsPaise: tds.amount ?? 0,
    undepositedQuarters: tds.quarters,
    offered: pipeline.offered,
    draftIncrements: counts.draft_inc,
    approvedIncrements: counts.approved_inc,
    openCalibrations: counts.open_cal,
    missingBank,
    upcoming,
  };
}

/** Periods are per personnel area; the home screen talks about months. */
function dedupeMonths(rows: { year: number; month: number; status: string }[]) {
  const seen = new Map<string, { year: number; month: number; status: string }>();
  for (const r of rows) {
    const key = `${r.year}-${r.month}`;
    if (!seen.has(key)) seen.set(key, r);
  }
  return [...seen.values()];
}

/* ---------------------------------------------------- the employee */

export type SelfHome = {
  annualLeft: number | null;
  annualEntitled: number | null;
  pendingRequests: number;
  recentDecisions: { status: string; fromDate: string; toDate: string; decidedAt: string }[];
  latestPayslip: { id: number; year: number; month: number; netPaise: number } | null;
  appraisal: {
    status: string;
    cycleName: string;
    finalRating: number | null;
  } | null;
  hasDeclaration: boolean;
  financialYear: string;
  form16: { id: number; financialYear: string } | null;
  upcoming: UpcomingEvent[];
};

export async function selfHome(employeeId: number, today: string): Promise<SelfHome> {
  const year = Number(today.slice(0, 4));
  const fy = financialYearOf(today);
  const horizon = addDays(today, 30);
  const since = addDays(today, -14);

  const [quota, requests, decisions, payslip, appraisal, declaration, form16, holidays, leave] =
    await Promise.all([
      one<{ entitled: number; used: number } | undefined>(
        `SELECT entitled_half_days AS entitled, used_half_days AS used
         FROM pt_it2006_absence_quota
         WHERE employee_id = ? AND year = ? AND quota_type_code = 'ANNUAL'`,
        [employeeId, year],
      ),
      one<{ n: number }>(
        `SELECT COUNT(*) AS n FROM pt_leave_request WHERE employee_id = ? AND status = 'Pending'`,
        [employeeId],
      ),
      all<{ status: string; from_date: string; to_date: string; decided_at: string }>(
        `SELECT status, from_date, to_date, decided_at FROM pt_leave_request
         WHERE employee_id = ? AND status IN ('Approved', 'Rejected') AND decided_at >= ?
         ORDER BY decided_at DESC LIMIT 3`,
        [employeeId, since],
      ),
      one<{ id: number; year: number; month: number; net_paise: number } | undefined>(
        `SELECT r.id, p.year, p.month, r.net_paise
         FROM py_payroll_result r
         JOIN py_payroll_run run ON run.id = r.run_id AND run.status = 'Completed'
         JOIN py_payroll_period p ON p.id = run.period_id
         WHERE r.employee_id = ? AND r.status = 'Calculated'
           AND (p.status = 'Posted' OR run.run_type = 'Off-cycle')
         ORDER BY run.run_at DESC LIMIT 1`,
        [employeeId],
      ),
      one<{ status: string; name: string; rating: number | null; cal_status: string | null } | undefined>(
        `SELECT a.status, c.name, cal.calibrated_rating AS rating, cal.status AS cal_status
         FROM pm_appraisal a
         JOIN pm_appraisal_cycle c ON c.id = a.cycle_id
         LEFT JOIN pm_calibration cal ON cal.appraisal_id = a.id
         WHERE a.employee_id = ? AND c.status != 'Draft'
         ORDER BY c.start_date DESC LIMIT 1`,
        [employeeId],
      ),
      one<{ n: number }>(
        `SELECT COUNT(*) AS n FROM tds_employee_declaration
         WHERE employee_id = ? AND financial_year = ?`,
        [employeeId, fy],
      ),
      one<{ id: number; financial_year: string } | undefined>(
        `SELECT id, financial_year FROM tds_form16 WHERE employee_id = ?
         ORDER BY financial_year DESC LIMIT 1`,
        [employeeId],
      ),
      holidaysBetween(today, horizon),
      leaveBetween(today, today, horizon, [employeeId]),
    ]);

  return {
    annualLeft: quota ? quota.entitled - quota.used : null,
    annualEntitled: quota ? quota.entitled : null,
    pendingRequests: requests.n,
    recentDecisions: decisions.map((d) => ({
      status: d.status,
      fromDate: d.from_date,
      toDate: d.to_date,
      decidedAt: d.decided_at,
    })),
    latestPayslip: payslip
      ? { id: payslip.id, year: payslip.year, month: payslip.month, netPaise: payslip.net_paise }
      : null,
    appraisal: appraisal
      ? {
          status: appraisal.status,
          cycleName: appraisal.name,
          finalRating: appraisal.cal_status === "Finalised" ? appraisal.rating : null,
        }
      : null,
    hasDeclaration: declaration.n > 0,
    financialYear: fy,
    form16: form16 ? { id: form16.id, financialYear: form16.financial_year } : null,
    upcoming: [...holidays, ...leave.map((l) => ({ ...l, title: "Your leave", href: "/time/my-leave" }))]
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)),
  };
}

/* ------------------------------------------------------ the manager */

export type TeamHome = {
  teamSize: number;
  pendingLeave: number;
  awaitingRating: number;
  awayThisWeek: number;
  upcoming: UpcomingEvent[];
};

export async function teamHome(reportIds: number[], today: string): Promise<TeamHome> {
  const horizon = addDays(today, 13);
  const weekEnd = addDays(today, 6);
  if (reportIds.length === 0) {
    return { teamSize: 0, pendingLeave: 0, awaitingRating: 0, awayThisWeek: 0, upcoming: [] };
  }
  const ids = reportIds.map(() => "?").join(",");

  const [counts, leave, celebrations] = await Promise.all([
    one<{ pending: number; rating: number; away: number }>(
      `SELECT
         (SELECT COUNT(*) FROM pt_leave_request
            WHERE status = 'Pending' AND employee_id IN (${ids})) AS pending,
         (SELECT COUNT(*) FROM pm_appraisal a JOIN pm_appraisal_cycle c ON c.id = a.cycle_id
            WHERE c.status = 'Active' AND a.status = 'Pending manager review'
              AND a.employee_id IN (${ids})) AS rating,
         (SELECT COUNT(DISTINCT employee_id) FROM pt_it2001_absence
            WHERE start_date <= ? AND end_date >= ? AND employee_id IN (${ids})) AS away`,
      [...reportIds, ...reportIds, weekEnd, today, ...reportIds],
    ),
    leaveBetween(today, today, horizon, reportIds),
    celebrationsBetween(today, 14, reportIds),
  ]);

  return {
    teamSize: reportIds.length,
    pendingLeave: counts.pending,
    awaitingRating: counts.rating,
    awayThisWeek: counts.away,
    upcoming: [...leave, ...celebrations].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)),
  };
}
