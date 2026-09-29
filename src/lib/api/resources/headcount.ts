import "server-only";
import { z } from "zod";
import type { InValue } from "@libsql/client";
import { rawClient } from "@/lib/db";
import { submitHeadcountRequest } from "@/lib/services/headcount";
import { DEFAULT_LIMIT, Money, PageQuery, decodeCursor, money, page, pageSchema, pickFields, toPaiseExact } from "../format";
import { invalid } from "../problem";
import type { Endpoint } from "../router";
import { companyClause } from "./employees";

/**
 * Headcount requests: a new position, asked for before it exists, approved
 * through the "headcount" flow (§5.6). A position budgeted in the ERP can be
 * requested from here, exactly as it is from My team.
 */

const HeadcountRequest = z
  .object({
    id: z.number().int(),
    org_unit_code: z.string(),
    job_code: z.string(),
    title: z.string(),
    grade: z.string().nullable(),
    budget: Money,
    reason: z.string().nullable(),
    requested_by_name: z.string(),
    status: z.enum(["Pending", "Approved", "Rejected", "Cancelled"]),
    position_code: z.string().nullable(),
    requested_at: z.string(),
    decided_at: z.string().nullable(),
  })
  .meta({ id: "HeadcountRequest" });

const Input = z
  .object({
    org_unit_code: z.string().min(1),
    job_code: z.string().min(1),
    title: z.string().min(1),
    grade: z.string().nullable().default(null),
    budget: Money,
    reason: z.string().max(1000).nullable().default(null),
  })
  .meta({ id: "HeadcountRequestInput" });

function repOf(r: Record<string, unknown>): z.infer<typeof HeadcountRequest> {
  return {
    id: Number(r.id),
    org_unit_code: String(r.org_unit_code),
    job_code: String(r.job_code),
    title: String(r.title),
    grade: r.grade === null ? null : String(r.grade),
    budget: money(Number(r.budget_paise))! as { amount: string; currency: "INR" },
    reason: r.reason === null ? null : String(r.reason),
    requested_by_name: String(r.requested_by_name),
    status: String(r.status) as "Pending",
    position_code: r.position_code === null ? null : String(r.position_code),
    requested_at: String(r.requested_at),
    decided_at: r.decided_at === null ? null : String(r.decided_at),
  };
}

export const headcountEndpoints: Endpoint[] = [
  {
    method: "POST",
    path: "/headcount-requests",
    tag: "Organisation",
    summary: "Ask for a new position",
    description:
      "Files a headcount request against a department and job that already exist, and starts its approval (manager, then HR, then a finance role by default). Approved, it opens a vacant position — the same one recruitment opens a requisition against — and arrives as `headcount_request.decided`; the new position also arrives as `position.changed`.",
    scopes: ["org:write"],
    body: Input,
    response: HeadcountRequest,
    status: 201,
    idempotent: true,
    example: {
      body: { org_unit_code: "OU0002", job_code: "JB0001", title: "Backend engineer", grade: "L3", budget: { amount: "90000.00", currency: "INR" }, reason: "Growing the platform team." },
    },
    handler: async (ctx) => {
      const b = ctx.body as z.infer<typeof Input>;
      const name = `${ctx.client.name} (API)`;
      const saved = await submitHeadcountRequest(
        { userId: null, username: name, displayName: name, employeeId: null },
        ctx.actor,
        {
          orgUnitCode: b.org_unit_code,
          jobCode: b.job_code,
          title: b.title,
          grade: b.grade,
          budgetPaise: toPaiseExact(b.budget),
          reason: b.reason,
        },
      );
      if (!saved.ok) throw invalid(saved.error);
      const [row] = (await rawClient().execute({ sql: "SELECT * FROM om_headcount_request WHERE id = ?", args: [saved.value.id] })).rows;
      return { status: 201, body: repOf(row as unknown as Record<string, unknown>) };
    },
  },
  {
    method: "GET",
    path: "/headcount-requests",
    tag: "Organisation",
    summary: "List headcount requests",
    description: "Oldest first. Filter with `status`.",
    scopes: ["org:read"],
    query: z.object({ ...PageQuery, status: z.enum(["Pending", "Approved", "Rejected", "Cancelled"]).optional() }),
    response: pageSchema(HeadcountRequest),
    handler: async (ctx) => {
      const q = ctx.query as { limit?: number; cursor?: string; fields?: string; status?: string };
      const limit = q.limit ?? DEFAULT_LIMIT;
      const c = companyClause(ctx, "ou.company_code");
      const where = ["h.id > ?"];
      const args: InValue[] = [decodeCursor(q.cursor)];
      if (q.status) {
        where.push("h.status = ?");
        args.push(q.status);
      }
      if (ctx.client.companies) {
        where.push(c.sql);
        args.push(...c.args);
      }
      const found = await rawClient().execute({
        sql: `SELECT h.* FROM om_headcount_request h JOIN om_org_unit ou ON ou.code = h.org_unit_code
              WHERE ${where.join(" AND ")} ORDER BY h.id LIMIT ?`,
        args: [...args, limit + 1],
      });
      const paged = page(
        found.rows.map((r) => repOf(r as unknown as Record<string, unknown>)),
        limit,
      );
      return { body: { data: paged.data.map((r) => pickFields(r, q.fields)), next_cursor: paged.next_cursor } };
    },
  },
];
