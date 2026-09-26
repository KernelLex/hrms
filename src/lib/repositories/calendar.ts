import "server-only";
import { rawClient } from "@/lib/db";

/**
 * Who is away on which day of a month — recorded absences, requests still
 * waiting on a decision, and the days nobody works. One read per statement,
 * for one page of people.
 */

export type DayState = "working" | "away" | "half" | "requested" | "off";

export type CalendarPerson = {
  id: number;
  name: string;
  number: string;
  days: { state: DayState; note: string }[];
  awayDays: number;
};

export type TeamCalendar = {
  year: number;
  month: number;
  days: { date: string; day: number; weekday: string; holiday: string | null }[];
  people: CalendarPerson[];
  total: number;
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export async function teamCalendar(opts: {
  year: number;
  month: number;
  /** A manager's direct reports; everyone when absent. */
  onlyIds?: number[];
  limit: number;
  offset: number;
}): Promise<TeamCalendar> {
  const { year, month } = opts;
  const mm = String(month).padStart(2, "0");
  const from = `${year}-${mm}-01`;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const to = `${year}-${mm}-${String(last).padStart(2, "0")}`;

  const days = Array.from({ length: last }, (_, i) => {
    const date = `${year}-${mm}-${String(i + 1).padStart(2, "0")}`;
    return { date, day: i + 1, weekday: WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()], holiday: null as string | null };
  });

  if (opts.onlyIds && opts.onlyIds.length === 0) return { year, month, days, people: [], total: 0 };
  const scope = opts.onlyIds ? `AND e.id IN (${opts.onlyIds.map(() => "?").join(", ")})` : "";
  const scopeArgs = opts.onlyIds ?? [];

  const client = rawClient();
  const [holidays, people, count] = await client.batch(
    [
      { sql: "SELECT date, name FROM pt_holiday WHERE date BETWEEN ? AND ?", args: [from, to] },
      {
        sql: `SELECT e.id, e.employee_number, e.hire_date, e.termination_date,
                     COALESCE(p.first_name || ' ' || p.last_name, e.employee_number) AS name
              FROM pa_employee e
              LEFT JOIN pa_it0002_personal_data p
                ON p.employee_id = e.id AND p.valid_from <= ?2 AND p.valid_to >= ?2
              WHERE e.hire_date <= ?2 AND (e.termination_date IS NULL OR e.termination_date >= ?1) ${scope}
              ORDER BY name LIMIT ${Math.max(1, opts.limit)} OFFSET ${Math.max(0, opts.offset)}`,
        args: [from, to, ...scopeArgs],
      },
      {
        sql: `SELECT COUNT(*) AS n FROM pa_employee e
              WHERE e.hire_date <= ?2 AND (e.termination_date IS NULL OR e.termination_date >= ?1) ${scope}`,
        args: [from, to, ...scopeArgs],
      },
    ],
    "read",
  );

  for (const h of holidays.rows) {
    const d = days.find((x) => x.date === String(h.date));
    if (d) d.holiday = String(h.name);
  }

  const ids = people.rows.map((p) => Number(p.id));
  const [absences, requests] = ids.length
    ? await client.batch(
        [
          {
            sql: `SELECT a.employee_id, a.start_date, a.end_date, a.is_half_day, t.name AS type
                  FROM pt_it2001_absence a JOIN pt_absence_type t ON t.code = a.absence_type_code
                  WHERE a.start_date <= ? AND a.end_date >= ?
                    AND a.employee_id IN (${ids.map(() => "?").join(", ")})`,
            args: [to, from, ...ids],
          },
          {
            sql: `SELECT r.employee_id, r.from_date, r.to_date, t.name AS type
                  FROM pt_leave_request r JOIN pt_absence_type t ON t.code = r.absence_type_code
                  WHERE r.status = 'Pending' AND r.from_date <= ? AND r.to_date >= ?
                    AND r.employee_id IN (${ids.map(() => "?").join(", ")})`,
            args: [to, from, ...ids],
          },
        ],
        "read",
      )
    : [{ rows: [] }, { rows: [] }];

  const label = (date: string) => {
    const d = days.find((x) => x.date === date)!;
    return `${d.weekday} ${d.day}`;
  };

  const result: CalendarPerson[] = people.rows.map((p) => {
    const id = Number(p.id);
    const name = String(p.name);
    const hire = String(p.hire_date);
    const leave = p.termination_date ? String(p.termination_date) : null;
    let away = 0;
    const cells = days.map(({ date, weekday, holiday }) => {
      const at = `${label(date)}: ${name}`;
      if (date < hire || (leave && date > leave)) return { state: "off" as DayState, note: `${at}, not employed` };
      if (holiday) return { state: "off" as DayState, note: `${at}, ${holiday}` };
      if (weekday === "Sat" || weekday === "Sun") return { state: "off" as DayState, note: `${at}, weekend` };
      const a = absences.rows.find(
        (x) => Number(x.employee_id) === id && String(x.start_date) <= date && String(x.end_date) >= date,
      );
      if (a) {
        const half = Number(a.is_half_day) === 1;
        away += half ? 0.5 : 1;
        return { state: (half ? "half" : "away") as DayState, note: `${at}, ${a.type}${half ? ", half day" : ""}` };
      }
      const r = requests.rows.find(
        (x) => Number(x.employee_id) === id && String(x.from_date) <= date && String(x.to_date) >= date,
      );
      if (r) return { state: "requested" as DayState, note: `${at}, ${r.type} requested, awaiting a decision` };
      return { state: "working" as DayState, note: `${at}, working` };
    });
    return { id, name, number: String(p.employee_number), days: cells, awayDays: away };
  });

  return { year, month, days, people: result, total: Number(count.rows[0].n) };
}
