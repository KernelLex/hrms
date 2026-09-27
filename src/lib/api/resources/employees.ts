import "server-only";
import { z } from "zod";
import type { InValue } from "@libsql/client";
import { rawClient } from "@/lib/db";
import { todayInIndia } from "@/lib/dates";
import { hire, updateEmployeeFields, EMPLOYEE_FIELDS, type EmployeeField } from "@/lib/services/people";
import { externalIdsFor, findByExternalId, ownerOf, setExternalId } from "@/lib/services/integration";
import { IsoDate, Money, DEFAULT_LIMIT, PageQuery, decodeCursor, etagOf, money, page, pageSchema, pickFields, toPaiseExact, until } from "../format";
import { ApiError, invalid, notFound } from "../problem";
import { checkIfMatch, logApiAccess, type ApiContext, type Endpoint } from "../router";

/**
 * Employees: the record as it stood on a date, their dated history, the hire
 * action, and the fields the ERP may own.
 */

const Department = z.object({ code: z.string(), name: z.string().nullable() });
const Position = z.object({ code: z.string(), title: z.string().nullable() });

export const EmployeeSchema = z
  .object({
    id: z.number().int(),
    employee_number: z.string(),
    status: z.string().meta({ description: "Active, On leave or Terminated." }),
    hire_date: IsoDate,
    termination_date: IsoDate.nullable(),
    personal: z
      .object({
        first_name: z.string().nullable(),
        last_name: z.string().nullable(),
        date_of_birth: IsoDate.nullable(),
        gender: z.string().nullable(),
      })
      .nullable(),
    org_assignment: z
      .object({
        company: z.string().nullable(),
        personnel_area: z.string().nullable(),
        department: Department.nullable(),
        position: Position.nullable(),
        cost_centre: z.string().nullable(),
        valid_from: IsoDate,
        valid_to: IsoDate.nullable(),
      })
      .nullable(),
    working_time: z.object({ work_schedule: z.string().nullable(), weekly_hours: z.number().nullable() }).nullable(),
    work_email: z.string().nullable(),
    basic_pay: z
      .object({ amount: Money, pay_scale_group: z.string().nullable(), valid_from: IsoDate, valid_to: IsoDate.nullable() })
      .nullable()
      .optional()
      .meta({ description: "Present only with the pay:read scope." }),
    bank_account: z
      .object({ bank_name: z.string(), account_number: z.string(), ifsc: z.string().nullable(), holder_name: z.string().nullable() })
      .nullable()
      .optional()
      .meta({ description: "Present only with the bank:read scope." }),
    external_ids: z.record(z.string(), z.string()).meta({ description: "Other systems' ids for this employee: {\"erp\": \"EMP-0042\"}." }),
    updated_at: z.string().nullable().meta({ description: "When anything about this employee last changed." }),
  })
  .meta({ id: "Employee" });

export type EmployeeRep = z.infer<typeof EmployeeSchema>;

const rows = async (sql: string, args: InValue[]) => (await rawClient().execute({ sql, args })).rows as unknown as Record<string, unknown>[];
const s = (v: unknown) => (v === null || v === undefined ? null : String(v));
const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));

/** Employees as the API returns them, as of a date, with fields the scopes allow. */
export async function loadEmployees(ids: number[], asOf: string, opts: { pay: boolean; bank: boolean }): Promise<EmployeeRep[]> {
  if (ids.length === 0) return [];
  const marks = ids.map(() => "?").join(", ");
  const [base, extIds, changed] = await Promise.all([
    rows(
      `SELECT e.id, e.employee_number, e.employment_status, e.hire_date, e.termination_date,
              p.first_name, p.last_name, p.date_of_birth, p.gender,
              o.company_code, o.area_code, o.org_unit_code, ou.name AS org_unit_name, o.position_code,
              pos.title AS position_title, o.cost_center, o.valid_from AS o_from, o.valid_to AS o_to,
              w.work_schedule_code, w.weekly_hours,
              bp.amount_paise, bp.currency, bp.pay_scale_group, bp.valid_from AS bp_from, bp.valid_to AS bp_to,
              b.bank_name, b.account_number, b.ifsc, b.holder_name,
              (SELECT c.value FROM pa_it0105_communication c WHERE c.employee_id = e.id AND c.comm_type = 'Email (official)'
                 AND c.valid_from <= ?1 AND c.valid_to >= ?1 ORDER BY c.valid_from DESC LIMIT 1) AS work_email
       FROM pa_employee e
       LEFT JOIN pa_it0002_personal_data p ON p.employee_id = e.id AND p.valid_from <= ?1 AND p.valid_to >= ?1
       LEFT JOIN pa_it0001_org_assignment o ON o.employee_id = e.id AND o.valid_from <= ?1 AND o.valid_to >= ?1
       LEFT JOIN om_org_unit ou ON ou.code = o.org_unit_code
       LEFT JOIN om_position pos ON pos.code = o.position_code
       LEFT JOIN pa_it0007_planned_working_time w ON w.employee_id = e.id AND w.valid_from <= ?1 AND w.valid_to >= ?1
       LEFT JOIN pa_it0008_basic_pay bp ON bp.employee_id = e.id AND bp.valid_from <= ?1 AND bp.valid_to >= ?1
       LEFT JOIN pa_it0009_bank_details b ON b.employee_id = e.id AND b.valid_from <= ?1 AND b.valid_to >= ?1
       WHERE e.id IN (${ids.map((_, i) => `?${i + 2}`).join(", ")})
       ORDER BY e.id`,
      [asOf, ...ids],
    ),
    externalIdsFor("employee", ids),
    rows(
      `SELECT subject_employee_id AS id, MAX(at) AS at FROM app_change_log
       WHERE subject_employee_id IN (${marks}) GROUP BY subject_employee_id`,
      ids,
    ),
  ]);
  const changedAt = new Map(changed.map((c) => [Number(c.id), String(c.at)]));
  return base.map((r) => {
    const rep: EmployeeRep = {
      id: Number(r.id),
      employee_number: String(r.employee_number),
      status: String(r.employment_status),
      hire_date: String(r.hire_date),
      termination_date: s(r.termination_date),
      personal:
        r.first_name === null && r.last_name === null
          ? null
          : { first_name: s(r.first_name), last_name: s(r.last_name), date_of_birth: s(r.date_of_birth), gender: s(r.gender) },
      org_assignment:
        r.o_from === null
          ? null
          : {
              company: s(r.company_code),
              personnel_area: s(r.area_code),
              department: r.org_unit_code === null ? null : { code: String(r.org_unit_code), name: s(r.org_unit_name) },
              position: r.position_code === null ? null : { code: String(r.position_code), title: s(r.position_title) },
              cost_centre: s(r.cost_center),
              valid_from: String(r.o_from),
              valid_to: until(s(r.o_to)),
            },
      working_time: r.work_schedule_code === null ? null : { work_schedule: s(r.work_schedule_code), weekly_hours: n(r.weekly_hours) },
      work_email: s(r.work_email),
      external_ids: extIds.get(String(r.id)) ?? {},
      updated_at: changedAt.get(Number(r.id)) ?? null,
    };
    if (opts.pay) {
      rep.basic_pay =
        r.amount_paise === null
          ? null
          : {
              amount: money(Number(r.amount_paise), s(r.currency) ?? "INR")! as { amount: string; currency: "INR" },
              pay_scale_group: s(r.pay_scale_group),
              valid_from: String(r.bp_from),
              valid_to: until(s(r.bp_to)),
            };
    }
    if (opts.bank) {
      rep.bank_account =
        r.account_number === null
          ? null
          : { bank_name: String(r.bank_name), account_number: String(r.account_number), ifsc: s(r.ifsc), holder_name: s(r.holder_name) };
    }
    return rep;
  });
}

/** Limits to the companies a client may see. `alias` is an org assignment. */
export function companyClause(ctx: ApiContext, column: string): { sql: string; args: string[] } {
  const companies = ctx.client.companies;
  if (!companies) return { sql: "1 = 1", args: [] };
  return { sql: `${column} IN (${companies.map(() => "?").join(", ")})`, args: companies };
}

async function employeeVisible(ctx: ApiContext, id: number): Promise<boolean> {
  const c = companyClause(ctx, "o.company_code");
  const r = await rows(
    `SELECT e.id FROM pa_employee e
     LEFT JOIN pa_it0001_org_assignment o ON o.employee_id = e.id AND o.id = (
       SELECT id FROM pa_it0001_org_assignment WHERE employee_id = e.id ORDER BY valid_from DESC LIMIT 1)
     WHERE e.id = ? AND (${ctx.client.companies ? c.sql : "1 = 1"})`,
    [id, ...c.args],
  );
  return r.length > 0;
}

export async function resolveEmployee(ctx: ApiContext, raw: string): Promise<number> {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0 || !(await employeeVisible(ctx, id))) throw notFound("There is no employee with that id that this client may see.");
  return id;
}

const scopesFor = (ctx: ApiContext) => ({ pay: ctx.has("pay:read"), bank: ctx.has("bank:read") });

async function logSensitive(ctx: ApiContext, reps: EmployeeRep[]) {
  if (!ctx.has("pay:read") && !ctx.has("bank:read")) return;
  for (const e of reps) {
    await logApiAccess(ctx, {
      subjectEmployeeId: e.id,
      resource: `Employee record through the API${ctx.has("pay:read") ? ", with pay" : ""}${ctx.has("bank:read") ? ", with bank details" : ""}`,
    });
  }
}

/* ---------------------------------------------------------------- history */

const HISTORY = {
  action: { table: "pa_it0000_action", columns: ["action_type", "reason"], scope: null },
  org_assignment: {
    table: "pa_it0001_org_assignment",
    columns: ["company_code", "area_code", "sub_area_code", "org_unit_code", "position_code", "cost_center"],
    scope: null,
  },
  personal_data: { table: "pa_it0002_personal_data", columns: ["first_name", "last_name", "date_of_birth", "gender", "marital_status", "nationality"], scope: null },
  working_time: { table: "pa_it0007_planned_working_time", columns: ["work_schedule_code", "weekly_hours", "employment_percent"], scope: null },
  basic_pay: { table: "pa_it0008_basic_pay", columns: ["pay_scale_type", "pay_scale_group", "amount_paise", "currency"], scope: "pay:read" },
  bank_account: { table: "pa_it0009_bank_details", columns: ["bank_name", "account_number", "ifsc", "holder_name"], scope: "bank:read" },
} as const;

const HistorySlice = z
  .object({
    id: z.number().int(),
    valid_from: IsoDate,
    valid_to: IsoDate.nullable(),
    values: z.record(z.string(), z.unknown()),
  })
  .meta({ id: "HistorySlice" });

/* -------------------------------------------------------------- endpoints */

const HireBody = z
  .object({
    effective_date: IsoDate,
    action_type: z.string().default("Hire"),
    reason: z.string().nullable().default(null),
    company: z.string().min(1),
    personnel_area: z.string().nullable().default(null),
    department: z.string().min(1),
    position: z.string().min(1),
    cost_centre: z.string().nullable().default(null),
    first_name: z.string().min(1),
    last_name: z.string().min(1),
    date_of_birth: IsoDate.nullable().default(null),
    gender: z.string().nullable().default(null),
    pay_scale_group: z.string().nullable().default(null),
    basic_pay: Money,
    work_schedule: z.string().default("WS01"),
    external_ids: z.record(z.string(), z.string()).optional(),
  })
  .meta({ id: "HireRequest" });

const PatchBody = z
  .object({
    valid_from: IsoDate.meta({ description: "The date the change applies from. Earlier records are kept." }),
    first_name: z.string().min(1).optional(),
    last_name: z.string().min(1).optional(),
    work_email: z.string().email().optional(),
    cost_centre: z.string().min(1).optional(),
  })
  .meta({ id: "EmployeeChange" });

export const employeeEndpoints: Endpoint[] = [
  {
    method: "GET",
    path: "/employees",
    tag: "People",
    summary: "List employees",
    description:
      "Employees as they stand on `as_of` (today by default), oldest first. With `updated_since`, only those with any change since then — the way to keep a copy in step. With `external_id`, the one employee carrying that id of yours.",
    scopes: ["employees:read"],
    optionalScopes: ["pay:read", "bank:read"],
    query: z.object({
      ...PageQuery,
      as_of: IsoDate.optional(),
      updated_since: z.string().datetime({ offset: true }).optional().meta({ description: "ISO 8601 timestamp." }),
      status: z.enum(["Active", "On leave", "Terminated"]).optional(),
      company: z.string().optional(),
      external_id: z.string().optional().meta({ description: "Your own id for the employee, under this client's system key." }),
    }),
    response: pageSchema(EmployeeSchema),
    example: {
      query: "limit=1&updated_since=2026-09-01T00:00:00Z",
      response: {
        data: [
          {
            id: 3,
            employee_number: "EMP1003",
            status: "Active",
            hire_date: "2024-03-01",
            termination_date: null,
            personal: { first_name: "Arjun", last_name: "Mehta", date_of_birth: "1996-08-14", gender: "Male" },
            org_assignment: {
              company: "CO01",
              personnel_area: "PA01",
              department: { code: "OU0002", name: "Application development" },
              position: { code: "PS0003", title: "Software engineer" },
              cost_centre: "CC-IT-01",
              valid_from: "2024-03-01",
              valid_to: null,
            },
            working_time: { work_schedule: "WS01", weekly_hours: 40 },
            work_email: "arjun.mehta@acme.example",
            basic_pay: { amount: { amount: "65000.00", currency: "INR" }, pay_scale_group: "L2", valid_from: "2025-04-01", valid_to: null },
            external_ids: { erp: "EMP-0042" },
            updated_at: "2026-09-26T10:14:03.221Z",
          },
        ],
        next_cursor: "Mw",
      },
    },
    handler: async (ctx) => {
      const q = ctx.query as { limit?: number; cursor?: string; fields?: string; as_of?: string; updated_since?: string; status?: string; company?: string; external_id?: string };
      const limit = q.limit ?? DEFAULT_LIMIT;
      const asOf = q.as_of ?? todayInIndia();
      const where: string[] = ["e.id > ?"];
      const args: InValue[] = [decodeCursor(q.cursor)];
      const c = companyClause(ctx, "o.company_code");
      if (ctx.client.companies) {
        where.push(c.sql);
        args.push(...c.args);
      }
      if (q.company) {
        where.push("o.company_code = ?");
        args.push(q.company);
      }
      if (q.status) {
        where.push("e.employment_status = ?");
        args.push(q.status);
      }
      if (q.updated_since) {
        const since = new Date(q.updated_since).toISOString();
        where.push("(e.created_at > ? OR e.id IN (SELECT subject_employee_id FROM app_change_log WHERE at > ? AND subject_employee_id IS NOT NULL))");
        args.push(since, since);
      }
      if (q.external_id) {
        const id = await findByExternalId(ctx.client.systemKey, "employee", q.external_id);
        where.push("e.id = ?");
        args.push(id === null ? -1 : Number(id));
      }
      const found = await rows(
        `SELECT e.id FROM pa_employee e
         LEFT JOIN pa_it0001_org_assignment o ON o.employee_id = e.id AND o.id = (
           SELECT id FROM pa_it0001_org_assignment WHERE employee_id = e.id ORDER BY valid_from DESC LIMIT 1)
         WHERE ${where.join(" AND ")} ORDER BY e.id LIMIT ?`,
        [...args, limit + 1],
      );
      const ids = found.map((r) => Number(r.id));
      const reps = await loadEmployees(ids.slice(0, limit), asOf, scopesFor(ctx));
      await logSensitive(ctx, reps);
      const paged = page([...reps, ...(ids.length > limit ? [{ id: ids[limit] } as EmployeeRep] : [])], limit);
      return { body: { data: paged.data.map((e) => pickFields(e, q.fields)), next_cursor: paged.next_cursor } };
    },
  },
  {
    method: "GET",
    path: "/employees/{id}",
    tag: "People",
    summary: "Get an employee",
    description: "One employee as of `as_of`. The ETag changes whenever the record does; send it back in If-Match when you change the employee.",
    scopes: ["employees:read"],
    optionalScopes: ["pay:read", "bank:read"],
    params: { id: "The employee's id." },
    query: z.object({ as_of: IsoDate.optional(), fields: PageQuery.fields }),
    response: EmployeeSchema,
    etag: true,
    example: { path: "/employees/3" },
    handler: async (ctx) => {
      const id = await resolveEmployee(ctx, ctx.params.id);
      const q = ctx.query as { as_of?: string; fields?: string };
      const [rep] = await loadEmployees([id], q.as_of ?? todayInIndia(), scopesFor(ctx));
      await logSensitive(ctx, [rep]);
      return { body: pickFields(rep, q.fields), headers: { ETag: etagOf(rep) } };
    },
  },
  {
    method: "GET",
    path: "/employees/{id}/history",
    tag: "People",
    summary: "An employee's dated history",
    description:
      "Every dated slice of one kind of record, newest first — what was true when. `basic_pay` needs pay:read and `bank_account` bank:read. `valid_to` null means open-ended.",
    scopes: ["employees:read"],
    optionalScopes: ["pay:read", "bank:read"],
    params: { id: "The employee's id." },
    query: z.object({ record: z.enum(Object.keys(HISTORY) as [keyof typeof HISTORY, ...(keyof typeof HISTORY)[]]) }),
    response: z.object({ data: z.array(HistorySlice) }),
    example: { path: "/employees/3/history", query: "record=org_assignment" },
    handler: async (ctx) => {
      const id = await resolveEmployee(ctx, ctx.params.id);
      const record = HISTORY[(ctx.query as { record: keyof typeof HISTORY }).record];
      if (record.scope && !ctx.has(record.scope)) {
        throw new ApiError(403, "insufficient_scope", `This record needs the ${record.scope} scope.`);
      }
      const slices = await rows(
        `SELECT id, valid_from, valid_to, ${record.columns.join(", ")} FROM ${record.table}
         WHERE employee_id = ? ORDER BY valid_from DESC, seq ASC`,
        [id],
      );
      if (record.scope) await logApiAccess(ctx, { subjectEmployeeId: id, resource: `History of ${record.table} through the API` });
      return {
        body: {
          data: slices.map((sl) => ({
            id: Number(sl.id),
            valid_from: String(sl.valid_from),
            valid_to: until(s(sl.valid_to)),
            values: Object.fromEntries(
              record.columns.map((col) =>
                col === "amount_paise"
                  ? ["amount", money(n(sl.amount_paise), s(sl.currency) ?? "INR")]
                  : [col === "cost_center" ? "cost_centre" : col, sl[col] ?? null],
              ).filter(([k]) => k !== "currency"),
            ),
          })),
        },
      };
    },
  },
  {
    method: "POST",
    path: "/employees",
    tag: "People",
    summary: "Hire someone",
    description:
      "The hire action, with exactly the checks HR's screen applies: the employee, their action, org assignment, personal data, working time and basic pay, and the position marked filled — all or nothing. Send an Idempotency-Key so a retry cannot hire twice.",
    scopes: ["employees:hire"],
    body: HireBody,
    response: EmployeeSchema,
    status: 201,
    idempotent: true,
    example: {
      body: {
        effective_date: "2026-10-01",
        company: "CO01",
        personnel_area: "PA01",
        department: "OU0002",
        position: "PS0004",
        cost_centre: "CC-IT-01",
        first_name: "Meera",
        last_name: "Pillai",
        basic_pay: { amount: "58000.00", currency: "INR" },
        external_ids: { erp: "EMP-0107" },
      },
    },
    handler: async (ctx) => {
      const b = ctx.body as z.infer<typeof HireBody>;
      if (ctx.client.companies && !ctx.client.companies.includes(b.company)) {
        throw invalid(`This client may not hire into ${b.company}.`);
      }
      const hired = await hire(
        ctx.actor,
        {
          actionType: b.action_type,
          effectiveDate: b.effective_date,
          reason: b.reason,
          companyCode: b.company,
          areaCode: b.personnel_area,
          orgUnitCode: b.department,
          positionCode: b.position,
          costCenter: b.cost_centre,
          firstName: b.first_name,
          lastName: b.last_name,
          dateOfBirth: b.date_of_birth,
          gender: b.gender,
          payScaleGroup: b.pay_scale_group,
          amountPaise: toPaiseExact(b.basic_pay),
          currency: b.basic_pay.currency,
          workScheduleCode: b.work_schedule,
        },
        `${ctx.client.name} (API)`,
      );
      if (!hired.ok) throw hired.code === "conflict" ? new ApiError(409, "conflict", hired.error) : invalid(hired.error);
      for (const [system, externalId] of Object.entries(b.external_ids ?? {})) {
        await setExternalId(ctx.actor, system, "employee", String(hired.value.employeeId), externalId);
      }
      const [rep] = await loadEmployees([hired.value.employeeId], b.effective_date, scopesFor(ctx));
      return { status: 201, body: rep, headers: { Location: `/api/v1/employees/${rep.id}`, ETag: etagOf(rep) } };
    },
  },
  {
    method: "PATCH",
    path: "/employees/{id}",
    tag: "People",
    summary: "Change fields the ERP owns",
    description:
      "Changes an employee's fields from `valid_from`, through the same dated records the screens write. Only fields whose owner is the ERP may be sent (see Ownership); anything else is refused with `owned_by_hrms`. Send the ETag you read in If-Match: a stale write is refused with 412.",
    scopes: ["employees:write"],
    params: { id: "The employee's id." },
    body: PatchBody,
    response: EmployeeSchema,
    etag: true,
    example: { path: "/employees/3", body: { valid_from: "2026-10-01", cost_centre: "CC-IT-02" } },
    handler: async (ctx) => {
      const id = await resolveEmployee(ctx, ctx.params.id);
      const b = ctx.body as z.infer<typeof PatchBody>;
      const [current] = await loadEmployees([id], todayInIndia(), scopesFor(ctx));
      checkIfMatch(ctx, etagOf(current));
      const fields = Object.fromEntries(
        EMPLOYEE_FIELDS.filter((f) => b[f] !== undefined).map((f) => [f, b[f] as string]),
      ) as Partial<Record<EmployeeField, string>>;
      if (Object.keys(fields).length === 0) throw invalid("Send at least one field to change.");
      for (const field of Object.keys(fields)) {
        if ((await ownerOf("employee", field)) !== "erp") {
          throw new ApiError(409, "owned_by_hrms", `${field} is owned by the HRMS; only HR changes it.`);
        }
      }
      const saved = await updateEmployeeFields(ctx.actor, id, fields, b.valid_from, `${ctx.client.name} (API)`);
      if (!saved.ok) throw invalid(saved.error);
      const [rep] = await loadEmployees([id], todayInIndia(), scopesFor(ctx));
      return { body: rep, headers: { ETag: etagOf(rep) } };
    },
  },
  {
    method: "PUT",
    path: "/employees/{id}/external-ids",
    tag: "People",
    summary: "Record your id for an employee",
    description:
      "Stores your system's id for this employee, so you can find them by it (`GET /employees?external_id=`) and see it on every response. Each of your ids belongs to one employee. Send null to remove it.",
    scopes: ["employees:write"],
    params: { id: "The employee's id." },
    body: z.object({ external_id: z.string().min(1).nullable() }),
    response: z.object({ external_ids: z.record(z.string(), z.string()) }),
    example: { path: "/employees/3/external-ids", body: { external_id: "EMP-0042" } },
    handler: async (ctx) => {
      const id = await resolveEmployee(ctx, ctx.params.id);
      const saved = await setExternalId(ctx.actor, ctx.client.systemKey, "employee", String(id), (ctx.body as { external_id: string | null }).external_id);
      if (!saved.ok) throw new ApiError(409, "conflict", saved.error);
      return { body: { external_ids: (await externalIdsFor("employee", [id])).get(String(id)) ?? {} } };
    },
  },
];
