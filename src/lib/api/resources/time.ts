import "server-only";
import { z } from "zod";
import type { InValue } from "@libsql/client";
import { rawClient } from "@/lib/db";
import { recordAbsence } from "@/lib/services/records";
import { ownerOf } from "@/lib/services/integration";
import { DEFAULT_LIMIT, IsoDate, PageQuery, decodeCursor, page, pageSchema, pickFields } from "../format";
import { ApiError, invalid } from "../problem";
import type { ApiContext, Endpoint } from "../router";
import { companyClause } from "./employees";

/** Time: holidays, absences, leave requests and balances. */

const rows = async (sql: string, args: InValue[] = []) => (await rawClient().execute({ sql, args })).rows as unknown as Record<string, unknown>[];
const s = (v: unknown) => (v === null || v === undefined ? null : String(v));

/** Rows about employees the client may see: joins the latest org assignment. */
function visibleEmployees(ctx: ApiContext, employeeColumn: string) {
  if (!ctx.client.companies) return { sql: "1 = 1", args: [] as string[] };
  const c = companyClause(ctx, "vo.company_code");
  return {
    sql: `${employeeColumn} IN (SELECT vo.employee_id FROM pa_it0001_org_assignment vo WHERE ${c.sql})`,
    args: c.args,
  };
}

const Holiday = z.object({ id: z.number().int(), date: IsoDate, name: z.string(), region: z.string() }).meta({ id: "Holiday" });
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
  })
  .meta({ id: "LeaveBalance" });

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

const idPage = async <T extends { id: number }>(ctx: ApiContext, sql: string, args: InValue[], map: (r: Record<string, unknown>) => T) => {
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
    scopes: ["time:read"],
    query: z.object({ ...PageQuery, year: z.coerce.number().int().optional() }),
    response: pageSchema(Holiday),
    handler: (ctx) => {
      const year = (ctx.query as { year?: number }).year;
      return idPage(ctx, `SELECT * FROM pt_holiday WHERE ${year ? "substr(date, 1, 4) = ?" : "1 = 1"}`, year ? [String(year)] : [], (r) => ({
        id: Number(r.id),
        date: String(r.date),
        name: String(r.name),
        region: String(r.region),
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
    scopes: ["time:read"],
    query: z.object({ year: z.coerce.number().int(), employee_id: z.coerce.number().int().optional() }),
    response: z.object({ data: z.array(Balance) }),
    example: { query: "year=2026&employee_id=3" },
    handler: async (ctx) => {
      const q = ctx.query as { year: number; employee_id?: number };
      const v = visibleEmployees(ctx, "employee_id");
      const found = await rows(
        `SELECT * FROM pt_it2006_absence_quota WHERE year = ? AND ${v.sql} ${q.employee_id ? "AND employee_id = ?" : ""}
         ORDER BY employee_id, quota_type_code`,
        [q.year, ...v.args, ...(q.employee_id ? [q.employee_id] : [])],
      );
      return {
        body: {
          data: found.map((r) => ({
            employee_id: Number(r.employee_id),
            quota_type: String(r.quota_type_code),
            year: Number(r.year),
            entitled_days: Number(r.entitled_half_days) / 2,
            used_days: Number(r.used_half_days) / 2,
            remaining_days: (Number(r.entitled_half_days) - Number(r.used_half_days)) / 2,
          })),
        },
      };
    },
  },
];
