import "server-only";
import { z } from "zod";
import type { InValue } from "@libsql/client";
import { rawClient } from "@/lib/db";
import { recordExternalClaim } from "@/lib/services/claims";
import { DEFAULT_LIMIT, IsoDate, Money, PageQuery, decodeCursor, money, page, pageSchema, pickFields, toPaiseExact } from "../format";
import { invalid } from "../problem";
import type { ApiContext, Endpoint } from "../router";
import { employeeInScope } from "./payroll";

/**
 * Loans, with the schedule the ERP books the receivable from, and claims —
 * one way only: the ERP sends in a claim its own process already approved,
 * to be paid through payroll instead of retyped. There is no POST /loans or
 * GET /claims: a loan is asked for and decided in the HRMS, a claim the ERP
 * sends is never read back through this resource.
 */

const rows = async (sql: string, args: InValue[] = []) => (await rawClient().execute({ sql, args })).rows as unknown as Record<string, unknown>[];
const s = (v: unknown) => (v === null || v === undefined ? null : String(v));
const m = (v: unknown) => money(Number(v))! as { amount: string; currency: "INR" };

/** Loans and claims visible to the client, through the employee's own company. */
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

const LoanScheduleLine = z
  .object({
    installment_no: z.number().int(),
    due_date: IsoDate,
    opening_balance: Money,
    principal: Money,
    interest: Money,
    closing_balance: Money,
    perquisite_value: Money.meta({ description: "What rule 3(7)(i) adds to taxable income for this instalment's month — zero unless this is a concessional loan over ₹20,000." }),
    paid: z.boolean().meta({ description: "Queued onto a payroll run." }),
  })
  .meta({ id: "LoanScheduleLine" });
const Loan = z
  .object({
    id: z.number().int(),
    employee_id: z.number().int(),
    loan_type: z.string(),
    principal: Money,
    annual_rate_percent: z.number(),
    tenure_months: z.number().int(),
    emi: Money,
    start_date: IsoDate,
    status: z.enum(["Pending", "Active", "Closed", "Rejected"]),
    reason: z.string().nullable(),
    requested_at: z.string(),
    decided_at: z.string().nullable(),
    schedule: z.array(LoanScheduleLine).meta({ description: "Generated once, the moment the loan is approved. Empty for a loan still pending or rejected." }),
  })
  .meta({ id: "Loan", description: "An employee loan with its full EMI schedule — book the receivable once status is Active, or from the loan.approved event." });

const ClaimLine = z.object({ date: IsoDate, description: z.string(), amount: Money }).meta({ id: "ClaimLine" });
const Claim = z
  .object({
    id: z.number().int(),
    employee_id: z.number().int(),
    category: z.string(),
    claim_date: IsoDate,
    total_amount: Money,
    status: z.literal("Approved").meta({ description: "Always Approved: a claim sent here skips the HRMS's own approval, since the ERP's process already decided it." }),
    wage_type: z.string().meta({ description: "CLAIM or REIMB, by the category's own taxability — what it is queued to be paid on." }),
    decided_at: z.string().nullable(),
    lines: z.array(ClaimLine),
  })
  .meta({ id: "Claim" });

async function claimRepOf(id: number): Promise<z.infer<typeof Claim> | null> {
  const [claim] = await rows("SELECT * FROM py_claim WHERE id = ?", [id]);
  if (!claim) return null;
  const [lines, payment] = await Promise.all([
    rows("SELECT * FROM py_claim_line WHERE claim_id = ? ORDER BY id", [id]),
    claim.additional_payment_id ? rows("SELECT wage_type_code FROM py_it0015_additional_payment WHERE id = ?", [Number(claim.additional_payment_id)]) : Promise.resolve([]),
  ]);
  return {
    id: Number(claim.id),
    employee_id: Number(claim.employee_id),
    category: String(claim.category_code),
    claim_date: String(claim.claim_date),
    total_amount: m(claim.total_amount_paise),
    status: "Approved",
    wage_type: payment[0] ? String(payment[0].wage_type_code) : "",
    decided_at: s(claim.decided_at),
    lines: lines.map((l) => ({ date: String(l.line_date), description: String(l.description), amount: m(l.amount_paise) })),
  };
}

export const loansClaimsEndpoints: Endpoint[] = [
  {
    method: "GET",
    path: "/loans",
    tag: "Payments",
    summary: "List loans",
    description:
      "Each employee loan with its EMI schedule, generated the moment it is approved — book the receivable from it, or from the loan.approved event, and watch loan.closed for when it is recovered in full. `perquisite_value` on each instalment is the concessional-loan taxable value rule 3(7)(i) adds for that month.",
    scopes: ["payroll:read", "pay:read"],
    query: z.object({ ...PageQuery, employee_id: z.coerce.number().int().optional(), status: z.enum(["Pending", "Active", "Closed", "Rejected"]).optional() }),
    response: pageSchema(Loan),
    handler: (ctx) => {
      const q = ctx.query as { employee_id?: number; status?: string };
      const v = visible(ctx, "employee_id");
      const where = [v.sql, ...(q.employee_id ? ["employee_id = ?"] : []), ...(q.status ? ["status = ?"] : [])];
      const args: InValue[] = [...v.args, ...(q.employee_id ? [q.employee_id] : []), ...(q.status ? [q.status] : [])];
      return idPage(ctx, `SELECT * FROM py_loan WHERE ${where.join(" AND ")}`, args, async (rs) => {
        const ids = rs.map((r) => Number(r.id));
        const schedules = ids.length ? await rows(`SELECT * FROM py_loan_schedule WHERE loan_id IN (${ids.map(() => "?").join(", ")}) ORDER BY installment_no`, ids) : [];
        return rs.map((r) => ({
          id: Number(r.id),
          employee_id: Number(r.employee_id),
          loan_type: String(r.loan_type),
          principal: m(r.principal_paise),
          annual_rate_percent: Number(r.annual_rate_basis_points) / 100,
          tenure_months: Number(r.tenure_months),
          emi: m(r.emi_paise),
          start_date: String(r.start_date),
          status: String(r.status) as "Pending" | "Active" | "Closed" | "Rejected",
          reason: s(r.reason),
          requested_at: String(r.requested_at),
          decided_at: s(r.decided_at),
          schedule: schedules
            .filter((l) => Number(l.loan_id) === Number(r.id))
            .map((l) => ({
              installment_no: Number(l.installment_no),
              due_date: String(l.due_date),
              opening_balance: m(l.opening_balance_paise),
              principal: m(l.principal_paise),
              interest: m(l.interest_paise),
              closing_balance: m(l.closing_balance_paise),
              perquisite_value: m(l.perquisite_value_paise),
              paid: l.additional_payment_id !== null,
            })),
        }));
      });
    },
  },
  {
    method: "POST",
    path: "/claims",
    tag: "Payments",
    summary: "Send a claim already approved in the ERP",
    description:
      "A reimbursement claim the ERP's own approval process already decided, to be paid through payroll instead of retyped on screen. Still checked against the category's limit — an HRMS payroll and tax policy the ERP's process has no reason to know — and refused over it. Written in as Approved straight away and queued for payment; there is no HRMS-side decision to wait on. Send an Idempotency-Key.",
    scopes: ["payroll:write"],
    body: z.object({
      employee_id: z.number().int(),
      category: z.string().min(1),
      claim_date: IsoDate,
      lines: z.array(z.object({ date: IsoDate, description: z.string().min(1), amount: Money })).min(1),
    }),
    response: Claim,
    status: 201,
    idempotent: true,
    example: {
      body: {
        employee_id: 3,
        category: "FUEL",
        claim_date: "2026-10-01",
        lines: [{ date: "2026-09-28", description: "Client-site mileage", amount: { amount: "2000.00", currency: "INR" } }],
      },
    },
    handler: async (ctx) => {
      const b = ctx.body as { employee_id: number; category: string; claim_date: string; lines: { date: string; description: string; amount: { amount: string } }[] };
      await employeeInScope(ctx, b.employee_id);
      const saved = await recordExternalClaim(ctx.actor, {
        employeeId: b.employee_id,
        categoryCode: b.category,
        claimDate: b.claim_date,
        lines: b.lines.map((l) => ({ date: l.date, description: l.description, amountPaise: toPaiseExact(l.amount) })),
      });
      if (!saved.ok) throw invalid(saved.error);
      const claim = await claimRepOf(saved.value.id);
      if (!claim) throw invalid("The claim could not be read back after it was written.");
      return { status: 201, body: claim };
    },
  },
];
