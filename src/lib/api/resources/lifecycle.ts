import "server-only";
import { z } from "zod";
import type { InValue } from "@libsql/client";
import { rawClient } from "@/lib/db";
import { todayInIndia } from "@/lib/dates";
import { changeStatement } from "@/lib/change-log";
import { transferEmployee, promoteEmployee } from "@/lib/services/actions";
import { confirmProbation, extendProbation, endProbation } from "@/lib/services/monitoring";
import { completeChecklistIfDone } from "@/lib/services/checklist";
import { renderIssuedLetter } from "@/lib/services/letters";
import { DEFAULT_LIMIT, IsoDate, Money, PageQuery, decodeCursor, etagOf, page, pageSchema, pickFields, toPaiseExact } from "../format";
import { ApiError, invalid, notFound } from "../problem";
import { logApiAccess, type ApiContext, type Endpoint } from "../router";
import { companyClause, loadEmployees, resolveEmployee } from "./employees";

/**
 * Guided actions on an employee's record — transfer, promotion, a probation
 * decision — plus the onboarding tasks and letters they lead to. Each action
 * runs through the same service the screens call, so an API caller cannot
 * do anything a screen could not.
 */

const rows = async (sql: string, args: InValue[] = []) => (await rawClient().execute({ sql, args })).rows as unknown as Record<string, unknown>[];
const scopesFor = (ctx: ApiContext) => ({ pay: ctx.has("pay:read"), bank: ctx.has("bank:read") });

/** Whether an employee (found by a join already keyed on their id) falls in the client's companies. */
async function employeeInScope(ctx: ApiContext, employeeId: number): Promise<boolean> {
  if (!ctx.client.companies) return true;
  const c = companyClause(ctx, "o.company_code");
  const r = await rows(
    `SELECT 1 FROM pa_it0001_org_assignment o WHERE o.employee_id = ? AND ${c.sql} ORDER BY o.valid_from DESC LIMIT 1`,
    [employeeId, ...c.args],
  );
  return r.length > 0;
}

/* -------------------------------------------------------------- actions */

const TransferAction = z.object({
  action: z.literal("transfer"),
  effective_date: IsoDate,
  company: z.string().min(1),
  personnel_area: z.string().nullable().default(null),
  department: z.string().min(1),
  position: z.string().min(1),
  cost_centre: z.string().nullable().default(null),
  reason: z.string().nullable().default(null),
});

const PromotionAction = z.object({
  action: z.literal("promotion"),
  effective_date: IsoDate,
  position: z.string().min(1),
  pay_scale_group: z.string().nullable().default(null),
  basic_pay: Money,
  reason: z.string().nullable().default(null),
});

const ConfirmationAction = z.object({
  action: z.literal("confirmation"),
  outcome: z.enum(["confirm", "extend", "end"]),
  new_date: IsoDate.nullable().default(null).meta({ description: "The pushed-back review date. Required when outcome is extend." }),
  effective_date: IsoDate.nullable().default(null).meta({ description: "The last working day. Required when outcome is end." }),
  note: z.string().nullable().default(null),
});

const ActionBody = z
  .discriminatedUnion("action", [TransferAction, PromotionAction, ConfirmationAction])
  .meta({ id: "EmployeeActionRequest" });

/* ---------------------------------------------------------------- tasks */

const Task = z
  .object({
    id: z.number().int(),
    employee_id: z.number().int(),
    task: z.string(),
    owner_type: z.string(),
    due_date: IsoDate,
    status: z.enum(["Pending", "Done"]),
    done_at: z.string().nullable(),
  })
  .meta({ id: "Task" });

function taskRep(r: Record<string, unknown>): z.infer<typeof Task> {
  return {
    id: Number(r.id),
    employee_id: Number(r.employee_id),
    task: String(r.task),
    owner_type: String(r.owner_type),
    due_date: String(r.due_date),
    status: String(r.status) as "Pending" | "Done",
    done_at: r.done_at === null ? null : String(r.done_at),
  };
}

/* -------------------------------------------------------------- letters */

const Letter = z
  .object({
    id: z.number().int(),
    employee_id: z.number().int(),
    kind: z.string(),
    issue_date: IsoDate,
    issued_by: z.string(),
    issued_at: z.string(),
  })
  .meta({ id: "Letter" });

function letterRep(r: Record<string, unknown>): z.infer<typeof Letter> {
  return {
    id: Number(r.id),
    employee_id: Number(r.employee_id),
    kind: String(r.kind),
    issue_date: String(r.issue_date),
    issued_by: String(r.issued_by),
    issued_at: String(r.issued_at),
  };
}

export const lifecycleEndpoints: Endpoint[] = [
  {
    method: "POST",
    path: "/employees/{id}/actions",
    tag: "People",
    summary: "Transfer, promote, or decide a probation review",
    description:
      "The same guided actions the Career screen offers: moving someone to a new position (`transfer`), moving them up with new pay (`promotion`), or deciding a pending probation review (`confirmation`, with `outcome` confirm, extend or end). A transfer or promotion arrives as `employee.transferred` or `employee.promoted`; a confirmation as `employee.confirmed`, or as `employee.status_changed` if the outcome ends the employment. A promotion needs pay:read.",
    scopes: ["employees:write"],
    optionalScopes: ["pay:read", "bank:read"],
    params: { id: "The employee's id." },
    body: ActionBody,
    response: z.record(z.string(), z.unknown()).meta({ description: "The employee, as GET /employees/{id} returns it." }),
    etag: true,
    idempotent: true,
    example: {
      path: "/employees/3/actions",
      body: { action: "transfer", effective_date: "2026-11-01", company: "CO01", department: "OU0003", position: "PS0007" },
    },
    handler: async (ctx) => {
      const id = await resolveEmployee(ctx, ctx.params.id);
      const b = ctx.body as z.infer<typeof ActionBody>;
      const actorName = `${ctx.client.name} (API)`;

      if (b.action === "transfer") {
        if (ctx.client.companies && !ctx.client.companies.includes(b.company)) {
          throw invalid(`This client may not transfer into ${b.company}.`);
        }
        const r = await transferEmployee(
          ctx.actor,
          { employeeId: id, effectiveDate: b.effective_date, companyCode: b.company, areaCode: b.personnel_area, orgUnitCode: b.department, positionCode: b.position, costCenter: b.cost_centre, reason: b.reason },
          actorName,
        );
        if (!r.ok) throw r.code === "conflict" ? new ApiError(409, "conflict", r.error) : invalid(r.error);
      } else if (b.action === "promotion") {
        if (!ctx.has("pay:read")) throw new ApiError(403, "insufficient_scope", "A promotion needs the pay:read scope.");
        const r = await promoteEmployee(
          ctx.actor,
          { employeeId: id, effectiveDate: b.effective_date, positionCode: b.position, payScaleGroup: b.pay_scale_group, amountPaise: toPaiseExact(b.basic_pay), currency: b.basic_pay.currency, reason: b.reason },
          actorName,
        );
        if (!r.ok) throw r.code === "conflict" ? new ApiError(409, "conflict", r.error) : invalid(r.error);
      } else {
        const pending = (
          await rows(
            "SELECT id FROM pa_it0019_monitoring WHERE employee_id = ? AND monitoring_type = 'Probation review' AND status = 'Pending' ORDER BY date DESC LIMIT 1",
            [id],
          )
        )[0];
        if (!pending) throw invalid("There is no pending probation review for this employee.");
        const monitoringId = Number(pending.id);
        if (b.outcome === "confirm") {
          const r = await confirmProbation(ctx.actor, monitoringId, b.note, actorName);
          if (!r.ok) throw invalid(r.error);
        } else if (b.outcome === "extend") {
          if (!b.new_date) throw invalid("Extending a review needs new_date.");
          const r = await extendProbation(ctx.actor, monitoringId, b.new_date, b.note, actorName);
          if (!r.ok) throw invalid(r.error);
        } else {
          if (!b.effective_date) throw invalid("Ending employment needs effective_date.");
          const r = await endProbation(ctx.actor, monitoringId, b.effective_date, b.note, actorName);
          if (!r.ok) throw invalid(r.error);
        }
      }
      const [rep] = await loadEmployees([id], todayInIndia(), scopesFor(ctx));
      return { body: rep, headers: { ETag: etagOf(rep) } };
    },
  },
  {
    method: "GET",
    path: "/tasks",
    tag: "People",
    summary: "List onboarding tasks",
    description: "Tasks from onboarding checklists, oldest due first. Filter with `employee_id` and `status`.",
    scopes: ["employees:read"],
    query: z.object({ ...PageQuery, employee_id: z.coerce.number().int().optional(), status: z.enum(["Pending", "Done"]).optional() }),
    response: pageSchema(Task),
    handler: async (ctx) => {
      const q = ctx.query as { limit?: number; cursor?: string; fields?: string; employee_id?: number; status?: string };
      const limit = q.limit ?? DEFAULT_LIMIT;
      const where = ["t.id > ?"];
      const args: InValue[] = [decodeCursor(q.cursor)];
      if (q.employee_id) {
        where.push("c.employee_id = ?");
        args.push(q.employee_id);
      }
      if (q.status) {
        where.push("t.status = ?");
        args.push(q.status);
      }
      if (ctx.client.companies) {
        const cl = companyClause(ctx, "o.company_code");
        where.push(`c.employee_id IN (SELECT o.employee_id FROM pa_it0001_org_assignment o WHERE ${cl.sql})`);
        args.push(...cl.args);
      }
      const found = await rows(
        `SELECT t.*, c.employee_id FROM pa_task t JOIN pa_checklist c ON c.id = t.checklist_id
         WHERE ${where.join(" AND ")} ORDER BY t.id LIMIT ?`,
        [...args, limit + 1],
      );
      const paged = page(found.map(taskRep), limit);
      return { body: { data: paged.data.map((r) => pickFields(r, q.fields)), next_cursor: paged.next_cursor } };
    },
  },
  {
    method: "POST",
    path: "/tasks/{id}/complete",
    tag: "People",
    summary: "Mark an onboarding task done",
    description: "Marks one task done, as its assignee would. Once every task in the checklist is done, it finishes and `onboarding.completed` fires. Safe to call again on a task already done.",
    scopes: ["employees:write"],
    params: { id: "The task's id." },
    response: Task,
    idempotent: true,
    handler: async (ctx) => {
      const id = Number(ctx.params.id);
      const row = (
        await rows("SELECT t.*, c.employee_id FROM pa_task t JOIN pa_checklist c ON c.id = t.checklist_id WHERE t.id = ?", [id])
      )[0];
      if (!row || !(await employeeInScope(ctx, Number(row.employee_id)))) throw notFound();
      if (String(row.status) === "Done") return { body: taskRep(row) };

      const at = new Date().toISOString();
      await rawClient().execute({ sql: "UPDATE pa_task SET status = 'Done', done_at = ? WHERE id = ? AND status = 'Pending'", args: [at, id] });
      const logged = changeStatement(ctx.actor, {
        entity: "pa_task",
        entityId: id,
        subjectEmployeeId: Number(row.employee_id),
        action: "update",
        before: { status: "Pending" },
        after: { status: "Done" },
      });
      if (logged) await rawClient().execute(logged);
      await completeChecklistIfDone(rawClient(), ctx.actor, Number(row.checklist_id));
      const [fresh] = await rows("SELECT t.*, c.employee_id FROM pa_task t JOIN pa_checklist c ON c.id = t.checklist_id WHERE t.id = ?", [id]);
      return { body: taskRep(fresh) };
    },
  },
  {
    method: "GET",
    path: "/letters",
    tag: "People",
    summary: "List issued letters",
    description: "Letters issued from a template — appointment, experience, relieving, and so on — newest first. Filter with `employee_id`. The PDF is at `GET /letters/{id}/pdf`.",
    scopes: ["employees:read"],
    query: z.object({ ...PageQuery, employee_id: z.coerce.number().int().optional() }),
    response: pageSchema(Letter),
    handler: async (ctx) => {
      const q = ctx.query as { limit?: number; cursor?: string; fields?: string; employee_id?: number };
      const limit = q.limit ?? DEFAULT_LIMIT;
      const where = ["l.id > ?"];
      const args: InValue[] = [decodeCursor(q.cursor)];
      if (q.employee_id) {
        where.push("l.employee_id = ?");
        args.push(q.employee_id);
      }
      if (ctx.client.companies) {
        const cl = companyClause(ctx, "o.company_code");
        where.push(`l.employee_id IN (SELECT o.employee_id FROM pa_it0001_org_assignment o WHERE ${cl.sql})`);
        args.push(...cl.args);
      }
      const found = await rows(`SELECT l.* FROM pa_letter l WHERE ${where.join(" AND ")} ORDER BY l.id LIMIT ?`, [...args, limit + 1]);
      const paged = page(found.map(letterRep), limit);
      return { body: { data: paged.data.map((r) => pickFields(r, q.fields)), next_cursor: paged.next_cursor } };
    },
  },
  {
    method: "GET",
    path: "/letters/{id}/pdf",
    tag: "People",
    summary: "A letter as a PDF",
    description: "One letter as the PDF issued, re-rendered from the text it was issued with — never from the template, which may have moved on since.",
    scopes: ["employees:read"],
    params: { id: "The letter's id." },
    produces: "application/pdf",
    response: z.string().meta({ description: "The PDF." }),
    handler: async (ctx) => {
      const id = Number(ctx.params.id);
      const row = (await rows("SELECT * FROM pa_letter WHERE id = ?", [id]))[0];
      if (!row || !(await employeeInScope(ctx, Number(row.employee_id)))) throw notFound();
      await logApiAccess(ctx, { subjectEmployeeId: Number(row.employee_id), resource: "Letter PDF through the API", resourceId: id });
      const pdf = await renderIssuedLetter({
        employeeId: Number(row.employee_id),
        kind: String(row.kind),
        issueDate: String(row.issue_date),
        mergedText: String(row.merged_text),
      });
      const fileName = `${String(row.kind).toLowerCase().replace(/\s+/g, "-")}-letter-${id}.pdf`;
      return { file: { bytes: pdf, contentType: "application/pdf", fileName } };
    },
  },
];
