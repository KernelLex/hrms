import "server-only";
import { z } from "zod";
import type { InValue } from "@libsql/client";
import { rawClient } from "@/lib/db";
import { EXIT_TYPES, EXIT_STATUSES } from "@/db/schema";
import { DEFAULT_LIMIT, IsoDate, Money, PageQuery, decodeCursor, money, page, pageSchema, pickFields } from "../format";
import type { ApiContext, Endpoint } from "../router";

/**
 * Exits and settlements, read-only: the HRMS decides and pays both, through
 * its own approval flow and the off-cycle run. Clearance tasks are already
 * generic over `GET /tasks`, and the relieving and experience letters over
 * `GET /letters` — neither needed a line of code here.
 */

const rows = async (sql: string, args: InValue[] = []) => (await rawClient().execute({ sql, args })).rows as unknown as Record<string, unknown>[];
const s = (v: unknown) => (v === null || v === undefined ? null : String(v));
const m = (v: unknown) => money(Number(v))! as { amount: string; currency: "INR" };

function visible(ctx: ApiContext, column: string) {
  const companies = ctx.client.companies;
  if (!companies) return { sql: "1 = 1", args: [] as string[] };
  return {
    sql: `${column} IN (SELECT employee_id FROM pa_it0001_org_assignment WHERE company_code IN (${companies.map(() => "?").join(", ")}))`,
    args: companies,
  };
}

async function idPage<T extends { id: number }>(ctx: ApiContext, sql: string, args: InValue[], map: (rs: Record<string, unknown>[]) => Promise<T[]> | T[]) {
  const q = ctx.query as { limit?: number; cursor?: string; fields?: string };
  const limit = q.limit ?? DEFAULT_LIMIT;
  const found = await rows(`${sql} AND id > ? ORDER BY id LIMIT ?`, [...args, decodeCursor(q.cursor), limit + 1]);
  const paged = page(await map(found), limit);
  return { body: { data: paged.data.map((r) => pickFields(r, q.fields)), next_cursor: paged.next_cursor } };
}

const Exit = z
  .object({
    id: z.number().int(),
    employee_id: z.number().int(),
    exit_type: z.enum(EXIT_TYPES),
    reason: z.string().nullable(),
    requested_last_day: IsoDate,
    notice_days: z.number().int(),
    approved_last_day: IsoDate.nullable(),
    notice_waived: z.boolean(),
    status: z.enum(EXIT_STATUSES),
    requested_at: z.string(),
    decided_at: z.string().nullable(),
    exited_at: z.string().nullable().meta({ description: "Set once the termination has run and sign-in is disabled — the moment employee.exited fires." }),
  })
  .meta({ id: "Exit" });

const SettlementLine = z.object({ component: z.string(), basis: z.string(), amount: Money }).meta({ id: "SettlementLine" });
const Settlement = z
  .object({
    id: z.number().int(),
    exit_id: z.number().int(),
    employee_id: z.number().int(),
    status: z.enum(["Draft", "Paid"]),
    run_id: z.number().int().nullable(),
    computed_at: z.string(),
    paid_at: z.string().nullable(),
    lines: z.array(SettlementLine).meta({ description: "Salary to the last day, leave encashment, notice pay, gratuity, loan recovery and any pending claim — whatever applied. A negative amount recovers rather than pays." }),
  })
  .meta({ id: "Settlement", description: "A full and final settlement, paid in one off-cycle run." });

export const exitEndpoints: Endpoint[] = [
  {
    method: "GET",
    path: "/exits",
    tag: "People",
    summary: "List exits",
    description: "Every resignation, termination and retirement, approved or not. `employee.resigned` fires once approved, `employee.exited` on the last day.",
    scopes: ["employees:read"],
    query: z.object({ ...PageQuery, employee_id: z.coerce.number().int().optional(), status: z.enum(EXIT_STATUSES).optional() }),
    response: pageSchema(Exit),
    handler: (ctx) => {
      const q = ctx.query as { employee_id?: number; status?: string };
      const v = visible(ctx, "employee_id");
      const where = [v.sql, ...(q.employee_id ? ["employee_id = ?"] : []), ...(q.status ? ["status = ?"] : [])];
      const args: InValue[] = [...v.args, ...(q.employee_id ? [q.employee_id] : []), ...(q.status ? [q.status] : [])];
      return idPage(ctx, `SELECT * FROM pa_exit WHERE ${where.join(" AND ")}`, args, (rs) =>
        rs.map((r) => ({
          id: Number(r.id),
          employee_id: Number(r.employee_id),
          exit_type: String(r.exit_type) as (typeof EXIT_TYPES)[number],
          reason: s(r.reason),
          requested_last_day: String(r.requested_last_day),
          notice_days: Number(r.notice_days),
          approved_last_day: s(r.approved_last_day),
          notice_waived: Number(r.notice_waived) === 1,
          status: String(r.status) as (typeof EXIT_STATUSES)[number],
          requested_at: String(r.requested_at),
          decided_at: s(r.decided_at),
          exited_at: s(r.exited_at),
        })),
      );
    },
  },
  {
    method: "GET",
    path: "/settlements",
    tag: "Payments",
    summary: "List settlements",
    description: "Each full and final settlement, with every component and its basis. Needs pay:read for the amounts.",
    scopes: ["payroll:read", "pay:read"],
    query: z.object({ ...PageQuery, employee_id: z.coerce.number().int().optional() }),
    response: pageSchema(Settlement),
    handler: (ctx) => {
      const q = ctx.query as { employee_id?: number };
      const v = visible(ctx, "employee_id");
      const where = [v.sql, ...(q.employee_id ? ["employee_id = ?"] : [])];
      const args: InValue[] = [...v.args, ...(q.employee_id ? [q.employee_id] : [])];
      return idPage(ctx, `SELECT * FROM py_settlement WHERE ${where.join(" AND ")}`, args, async (rs) => {
        const ids = rs.map((r) => Number(r.id));
        const lineRows = ids.length ? await rows(`SELECT * FROM py_settlement_line WHERE settlement_id IN (${ids.map(() => "?").join(", ")}) ORDER BY sort_order`, ids) : [];
        return rs.map((r) => ({
          id: Number(r.id),
          exit_id: Number(r.exit_id),
          employee_id: Number(r.employee_id),
          status: String(r.status) as "Draft" | "Paid",
          run_id: r.run_id === null ? null : Number(r.run_id),
          computed_at: String(r.computed_at),
          paid_at: s(r.paid_at),
          lines: lineRows
            .filter((l) => Number(l.settlement_id) === Number(r.id))
            .map((l) => ({ component: String(l.component), basis: String(l.basis), amount: m(l.amount_paise) })),
        }));
      });
    },
  },
];
