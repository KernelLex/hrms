import "server-only";
import { z } from "zod";
import type { InValue } from "@libsql/client";
import { rawClient } from "@/lib/db";
import { OPEN_ENDED } from "@/db/schema";
import { addOneOffPayment, addRecurringPayment, recordRemittancePayment } from "@/lib/services/records";
import { ackStates, acknowledge, confirmPayments, ownerOf } from "@/lib/services/integration";
import { DEFAULT_LIMIT, IsoDate, Money, PageQuery, decodeCursor, money, page, pageSchema, pickFields, toPaiseExact, until } from "../format";
import { ApiError, invalid, notFound } from "../problem";
import { getPayslip, ytdForRun } from "@/lib/repositories/payslips";
import { payslipFileName, renderPayslipPdf } from "@/lib/documents/payslip-pdf";
import { logApiAccess, type ApiContext, type Endpoint } from "../router";

/**
 * Payroll: periods and runs, the results people are paid, and the three
 * documents the ERP books and pays — the journal, the payment batches and
 * the statutory remittances — with what the ERP sends back about each.
 */

const rows = async (sql: string, args: InValue[] = []) => (await rawClient().execute({ sql, args })).rows as unknown as Record<string, unknown>[];
const s = (v: unknown) => (v === null || v === undefined ? null : String(v));

/** Payroll areas the client may see, through each area's company. */
function areaClause(ctx: ApiContext, column: string) {
  const companies = ctx.client.companies;
  if (!companies) return { sql: "1 = 1", args: [] as string[] };
  return {
    sql: `${column} IN (SELECT code FROM om_personnel_area WHERE company_code IN (${companies.map(() => "?").join(", ")}))`,
    args: companies,
  };
}

/** Runs visible to the client. */
const runClause = (ctx: ApiContext, column: string) => {
  const a = areaClause(ctx, "pp.area_code");
  return {
    sql: `${column} IN (SELECT r.id FROM py_payroll_run r JOIN py_payroll_period pp ON pp.id = r.period_id WHERE ${a.sql})`,
    args: a.args,
  };
};

const Ack = z
  .object({
    state: z.enum(["pending", "acknowledged", "rejected"]),
    reference: z.string().nullable(),
    reason: z.string().nullable(),
    updated_at: z.string().nullable(),
  })
  .meta({ id: "Acknowledgement", description: "Whether the ERP booked it: its reference, or its reason for refusing." });

const Period = z
  .object({ id: z.number().int(), personnel_area: z.string(), year: z.number().int(), month: z.number().int(), pay_date: IsoDate.nullable(), status: z.string(), posted_at: z.string().nullable() })
  .meta({ id: "PayrollPeriod" });
const Run = z
  .object({
    id: z.number().int(),
    period_id: z.number().int(),
    run_type: z.string().meta({ description: "Regular or Off-cycle." }),
    status: z.string(),
    reason: z.string().nullable(),
    pay_date: IsoDate.nullable(),
    employee_count: z.number().int(),
    error_count: z.number().int(),
    gross_total: Money.optional().meta({ description: "With pay:read." }),
    net_total: Money.optional().meta({ description: "With pay:read." }),
    completed_at: z.string().nullable(),
  })
  .meta({ id: "PayrollRun" });
const Result = z
  .object({
    id: z.number().int(),
    run_id: z.number().int(),
    employee_id: z.number().int(),
    status: z.string(),
    gross: Money,
    net: Money,
    lines: z.array(z.object({ wage_type: z.string(), name: z.string(), kind: z.string(), amount: Money })),
    published_at: z.string().nullable().meta({ description: "When the employee could first see it; null until its month is posted." }),
    year_to_date: z
      .object({
        financial_year: z.string().meta({ description: "Such as 2026-27." }),
        gross: Money,
        deductions: Money,
        net: Money,
        lines: z.array(z.object({ wage_type: z.string(), amount: Money })),
      })
      .meta({ description: "The financial year so far, up to and including this payslip, summed from the stored lines." }),
  })
  .meta({ id: "PayrollResult" });
const GlPosting = z
  .object({
    id: z.number().int(),
    run_id: z.number().int(),
    posting_date: IsoDate,
    posted_at: z.string(),
    total_debit: Money,
    total_credit: Money,
    lines: z.array(
      z.object({ gl_account: z.string(), description: z.string(), cost_centre: z.string().nullable(), debit: Money, credit: Money }),
    ),
    acknowledgement: Ack,
  })
  .meta({ id: "GlPosting", description: "The payroll journal for one run: the most important thing the ERP takes from the HRMS." });
const PaymentBatch = z
  .object({
    id: z.number().int(),
    run_id: z.number().int(),
    payment_date: IsoDate,
    format: z.string(),
    line_count: z.number().int(),
    total: Money.optional().meta({ description: "With pay:read." }),
    paid: z.number().int(),
    failed: z.number().int(),
    pending: z.number().int(),
    lines: z.array(
      z.object({
        employee_id: z.number().int(),
        employee_name: z.string(),
        bank_name: z.string(),
        account_number: z.string().optional().meta({ description: "With bank:read." }),
        ifsc: z.string().nullable(),
        amount: Money.optional().meta({ description: "With pay:read." }),
        payment_status: z.enum(["pending", "paid", "failed"]),
        bank_reference: z.string().nullable(),
        failure_reason: z.string().nullable(),
      }),
    ),
  })
  .meta({ id: "PaymentBatch", description: "The salaries of one run for the ERP to pay, and what it confirmed." });
const Remittance = z
  .object({
    id: z.number().int(),
    run_id: z.number().int(),
    authority: z.string(),
    amount: Money,
    due_date: IsoDate,
    status: z.string().meta({ description: "Due or Remitted." }),
    remitted_at: z.string().nullable(),
    reference: z.string().nullable(),
  })
  .meta({ id: "Remittance" });
const OneOff = z
  .object({ id: z.number().int(), employee_id: z.number().int(), wage_type: z.string(), amount: Money, payment_date: IsoDate, paid_by_run_id: z.number().int().nullable(), created_at: z.string() })
  .meta({ id: "OneOffPayment" });
const Recurring = z
  .object({ id: z.number().int(), employee_id: z.number().int(), wage_type: z.string(), amount: Money, start_date: IsoDate, end_date: IsoDate.nullable(), created_at: z.string() })
  .meta({ id: "RecurringPayment" });

const m = (v: unknown) => money(Number(v))! as { amount: string; currency: "INR" };
const ackOf = (a: { state: string; reference: string | null; reason: string | null; updatedAt: string | null } | undefined) => ({
  state: (a?.state ?? "pending") as "pending" | "acknowledged" | "rejected",
  reference: a?.reference ?? null,
  reason: a?.reason ?? null,
  updated_at: a?.updatedAt ?? null,
});

async function idPage<T extends { id: number }>(ctx: ApiContext, sql: string, args: InValue[], map: (rs: Record<string, unknown>[]) => Promise<T[]> | T[]) {
  const q = ctx.query as { limit?: number; cursor?: string; fields?: string };
  const limit = q.limit ?? DEFAULT_LIMIT;
  const found = await rows(`${sql} AND id > ? ORDER BY id LIMIT ?`, [...args, decodeCursor(q.cursor), limit + 1]);
  const paged = page(await map(found), limit);
  return { body: { data: paged.data.map((r) => pickFields(r, q.fields)), next_cursor: paged.next_cursor } };
}

export async function glPostingReps(found: Record<string, unknown>[]) {
  const ids = found.map((p) => Number(p.id));
  if (ids.length === 0) return [];
  const [lines, acks] = await Promise.all([
    rows(`SELECT * FROM py_gl_posting_line WHERE posting_id IN (${ids.map(() => "?").join(", ")}) ORDER BY id`, ids),
    ackStates("gl_posting", ids),
  ]);
  return found.map((p) => {
    const mine = lines.filter((l) => Number(l.posting_id) === Number(p.id));
    return {
      id: Number(p.id),
      run_id: Number(p.run_id),
      posting_date: String(p.posting_date),
      posted_at: String(p.posted_at),
      total_debit: m(mine.reduce((t, l) => t + Number(l.debit_paise), 0)),
      total_credit: m(mine.reduce((t, l) => t + Number(l.credit_paise), 0)),
      lines: mine.map((l) => ({
        gl_account: String(l.gl_account),
        description: String(l.description),
        cost_centre: s(l.cost_center),
        debit: m(l.debit_paise),
        credit: m(l.credit_paise),
      })),
      acknowledgement: ackOf(acks.get(String(p.id))),
    };
  });
}

export async function paymentBatches(ctx: Pick<ApiContext, "has">, found: Record<string, unknown>[]) {
  const ids = found.map((f) => Number(f.id));
  if (ids.length === 0) return [];
  const lines = await rows(`SELECT * FROM py_bank_transfer_line WHERE file_id IN (${ids.map(() => "?").join(", ")}) ORDER BY id`, ids);
  return found.map((f) => {
    const mine = lines.filter((l) => Number(l.file_id) === Number(f.id));
    const count = (st: string) => mine.filter((l) => l.payment_status === st).length;
    return {
      id: Number(f.id),
      run_id: Number(f.run_id),
      payment_date: String(f.payment_date),
      format: String(f.format),
      line_count: Number(f.line_count),
      ...(ctx.has("pay:read") ? { total: m(f.total_paise) } : {}),
      paid: count("paid"),
      failed: count("failed"),
      pending: count("pending"),
      lines: mine.map((l) => ({
        employee_id: Number(l.employee_id),
        employee_name: String(l.employee_name),
        bank_name: String(l.bank_name),
        ...(ctx.has("bank:read") ? { account_number: String(l.account_number) } : {}),
        ifsc: s(l.ifsc),
        ...(ctx.has("pay:read") ? { amount: m(l.amount_paise) } : {}),
        payment_status: String(l.payment_status) as "pending" | "paid" | "failed",
        bank_reference: s(l.bank_reference),
        failure_reason: s(l.failure_reason),
      })),
    };
  });
}

export const remittanceOf = (r: Record<string, unknown>) => ({
  id: Number(r.id),
  run_id: Number(r.run_id),
  authority: String(r.authority),
  amount: m(r.amount_paise),
  due_date: String(r.due_date),
  status: String(r.status),
  remitted_at: s(r.remitted_at),
  reference: s(r.reference),
});

async function visibleRun(ctx: ApiContext, table: string, id: number): Promise<Record<string, unknown>> {
  const c = runClause(ctx, "run_id");
  const [row] = await rows(`SELECT * FROM ${table} WHERE id = ? AND ${c.sql}`, [id, ...c.args]);
  if (!row) throw notFound();
  return row;
}

async function requireErpOwnsPayments() {
  if ((await ownerOf("payment")) !== "erp") {
    throw new ApiError(409, "owned_by_hrms", "Payments are recorded by the HRMS here; ask HR to make the ERP their owner first.");
  }
}

async function employeeInScope(ctx: ApiContext, employeeId: number) {
  const companies = ctx.client.companies;
  const found = await rows(
    `SELECT 1 FROM pa_employee e WHERE e.id = ? ${
      companies ? `AND e.id IN (SELECT employee_id FROM pa_it0001_org_assignment WHERE company_code IN (${companies.map(() => "?").join(", ")}))` : ""
    }`,
    [employeeId, ...(companies ?? [])],
  );
  if (found.length === 0) throw invalid("There is no employee with that id that this client may see.");
}

export const payrollEndpoints: Endpoint[] = [
  {
    method: "GET",
    path: "/payroll/periods",
    tag: "Payroll",
    summary: "List payroll periods",
    scopes: ["payroll:read"],
    query: z.object({ ...PageQuery, status: z.enum(["Open", "Locked", "Posted"]).optional() }),
    response: pageSchema(Period),
    handler: (ctx) => {
      const a = areaClause(ctx, "area_code");
      const status = (ctx.query as { status?: string }).status;
      return idPage(ctx, `SELECT * FROM py_payroll_period WHERE ${a.sql} ${status ? "AND status = ?" : ""}`, [...a.args, ...(status ? [status] : [])], (rs) =>
        rs.map((r) => ({
          id: Number(r.id),
          personnel_area: String(r.area_code),
          year: Number(r.year),
          month: Number(r.month),
          pay_date: s(r.pay_date),
          status: String(r.status),
          posted_at: s(r.posted_at),
        })),
      );
    },
  },
  {
    method: "GET",
    path: "/payroll/runs",
    tag: "Payroll",
    summary: "List payroll runs",
    scopes: ["payroll:read"],
    optionalScopes: ["pay:read"],
    query: z.object({ ...PageQuery, period_id: z.coerce.number().int().optional() }),
    response: pageSchema(Run),
    handler: (ctx) => {
      const a = areaClause(ctx, "pp.area_code");
      const periodId = (ctx.query as { period_id?: number }).period_id;
      return idPage(
        ctx,
        `SELECT * FROM (SELECT r.* FROM py_payroll_run r JOIN py_payroll_period pp ON pp.id = r.period_id WHERE ${a.sql}) WHERE ${periodId ? "period_id = ?" : "1 = 1"}`,
        [...a.args, ...(periodId ? [periodId] : [])],
        (rs) =>
          rs.map((r) => ({
            id: Number(r.id),
            period_id: Number(r.period_id),
            run_type: String(r.run_type),
            status: String(r.status),
            reason: s(r.reason),
            pay_date: s(r.pay_date),
            employee_count: Number(r.employee_count),
            error_count: Number(r.error_count),
            ...(ctx.has("pay:read") ? { gross_total: m(r.gross_total_paise), net_total: m(r.net_total_paise) } : {}),
            completed_at: s(r.completed_at),
          })),
      );
    },
  },
  {
    method: "GET",
    path: "/payroll/runs/{id}/results",
    tag: "Payroll",
    summary: "The results of a run",
    description: "Each person's gross, net and every line — what their payslip shows — with the year to date. Needs pay:read. Each payslip's PDF is at /payroll/results/{id}/payslip.",
    scopes: ["payroll:read", "pay:read"],
    params: { id: "The run's id." },
    query: z.object(PageQuery),
    response: pageSchema(Result),
    handler: async (ctx) => {
      const a = areaClause(ctx, "pp.area_code");
      const [run] = await rows(
        `SELECT r.* FROM py_payroll_run r JOIN py_payroll_period pp ON pp.id = r.period_id WHERE r.id = ? AND ${a.sql}`,
        [Number(ctx.params.id), ...a.args],
      );
      if (!run) throw notFound();
      return idPage(ctx, "SELECT * FROM py_payroll_result WHERE run_id = ?", [Number(run.id)], async (rs) => {
        const ids = rs.map((r) => Number(r.id));
        const ytd = await ytdForRun(Number(run.id), ids);
        const lines = ids.length
          ? await rows(`SELECT * FROM py_payroll_result_line WHERE result_id IN (${ids.map(() => "?").join(", ")}) ORDER BY sort_order`, ids)
          : [];
        for (const r of rs) await logApiAccess(ctx, { subjectEmployeeId: Number(r.employee_id), resource: "Payroll result through the API", resourceId: Number(r.id) });
        return rs.map((r) => ({
          id: Number(r.id),
          run_id: Number(r.run_id),
          employee_id: Number(r.employee_id),
          status: String(r.status),
          gross: m(r.gross_paise),
          net: m(r.net_paise),
          lines: lines
            .filter((l) => Number(l.result_id) === Number(r.id))
            .map((l) => ({ wage_type: String(l.wage_type_code), name: String(l.wage_type_name), kind: String(l.kind), amount: m(l.amount_paise) })),
          published_at: s(r.published_at),
          year_to_date: (() => {
            const y = ytd.byResult.get(Number(r.id));
            return {
              financial_year: ytd.financialYear,
              gross: m(y?.grossPaise ?? 0),
              deductions: m(y?.deductionsPaise ?? 0),
              net: m(y?.netPaise ?? 0),
              lines: [...(y?.lines ?? new Map<string, number>()).entries()].map(([wage_type, amount]) => ({ wage_type, amount: m(amount) })),
            };
          })(),
        }));
      });
    },
  },
  {
    method: "GET",
    path: "/payroll/results/{id}/payslip",
    tag: "Payroll",
    summary: "A payslip as a PDF",
    description:
      "One person's payslip as the PDF they would download, with the year to date — for the ERP's own portal to show. Not password-protected: show it only to that person. Needs pay:read.",
    scopes: ["payroll:read", "pay:read"],
    params: { id: "The payroll result's id, from the run's results." },
    produces: "application/pdf",
    response: z.string().meta({ description: "The PDF." }),
    handler: async (ctx) => {
      const r = runClause(ctx, "run_id");
      const [row] = await rows(`SELECT id, employee_id FROM py_payroll_result WHERE id = ? AND ${r.sql}`, [Number(ctx.params.id), ...r.args]);
      if (!row) throw notFound();
      const p = await getPayslip(Number(row.id));
      if (!p) throw notFound();
      await logApiAccess(ctx, { subjectEmployeeId: p.employeeId, resource: "Payslip PDF through the API", resourceId: p.resultId });
      return { file: { bytes: await renderPayslipPdf(p), contentType: "application/pdf", fileName: payslipFileName(p) } };
    },
  },
  {
    method: "GET",
    path: "/gl-postings",
    tag: "Payroll journal",
    summary: "List payroll journals",
    description:
      "Each run's journal, balanced, by account and cost centre, with its acknowledgement state. Poll with `ack_state=pending` to find journals still to book, or listen for `gl.posting.created`.",
    scopes: ["gl:read"],
    query: z.object({ ...PageQuery, ack_state: z.enum(["pending", "acknowledged", "rejected"]).optional() }),
    response: pageSchema(GlPosting),
    handler: (ctx) => {
      const c = runClause(ctx, "run_id");
      const state = (ctx.query as { ack_state?: string }).ack_state;
      const stateSql =
        state === undefined
          ? "1 = 1"
          : state === "pending"
            ? "id NOT IN (SELECT CAST(entity_id AS INTEGER) FROM int_ack WHERE entity = 'gl_posting' AND state <> 'pending')"
            : "id IN (SELECT CAST(entity_id AS INTEGER) FROM int_ack WHERE entity = 'gl_posting' AND state = ?)";
      return idPage(ctx, `SELECT * FROM py_gl_posting WHERE ${c.sql} AND ${stateSql}`, [...c.args, ...(state && state !== "pending" ? [state] : [])], glPostingReps);
    },
  },
  {
    method: "POST",
    path: "/gl-postings/{id}/acknowledgement",
    tag: "Payroll journal",
    summary: "Acknowledge or reject a journal",
    description:
      "Tells the HRMS the journal was booked, with your document number — or refused, with the reason. HR sees it on the posting screen: \"Booked in the ERP as JV/2026/0912\". Optionally send the totals you booked; the reconciliation report compares them with ours.",
    scopes: ["gl:write"],
    params: { id: "The journal's id." },
    body: z.object({
      status: z.enum(["acknowledged", "rejected"]),
      reference: z.string().nullable().default(null),
      reason: z.string().nullable().default(null),
      totals: z.object({ debit: Money, credit: Money }).nullable().default(null),
    }),
    response: Ack,
    idempotent: true,
    example: {
      path: "/gl-postings/12/acknowledgement",
      body: { status: "acknowledged", reference: "JV/2026/0912", totals: { debit: { amount: "412500.00", currency: "INR" }, credit: { amount: "412500.00", currency: "INR" } } },
    },
    handler: async (ctx) => {
      const posting = await visibleRun(ctx, "py_gl_posting", Number(ctx.params.id));
      const b = ctx.body as { status: "acknowledged" | "rejected"; reference: string | null; reason: string | null; totals: { debit: { amount: string }; credit: { amount: string } } | null };
      const saved = await acknowledge(ctx.actor, "gl_posting", Number(posting.id), {
        status: b.status,
        reference: b.reference,
        reason: b.reason,
        totals: b.totals ? { debit: b.totals.debit.amount, credit: b.totals.credit.amount } : null,
      });
      if (!saved.ok) throw invalid(saved.error);
      return { body: ackOf(saved.value) };
    },
  },
  {
    method: "GET",
    path: "/payment-batches",
    tag: "Payments",
    summary: "List payment batches",
    description: "The salaries of each run for the ERP to pay. Amounts need pay:read and account numbers bank:read. Filter with `state=pending` for batches with anything still unconfirmed.",
    scopes: ["payroll:read"],
    optionalScopes: ["pay:read", "bank:read"],
    query: z.object({ ...PageQuery, state: z.enum(["pending", "complete"]).optional() }),
    response: pageSchema(PaymentBatch),
    handler: (ctx) => {
      const c = runClause(ctx, "run_id");
      const state = (ctx.query as { state?: string }).state;
      const pendingSql = "EXISTS (SELECT 1 FROM py_bank_transfer_line l WHERE l.file_id = py_bank_transfer_file.id AND l.payment_status = 'pending')";
      return idPage(
        ctx,
        `SELECT * FROM py_bank_transfer_file WHERE ${c.sql} ${state === "pending" ? `AND ${pendingSql}` : state === "complete" ? `AND NOT ${pendingSql}` : ""}`,
        c.args,
        (rs) => paymentBatches(ctx, rs),
      );
    },
  },
  {
    method: "POST",
    path: "/payment-batches/{id}/confirmations",
    tag: "Payments",
    summary: "Confirm salary payments",
    description:
      "Marks each person's salary paid (with the bank's reference) or failed (with the reason). Items for people not in the batch are not applied: they come back as `not_in_batch` and open a sync issue for HR. Confirming the same item twice changes nothing.",
    scopes: ["payroll:write"],
    params: { id: "The payment batch's id." },
    body: z.object({
      items: z
        .array(
          z.object({
            employee_id: z.number().int(),
            status: z.enum(["paid", "failed"]),
            reference: z.string().nullable().optional(),
            reason: z.string().nullable().optional(),
            paid_on: IsoDate.nullable().optional(),
          }),
        )
        .min(1),
    }),
    response: z.object({
      outcomes: z.array(z.object({ employee_id: z.number().int(), outcome: z.enum(["applied", "unchanged", "not_in_batch"]), issue_id: z.number().int().optional() })),
      paid: z.number().int(),
      failed: z.number().int(),
      pending: z.number().int(),
    }),
    idempotent: true,
    example: { path: "/payment-batches/7/confirmations", body: { items: [{ employee_id: 3, status: "paid", reference: "UTR2610050012", paid_on: "2026-10-01" }] } },
    handler: async (ctx) => {
      await requireErpOwnsPayments();
      const batch = await visibleRun(ctx, "py_bank_transfer_file", Number(ctx.params.id));
      const saved = await confirmPayments(ctx.actor, Number(batch.id), (ctx.body as { items: Parameters<typeof confirmPayments>[2] }).items);
      if (!saved.ok) throw invalid(saved.error);
      return { body: saved.value };
    },
  },
  {
    method: "GET",
    path: "/remittances",
    tag: "Payments",
    summary: "List statutory remittances",
    description: "Provident fund and TDS owed to each authority from each run, with their due dates.",
    scopes: ["payroll:read"],
    query: z.object({ ...PageQuery, status: z.enum(["Due", "Remitted"]).optional() }),
    response: pageSchema(Remittance),
    handler: (ctx) => {
      const c = runClause(ctx, "run_id");
      const status = (ctx.query as { status?: string }).status;
      return idPage(ctx, `SELECT * FROM py_statutory_remittance WHERE ${c.sql} ${status ? "AND status = ?" : ""}`, [...c.args, ...(status ? [status] : [])], (rs) => rs.map(remittanceOf));
    },
  },
  {
    method: "POST",
    path: "/remittances/{id}/payment",
    tag: "Payments",
    summary: "Record a remittance as paid",
    scopes: ["payroll:write"],
    params: { id: "The remittance's id." },
    body: z.object({ reference: z.string().min(1).meta({ description: "The challan or bank reference." }), paid_on: IsoDate.nullable().default(null) }),
    response: Remittance,
    idempotent: true,
    example: { path: "/remittances/4/payment", body: { reference: "CIN 0510026120900012", paid_on: "2026-10-07" } },
    handler: async (ctx) => {
      await requireErpOwnsPayments();
      const remittance = await visibleRun(ctx, "py_statutory_remittance", Number(ctx.params.id));
      const b = ctx.body as { reference: string; paid_on: string | null };
      const saved = await recordRemittancePayment(ctx.actor, Number(remittance.id), { reference: b.reference, paidOn: b.paid_on });
      if (!saved.ok) throw invalid(saved.error);
      return { body: remittanceOf(saved.value) };
    },
  },
  {
    method: "GET",
    path: "/one-off-payments",
    tag: "Payments",
    summary: "List one-off payments",
    scopes: ["payroll:read", "pay:read"],
    query: z.object({ ...PageQuery, employee_id: z.coerce.number().int().optional() }),
    response: pageSchema(OneOff),
    handler: (ctx) => {
      const e = (ctx.query as { employee_id?: number }).employee_id;
      return idPage(ctx, `SELECT * FROM py_it0015_additional_payment WHERE ${e ? "employee_id = ?" : "1 = 1"}`, e ? [e] : [], (rs) =>
        rs.map((r) => ({
          id: Number(r.id),
          employee_id: Number(r.employee_id),
          wage_type: String(r.wage_type_code),
          amount: m(r.amount_paise),
          payment_date: String(r.payment_date),
          paid_by_run_id: r.paid_run_id === null ? null : Number(r.paid_run_id),
          created_at: String(r.created_at),
        })),
      );
    },
  },
  {
    method: "POST",
    path: "/one-off-payments",
    tag: "Payments",
    summary: "Send a one-off payment",
    description:
      "An earning or deduction that starts in the ERP — a sales incentive, a canteen recovery — paid once by the next run of its month, or by an off-cycle run. Send an Idempotency-Key: a retry must not pay twice.",
    scopes: ["payroll:write"],
    body: z.object({ employee_id: z.number().int(), wage_type: z.string().min(1), amount: Money, payment_date: IsoDate }),
    response: OneOff,
    status: 201,
    idempotent: true,
    example: { body: { employee_id: 3, wage_type: "BONUS", amount: { amount: "15000.00", currency: "INR" }, payment_date: "2026-10-31" } },
    handler: async (ctx) => {
      const b = ctx.body as { employee_id: number; wage_type: string; amount: { amount: string }; payment_date: string };
      await employeeInScope(ctx, b.employee_id);
      const saved = await addOneOffPayment(ctx.actor, { employeeId: b.employee_id, wageTypeCode: b.wage_type, amountPaise: toPaiseExact(b.amount), paymentDate: b.payment_date });
      if (!saved.ok) throw invalid(saved.error);
      const r = saved.value;
      return {
        status: 201,
        body: { id: Number(r.id), employee_id: Number(r.employee_id), wage_type: String(r.wage_type_code), amount: m(r.amount_paise), payment_date: String(r.payment_date), paid_by_run_id: null, created_at: String(r.created_at) },
      };
    },
  },
  {
    method: "GET",
    path: "/recurring-payments",
    tag: "Payments",
    summary: "List recurring payments",
    scopes: ["payroll:read", "pay:read"],
    query: z.object({ ...PageQuery, employee_id: z.coerce.number().int().optional() }),
    response: pageSchema(Recurring),
    handler: (ctx) => {
      const e = (ctx.query as { employee_id?: number }).employee_id;
      return idPage(ctx, `SELECT * FROM py_it0014_recurring_payment WHERE ${e ? "employee_id = ?" : "1 = 1"}`, e ? [e] : [], (rs) =>
        rs.map((r) => ({
          id: Number(r.id),
          employee_id: Number(r.employee_id),
          wage_type: String(r.wage_type_code),
          amount: m(r.amount_paise),
          start_date: String(r.start_date),
          end_date: until(s(r.end_date)),
          created_at: String(r.created_at),
        })),
      );
    },
  },
  {
    method: "POST",
    path: "/recurring-payments",
    tag: "Payments",
    summary: "Send a recurring payment",
    description: "An earning or deduction paid every month between two dates; `end_date` null for open-ended. Send an Idempotency-Key.",
    scopes: ["payroll:write"],
    body: z.object({ employee_id: z.number().int(), wage_type: z.string().min(1), amount: Money, start_date: IsoDate, end_date: IsoDate.nullable().default(null) }),
    response: Recurring,
    status: 201,
    idempotent: true,
    example: { body: { employee_id: 3, wage_type: "CANTEEN", amount: { amount: "1200.00", currency: "INR" }, start_date: "2026-10-01", end_date: null } },
    handler: async (ctx) => {
      const b = ctx.body as { employee_id: number; wage_type: string; amount: { amount: string }; start_date: string; end_date: string | null };
      await employeeInScope(ctx, b.employee_id);
      const saved = await addRecurringPayment(ctx.actor, {
        employeeId: b.employee_id,
        wageTypeCode: b.wage_type,
        amountPaise: toPaiseExact(b.amount),
        startDate: b.start_date,
        endDate: b.end_date ?? OPEN_ENDED,
      });
      if (!saved.ok) throw invalid(saved.error);
      const r = saved.value;
      return {
        status: 201,
        body: { id: Number(r.id), employee_id: Number(r.employee_id), wage_type: String(r.wage_type_code), amount: m(r.amount_paise), start_date: String(r.start_date), end_date: until(s(r.end_date)), created_at: String(r.created_at) },
      };
    },
  },
];
