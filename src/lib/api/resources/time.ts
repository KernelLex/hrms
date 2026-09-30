import "server-only";
import { z } from "zod";
import type { InValue } from "@libsql/client";
import { rawClient } from "@/lib/db";
import { recordAbsence, submitLeave } from "@/lib/services/records";
import { ownerOf } from "@/lib/services/integration";
import { forecastBalance } from "@/lib/engines/leave-policy";
import { DEFAULT_LIMIT, IsoDate, PageQuery, decodeCursor, page, pageSchema, pickFields } from "../format";
import { ApiError, invalid } from "../problem";
import type { ApiContext, Endpoint } from "../router";
import { companyClause } from "./employees";
import { codeList } from "./org";

/** Time: holidays, absences, leave requests and balances. */

export const rows = async (sql: string, args: InValue[] = []) => (await rawClient().execute({ sql, args })).rows as unknown as Record<string, unknown>[];
export const s = (v: unknown) => (v === null || v === undefined ? null : String(v));

/** Rows about employees the client may see: joins the latest org assignment. */
export function visibleEmployees(ctx: ApiContext, employeeColumn: string) {
  if (!ctx.client.companies) return { sql: "1 = 1", args: [] as string[] };
  const c = companyClause(ctx, "vo.company_code");
  return {
    sql: `${employeeColumn} IN (SELECT vo.employee_id FROM pa_it0001_org_assignment vo WHERE ${c.sql})`,
    args: c.args,
  };
}

const Holiday = z.object({ id: z.number().int(), date: IsoDate, name: z.string(), calendar: z.string() }).meta({ id: "Holiday" });
export const Absence = z
  .object({
    id: z.number().int(),
    employee_id: z.number().int(),
    absence_type: z.string(),
    start_date: IsoDate,
    end_date: IsoDate,
    working_days: z.number(),
    calendar_days: z.number(),
    half_day: z.boolean(),
    remarks: z.string().nullable(),
    from_leave_request_id: z.number().int().nullable(),
    created_at: z.string(),
  })
  .meta({ id: "Absence" });
const LeaveRequest = z
  .object({
    id: z.number().int(),
    employee_id: z.number().int(),
    absence_type: z.string(),
    from_date: IsoDate,
    to_date: IsoDate,
    working_days: z.number(),
    half_day: z.boolean(),
    reason: z.string().nullable(),
    status: z.string().meta({ description: "Pending, Approved, Rejected or Cancelled." }),
    submitted_at: z.string(),
    decided_at: z.string().nullable(),
  })
  .meta({ id: "LeaveRequest" });
const Balance = z
  .object({
    employee_id: z.number().int(),
    quota_type: z.string(),
    year: z.number().int(),
    entitled_days: z.number(),
    used_days: z.number(),
    remaining_days: z.number(),
    forecast_days: z.number().optional().meta({ description: "Present only with `as_of`: the balance projected to that date." }),
  })
  .meta({ id: "LeaveBalance" });
const LeaveLedgerEntry = z
  .object({
    id: z.number().int(),
    employee_id: z.number().int(),
    quota_type: z.string(),
    year: z.number().int(),
    entry_type: z.enum(["Accrual", "Use", "Restore", "CarryForward", "Lapse", "Encashment", "Adjustment"]),
    days: z.number().meta({ description: "Signed: positive credits, negative debits." }),
    note: z.string().nullable(),
    created_at: z.string(),
  })
  .meta({ id: "LeaveLedgerEntry" });
const HolidayCalendar = z.object({ code: z.string(), name: z.string(), is_active: z.boolean() }).meta({ id: "HolidayCalendar" });
const LeavePolicy = z
  .object({
    code: z.string(),
    name: z.string(),
    quota_type: z.string(),
    applies_to_grade: z.string().nullable(),
    applies_to_area: z.string().nullable(),
    entitlement_days_per_year: z.number(),
    accrual_frequency: z.enum(["Monthly", "Yearly"]),
    pro_rata_for_joiners: z.boolean(),
    carry_forward_cap_days: z.number(),
    lapse_on: z.string().meta({ description: "MM-DD." }),
    encashable_days_per_year: z.number(),
    sandwich_rule: z.boolean(),
    is_active: z.boolean(),
  })
  .meta({ id: "LeavePolicy" });

export const absenceOf = (r: Record<string, unknown>) => ({
  id: Number(r.id),
  employee_id: Number(r.employee_id),
  absence_type: String(r.absence_type_code),
  start_date: String(r.start_date),
  end_date: String(r.end_date),
  working_days: Number(r.payroll_days),
  calendar_days: Number(r.calendar_days),
  half_day: Number(r.is_half_day) === 1,
  remarks: s(r.remarks),
  from_leave_request_id: r.source_request_id === null ? null : Number(r.source_request_id),
  created_at: String(r.created_at),
});

export const idPage = async <T extends { id: number }>(ctx: ApiContext, sql: string, args: InValue[], map: (r: Record<string, unknown>) => T) => {
  const q = ctx.query as { limit?: number; cursor?: string; fields?: string };
  const limit = q.limit ?? DEFAULT_LIMIT;
  const found = await rows(`${sql} AND id > ? ORDER BY id LIMIT ?`, [...args, decodeCursor(q.cursor), limit + 1]);
  const paged = page(found.map(map), limit);
  return { body: { data: paged.data.map((r) => pickFields(r, q.fields)), next_cursor: paged.next_cursor } };
};

export const timeEndpoints: Endpoint[] = [
  {
    method: "GET",
    path: "/holidays",
    tag: "Time",
    summary: "List public holidays",
    description: "Filter with `calendar` for one holiday calendar's own list — see /holiday-calendars for the codes.",
    scopes: ["time:read"],
    query: z.object({ ...PageQuery, year: z.coerce.number().int().optional(), calendar: z.string().optional() }),
    response: pageSchema(Holiday),
    handler: (ctx) => {
      const q = ctx.query as { year?: number; calendar?: string };
      const where = [q.year ? "substr(date, 1, 4) = ?" : null, q.calendar ? "calendar_code = ?" : null].filter((w): w is string => w !== null);
      const args = [q.year ? String(q.year) : null, q.calendar ?? null].filter((a): a is string => a !== null);
      return idPage(ctx, `SELECT * FROM pt_holiday WHERE ${where.length ? where.join(" AND ") : "1 = 1"}`, args, (r) => ({
        id: Number(r.id),
        date: String(r.date),
        name: String(r.name),
        calendar: String(r.calendar_code),
      }));
    },
  },
  {
    method: "GET",
    path: "/absences",
    tag: "Time",
    summary: "List absences",
    description: "Recorded absences — approved leave and absences HR or the ERP entered. With `updated_since`, only those recorded since.",
    scopes: ["time:read"],
    query: z.object({
      ...PageQuery,
      employee_id: z.coerce.number().int().optional(),
      from: IsoDate.optional().meta({ description: "Absences ending on or after this date." }),
      to: IsoDate.optional().meta({ description: "Absences starting on or before this date." }),
      updated_since: z.string().datetime({ offset: true }).optional(),
    }),
    response: pageSchema(Absence),
    handler: (ctx) => {
      const q = ctx.query as { employee_id?: number; from?: string; to?: string; updated_since?: string };
      const v = visibleEmployees(ctx, "employee_id");
      const where = [v.sql];
      const args: InValue[] = [...v.args];
      if (q.employee_id) {
        where.push("employee_id = ?");
        args.push(q.employee_id);
      }
      if (q.from) {
        where.push("end_date >= ?");
        args.push(q.from);
      }
      if (q.to) {
        where.push("start_date <= ?");
        args.push(q.to);
      }
      if (q.updated_since) {
        where.push("created_at > ?");
        args.push(new Date(q.updated_since).toISOString());
      }
      return idPage(ctx, `SELECT * FROM pt_it2001_absence WHERE ${where.join(" AND ")}`, args, absenceOf);
    },
  },
  {
    method: "POST",
    path: "/absences",
    tag: "Time",
    summary: "Record an absence",
    description:
      "Records an absence with the same checks HR's screen applies; working days are counted against the schedule and holidays. Absences are owned by the HRMS by default: HR must make the ERP their owner before it may send them. Send an Idempotency-Key.",
    scopes: ["time:write"],
    body: z.object({
      employee_id: z.number().int(),
      absence_type: z.string().min(1).meta({ description: "An absence type code, such as 0300 for unpaid leave." }),
      start_date: IsoDate,
      end_date: IsoDate,
      remarks: z.string().nullable().default(null),
    }),
    response: Absence,
    status: 201,
    idempotent: true,
    example: { body: { employee_id: 3, absence_type: "0100", start_date: "2026-10-05", end_date: "2026-10-06", remarks: "Sick, from the ERP's attendance" } },
    handler: async (ctx) => {
      if ((await ownerOf("absence")) !== "erp") {
        throw new ApiError(409, "owned_by_hrms", "Absences are owned by the HRMS here; ask HR to make the ERP their owner first.");
      }
      const b = ctx.body as { employee_id: number; absence_type: string; start_date: string; end_date: string; remarks: string | null };
      if (ctx.client.companies) {
        const c = companyClause(ctx, "company_code");
        const inside = await rows(`SELECT 1 FROM pa_it0001_org_assignment WHERE employee_id = ? AND ${c.sql} LIMIT 1`, [b.employee_id, ...c.args]);
        if (inside.length === 0) throw invalid("That employee is outside the companies this client may see.");
      }
      const saved = await recordAbsence(ctx.actor, {
        employeeId: b.employee_id,
        absenceTypeCode: b.absence_type,
        startDate: b.start_date,
        endDate: b.end_date,
        remarks: b.remarks,
        createdBy: `${ctx.client.name} (API)`,
      });
      if (!saved.ok) throw invalid(saved.error);
      return { status: 201, body: absenceOf(saved.value), headers: { Location: `/api/v1/absences/${saved.value.id}` } };
    },
  },
  {
    method: "GET",
    path: "/leave-requests",
    tag: "Time",
    summary: "List leave requests",
    scopes: ["time:read"],
    query: z.object({ ...PageQuery, status: z.enum(["Pending", "Approved", "Rejected", "Cancelled"]).optional(), employee_id: z.coerce.number().int().optional() }),
    response: pageSchema(LeaveRequest),
    handler: (ctx) => {
      const q = ctx.query as { status?: string; employee_id?: number };
      const v = visibleEmployees(ctx, "employee_id");
      const where = [v.sql];
      const args: InValue[] = [...v.args];
      if (q.status) {
        where.push("status = ?");
        args.push(q.status);
      }
      if (q.employee_id) {
        where.push("employee_id = ?");
        args.push(q.employee_id);
      }
      return idPage(ctx, `SELECT * FROM pt_leave_request WHERE ${where.join(" AND ")}`, args, (r) => ({
        id: Number(r.id),
        employee_id: Number(r.employee_id),
        absence_type: String(r.absence_type_code),
        from_date: String(r.from_date),
        to_date: String(r.to_date),
        working_days: Number(r.payroll_days),
        half_day: Number(r.is_half_day) === 1,
        reason: s(r.reason),
        status: String(r.status),
        submitted_at: String(r.submitted_at),
        decided_at: s(r.decided_at),
      }));
    },
  },
  {
    method: "GET",
    path: "/leave-balances",
    tag: "Time",
    summary: "Leave balances for a year",
    description: "With `as_of`, each row also carries `forecast_days`: the balance projected to that date — the same forecast My leave shows, current balance plus whatever monthly accrual falls before then.",
    scopes: ["time:read"],
    query: z.object({ year: z.coerce.number().int(), employee_id: z.coerce.number().int().optional(), as_of: IsoDate.optional() }),
    response: z.object({ data: z.array(Balance) }),
    example: { query: "year=2026&employee_id=3" },
    handler: async (ctx) => {
      const q = ctx.query as { year: number; employee_id?: number; as_of?: string };
      const v = visibleEmployees(ctx, "employee_id");
      const found = await rows(
        `SELECT * FROM pt_it2006_absence_quota WHERE year = ? AND ${v.sql} ${q.employee_id ? "AND employee_id = ?" : ""}
         ORDER BY employee_id, quota_type_code`,
        [q.year, ...v.args, ...(q.employee_id ? [q.employee_id] : [])],
      );
      const asOf = q.as_of;
      const data = await Promise.all(
        found.map(async (r) => ({
          employee_id: Number(r.employee_id),
          quota_type: String(r.quota_type_code),
          year: Number(r.year),
          entitled_days: Number(r.entitled_half_days) / 2,
          used_days: Number(r.used_half_days) / 2,
          remaining_days: (Number(r.entitled_half_days) - Number(r.used_half_days)) / 2,
          ...(asOf ? { forecast_days: (await forecastBalance(Number(r.employee_id), String(r.quota_type_code), asOf)) / 2 } : {}),
        })),
      );
      return {
        body: {
          data,
        },
      };
    },
  },
  {
    method: "GET",
    path: "/leave-ledger",
    tag: "Time",
    summary: "Leave ledger entries",
    description: "Every credit and debit behind a balance — accrual, use, a carry-forward, a lapse, an encashment or a manual adjustment. `employee_id` is required; filter further with `quota_type` and `year`.",
    scopes: ["time:read"],
    query: z.object({ ...PageQuery, employee_id: z.coerce.number().int(), quota_type: z.string().optional(), year: z.coerce.number().int().optional() }),
    response: pageSchema(LeaveLedgerEntry),
    example: { query: "employee_id=3&year=2026" },
    handler: (ctx) => {
      const q = ctx.query as { employee_id: number; quota_type?: string; year?: number };
      const v = visibleEmployees(ctx, "employee_id");
      const where = [v.sql, "employee_id = ?"];
      const args: InValue[] = [...v.args, q.employee_id];
      if (q.quota_type) {
        where.push("quota_type_code = ?");
        args.push(q.quota_type);
      }
      if (q.year) {
        where.push("year = ?");
        args.push(q.year);
      }
      return idPage(ctx, `SELECT * FROM pt_quota_ledger WHERE ${where.join(" AND ")}`, args, (r) => ({
        id: Number(r.id),
        employee_id: Number(r.employee_id),
        quota_type: String(r.quota_type_code),
        year: Number(r.year),
        entry_type: String(r.entry_type) as "Accrual" | "Use" | "Restore" | "CarryForward" | "Lapse" | "Encashment" | "Adjustment",
        days: Number(r.half_days) / 2,
        note: s(r.note),
        created_at: String(r.created_at),
      }));
    },
  },
  codeList({
    path: "/leave-policies",
    tag: "Time",
    summary: "List leave policies",
    scopes: ["time:read"],
    schema: LeavePolicy,
    sql: () => ({ sql: "SELECT * FROM pt_leave_policy WHERE is_active = 1", args: [] }),
    map: (r) => ({
      code: String(r.code),
      name: String(r.name),
      quota_type: String(r.quota_type_code),
      applies_to_grade: s(r.applies_to_grade),
      applies_to_area: s(r.applies_to_area_code),
      entitlement_days_per_year: Number(r.entitlement_half_days_per_year) / 2,
      accrual_frequency: String(r.accrual_frequency) as "Monthly" | "Yearly",
      pro_rata_for_joiners: Number(r.pro_rata_for_joiners) === 1,
      carry_forward_cap_days: Number(r.carry_forward_cap_half_days) / 2,
      lapse_on: String(r.lapse_on),
      encashable_days_per_year: Number(r.encashable_half_days_per_year) / 2,
      sandwich_rule: Number(r.sandwich_rule) === 1,
      is_active: Number(r.is_active) === 1,
    }),
  }),
  codeList({
    path: "/holiday-calendars",
    tag: "Time",
    summary: "List holiday calendars",
    description: "The named holiday lists personnel areas sit on — see /holidays?calendar= for one calendar's own dates.",
    scopes: ["time:read"],
    schema: HolidayCalendar,
    sql: () => ({ sql: "SELECT * FROM pt_holiday_calendar WHERE is_active = 1", args: [] }),
    map: (r) => ({ code: String(r.code), name: String(r.name), is_active: Number(r.is_active) === 1 }),
  }),
  {
    method: "POST",
    path: "/leave-requests",
    tag: "Time",
    summary: "Submit a leave request",
    description:
      "Applies for leave exactly as My leave does: working days and the sandwich rule computed from the employee's own calendar, then routed to whoever their flow assigns. The employee needs their own sign-in for this — one behind `self.leave` or `time.manage` — so the request has a real requester to exclude from approving it. Send an Idempotency-Key.",
    scopes: ["time:write"],
    body: z.object({
      employee_id: z.number().int(),
      absence_type: z.string().min(1).meta({ description: "An absence type code, such as 0200 for annual leave." }),
      from_date: IsoDate,
      to_date: IsoDate,
      half_day: z.boolean().default(false),
      reason: z.string().nullable().default(null),
    }),
    response: LeaveRequest,
    status: 201,
    idempotent: true,
    example: { body: { employee_id: 3, absence_type: "0200", from_date: "2026-11-10", to_date: "2026-11-12", reason: "Family event" } },
    handler: async (ctx) => {
      const b = ctx.body as { employee_id: number; absence_type: string; from_date: string; to_date: string; half_day: boolean; reason: string | null };
      if (ctx.client.companies) {
        const c = companyClause(ctx, "company_code");
        const inside = await rows(`SELECT 1 FROM pa_it0001_org_assignment WHERE employee_id = ? AND ${c.sql} LIMIT 1`, [b.employee_id, ...c.args]);
        if (inside.length === 0) throw invalid("That employee is outside the companies this client may see.");
      }
      const user = (
        await rows("SELECT id, username, display_name FROM sec_app_user WHERE employee_id = ? AND is_active = 1 LIMIT 1", [b.employee_id])
      )[0];
      if (!user) {
        throw new ApiError(409, "conflict", "That employee has no linked sign-in, so a leave request needs a real requester to route and cannot be submitted through the API for them yet.");
      }
      const saved = await submitLeave(
        { userId: Number(user.id), username: String(user.username), displayName: String(user.display_name), employeeId: b.employee_id },
        { employeeId: b.employee_id, absenceTypeCode: b.absence_type, fromDate: b.from_date, toDate: b.to_date, isHalfDay: b.half_day, reason: b.reason },
      );
      if (!saved.ok) throw invalid(saved.error);
      const r = saved.value;
      return {
        status: 201,
        body: {
          id: Number(r.id),
          employee_id: Number(r.employee_id),
          absence_type: String(r.absence_type_code),
          from_date: String(r.from_date),
          to_date: String(r.to_date),
          working_days: Number(r.payroll_days),
          half_day: Number(r.is_half_day) === 1,
          reason: s(r.reason),
          status: String(r.status),
          submitted_at: String(r.submitted_at),
          decided_at: s(r.decided_at),
        },
        headers: { Location: `/api/v1/leave-requests/${r.id}` },
      };
    },
  },
];
