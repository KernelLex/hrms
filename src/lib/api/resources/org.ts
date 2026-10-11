import "server-only";
import { z } from "zod";
import type { InValue } from "@libsql/client";
import { rawClient } from "@/lib/db";
import { loadOrgTree, nearestAncestorWithRole } from "@/lib/org-tree";
import { upsertCostCentre, upsertGlAccount } from "@/lib/services/records";
import { externalIdsFor, listOwnership, ownerOf } from "@/lib/services/integration";
import { OWNERSHIP_DEFAULTS } from "../ownership-defaults";
import { DEFAULT_LIMIT, IsoDate, PageQuery, etagOf, page, pageSchema, pickFields, until } from "../format";
import { ApiError, invalid, notFound } from "../problem";
import { checkIfMatch, type ApiContext, type Endpoint } from "../router";
import { companyClause } from "./employees";

/**
 * The organisation, read; and the two kinds of record the ERP owns by
 * default, written — cost centres and the chart of accounts.
 */

const rows = async (sql: string, args: InValue[] = []) => (await rawClient().execute({ sql, args })).rows as unknown as Record<string, unknown>[];
const s = (v: unknown) => (v === null || v === undefined ? null : String(v));
const bool = (v: unknown) => Number(v) === 1;

/** A simple list keyed by a code, paged by that code. */
export function codeList<T extends { code: string }>(opts: {
  path: string;
  summary: string;
  description?: string;
  schema: z.ZodType<T>;
  sql: (ctx: ApiContext) => { sql: string; args: InValue[] };
  map: (row: Record<string, unknown>) => T;
  scopes?: Endpoint["scopes"];
  tag?: string;
  example?: unknown;
}): Endpoint {
  return {
    method: "GET",
    path: opts.path,
    tag: opts.tag ?? "Organisation",
    summary: opts.summary,
    description: opts.description,
    scopes: opts.scopes ?? ["org:read"],
    query: z.object(PageQuery),
    response: pageSchema(opts.schema),
    example: opts.example ? { response: opts.example } : undefined,
    handler: async (ctx) => {
      const q = ctx.query as { limit?: number; cursor?: string; fields?: string };
      const limit = q.limit ?? DEFAULT_LIMIT;
      const after = q.cursor ? Buffer.from(q.cursor, "base64url").toString() : "";
      const base = opts.sql(ctx);
      const found = await rows(`SELECT * FROM (${base.sql}) WHERE code > ? ORDER BY code LIMIT ?`, [...base.args, after, limit + 1]);
      const mapped = found.map((r) => ({ ...opts.map(r), id: String(r.code) }));
      const paged = page(mapped, limit, (r) => r.code);
      return {
        body: {
          data: paged.data.map(({ id, ...rest }) => pickFields({ ...rest, id } as Record<string, unknown>, q.fields)).map(({ id, ...rest }) => (void id, rest)),
          next_cursor: paged.next_cursor,
        },
      };
    },
  };
}

const Company = z
  .object({
    code: z.string(),
    name: z.string(),
    city: z.string().nullable(),
    country: z.string().nullable(),
    currency: z.string().meta({ description: "The three-letter code this legal entity pays in." }),
    fiscal_year_start: z.string().meta({ description: "The first day of its financial year, as MM-DD." }),
    part_of: z.string().nullable().meta({ description: "The org unit this legal entity sits under, for a group." }),
    is_active: z.boolean(),
  })
  .meta({ id: "Company" });
const OrgLevel = z
  .object({
    code: z.string(),
    name: z.string(),
    parent_level: z.string().nullable(),
    rank: z.number().int(),
    is_payroll_group: z.boolean(),
    is_calendar_level: z.boolean(),
    is_cost_centre: z.boolean(),
    is_business_centre: z.boolean().meta({ description: "Nodes at this level are classified PROFIT or SHARED." }),
    is_active: z.boolean(),
  })
  .meta({ id: "OrgLevel" });
const Department = z
  .object({
    code: z.string(),
    name: z.string(),
    parent: z.string().nullable(),
    company: z.string().nullable(),
    level: z.string(),
    centre_type: z.enum(["PROFIT", "SHARED"]).nullable().meta({ description: "Set on a business centre: it earns revenue, or recovers internal cost." }),
    payroll_group: z.string().nullable(),
    valid_from: IsoDate,
    valid_to: IsoDate.nullable(),
    is_active: z.boolean(),
    external_ids: z.record(z.string(), z.string()),
  })
  .meta({ id: "Department" });
const Job = z
  .object({ code: z.string(), title: z.string(), job_family: z.string().nullable(), grade: z.string().nullable(), is_active: z.boolean() })
  .meta({ id: "Job" });
const Position = z
  .object({
    code: z.string(),
    title: z.string(),
    department: z.string(),
    job: z.string(),
    reports_to: z.string().nullable(),
    is_manager: z.boolean(),
    is_vacant: z.boolean(),
    holder_employee_id: z.number().int().nullable(),
    valid_from: IsoDate,
    valid_to: IsoDate.nullable(),
    is_active: z.boolean(),
    external_ids: z.record(z.string(), z.string()),
  })
  .meta({ id: "Position" });
const OrgChartPosition = z
  .object({
    code: z.string(),
    title: z.string(),
    reports_to: z.string().nullable(),
    is_manager: z.boolean(),
    is_vacant: z.boolean(),
    holder_employee_id: z.number().int().nullable(),
  })
  .meta({ id: "OrgChartPosition" });
type OrgChartUnitT = {
  code: string;
  name: string;
  company: string;
  positions: z.infer<typeof OrgChartPosition>[];
  children: OrgChartUnitT[];
};
const OrgChartUnit: z.ZodType<OrgChartUnitT> = z.lazy(() =>
  z.object({
    code: z.string(),
    name: z.string(),
    company: z.string(),
    positions: z.array(OrgChartPosition),
    children: z.array(OrgChartUnit),
  }),
).meta({ id: "OrgChartUnit" });

export const CostCentre = z
  .object({ code: z.string(), name: z.string(), company: z.string().nullable(), is_active: z.boolean(), updated_at: z.string() })
  .meta({ id: "CostCentre" });
export const GlAccount = z
  .object({ code: z.string(), name: z.string(), kind: z.enum(["expense", "liability", "asset"]), is_active: z.boolean(), updated_at: z.string() })
  .meta({ id: "GlAccount" });

/**
 * Cost centres are org units at a level HR flagged, so there is no table of
 * them and no `updated_at` column — the change log is what "last changed"
 * means, and it is what `updated_since` filters on.
 */
const COST_CENTRE_SELECT = `SELECT u.code, u.name, u.company_code, u.is_active,
         coalesce((SELECT max(cl.at) FROM app_change_log cl
                   WHERE cl.entity = 'om_org_unit' AND cl.entity_id = u.code), u.valid_from) AS updated_at
  FROM om_org_unit u JOIN om_level_type t ON t.code = u.level_type_code
  WHERE t.is_cost_centre = 1`;

const costCentreOf = (r: Record<string, unknown>) => ({
  code: String(r.code),
  name: String(r.name),
  company: s(r.company_code),
  is_active: bool(r.is_active),
  updated_at: String(r.updated_at),
});
const glAccountOf = (r: Record<string, unknown>) => ({
  code: String(r.code),
  name: String(r.name),
  kind: String(r.kind) as "expense" | "liability" | "asset",
  is_active: bool(r.is_active),
  updated_at: String(r.updated_at),
});

async function withExternal<T extends { code: string }>(entity: string, list: T[]): Promise<(T & { external_ids: Record<string, string> })[]> {
  const ext = await externalIdsFor(entity, list.map((r) => r.code));
  return list.map((r) => ({ ...r, external_ids: ext.get(r.code) ?? {} }));
}

const companyWhere = (ctx: ApiContext, column: string) => {
  const c = companyClause(ctx, column);
  return ctx.client.companies ? c : { sql: "1 = 1", args: [] as string[] };
};

/** Refuses a write to a record type the HRMS owns. */
async function requireErpOwned(recordType: string) {
  if ((await ownerOf(recordType)) !== "erp") {
    throw new ApiError(409, "owned_by_hrms", `${OWNERSHIP_DEFAULTS.find((o) => o.recordType === recordType)?.label ?? recordType} are owned by the HRMS here; ask HR to make the ERP their owner first.`);
  }
}

export const orgEndpoints: Endpoint[] = [
  codeList({
    path: "/companies",
    summary: "List companies",
    schema: Company,
    sql: (ctx) => {
      const c = companyWhere(ctx, "code");
      return { sql: `SELECT * FROM om_company WHERE ${c.sql}`, args: c.args };
    },
    map: (r) => ({
      code: String(r.code),
      name: String(r.name),
      city: s(r.city),
      country: s(r.country),
      currency: String(r.currency),
      fiscal_year_start: String(r.fiscal_year_start),
      part_of: s(r.parent_node_code),
      is_active: bool(r.is_active),
    }),
  }),
  codeList({
    path: "/org-levels",
    summary: "List the levels of the hierarchy",
    description:
      "What levels exist and what each one carries. The hierarchy's shape is HR's configuration, so read this before reading `/departments`: `level` on a department names a row here.",
    schema: OrgLevel,
    sql: () => ({ sql: "SELECT * FROM om_level_type", args: [] }),
    map: (r) => ({
      code: String(r.code),
      name: String(r.name),
      parent_level: s(r.parent_level_type_code),
      rank: Number(r.rank),
      is_payroll_group: bool(r.is_payroll_group),
      is_calendar_level: bool(r.is_calendar_level),
      is_cost_centre: bool(r.is_cost_centre),
      is_business_centre: bool(r.is_business_centre),
      is_active: bool(r.is_active),
    }),
  }),
  {
    ...codeList({
      path: "/departments",
      summary: "List org units",
      description:
        "Every node of the hierarchy at every level, with its parent, so the tree can be rebuilt. `level` says what a node is; `payroll_group` is the nearest node above it that payroll runs against.",
      schema: Department,
      sql: (ctx) => {
        const c = companyWhere(ctx, "company_code");
        return { sql: `SELECT * FROM om_org_unit WHERE ${c.sql}`, args: c.args };
      },
      map: (r) => ({
        code: String(r.code),
        name: String(r.name),
        parent: s(r.parent_code),
        company: s(r.company_code),
        level: String(r.level_type_code),
        centre_type: s(r.centre_type) as "PROFIT" | "SHARED" | null,
        payroll_group: s(r.payroll_group),
        valid_from: String(r.valid_from),
        valid_to: until(s(r.valid_to)),
        is_active: bool(r.is_active),
        external_ids: {},
      }),
    }),
    handler: async (ctx) => {
      const q = ctx.query as { limit?: number; cursor?: string; fields?: string };
      const limit = q.limit ?? DEFAULT_LIMIT;
      const c = companyWhere(ctx, "company_code");
      const [found, tree] = await Promise.all([
        rows(`SELECT * FROM om_org_unit WHERE ${c.sql} AND code > ? ORDER BY code LIMIT ?`, [
          ...c.args,
          q.cursor ? Buffer.from(q.cursor, "base64url").toString() : "",
          limit + 1,
        ]),
        loadOrgTree(),
      ]);
      const list = await withExternal(
        "department",
        found.map((r) => ({
          code: String(r.code),
          name: String(r.name),
          parent: s(r.parent_code),
          company: s(r.company_code),
          level: String(r.level_type_code),
          centre_type: s(r.centre_type) as "PROFIT" | "SHARED" | null,
          payroll_group: nearestAncestorWithRole(tree, String(r.code), "isPayrollGroup")?.code ?? null,
          valid_from: String(r.valid_from),
          valid_to: until(s(r.valid_to)),
          is_active: bool(r.is_active),
        })),
      );
      const paged = page(list.map((d) => ({ ...d, id: d.code })), limit, (d) => d.code);
      return { body: { data: paged.data.map(({ id, ...d }) => (void id, pickFields(d, q.fields))), next_cursor: paged.next_cursor } };
    },
  },
  codeList({
    path: "/jobs",
    summary: "List jobs",
    schema: Job,
    sql: () => ({ sql: "SELECT * FROM om_job", args: [] }),
    map: (r) => ({ code: String(r.code), title: String(r.title), job_family: s(r.job_family_code), grade: s(r.grade), is_active: bool(r.is_active) }),
  }),
  {
    method: "GET",
    path: "/positions",
    tag: "Organisation",
    summary: "List positions",
    description: "Every position with its reporting line, whether it is vacant, and who holds it today.",
    scopes: ["org:read"],
    query: z.object(PageQuery),
    response: pageSchema(Position),
    handler: async (ctx) => {
      const q = ctx.query as { limit?: number; cursor?: string; fields?: string };
      const limit = q.limit ?? DEFAULT_LIMIT;
      const c = companyWhere(ctx, "ou.company_code");
      const found = await rows(
        `SELECT pos.*, (SELECT o.employee_id FROM pa_it0001_org_assignment o WHERE o.position_code = pos.code
                          AND o.valid_from <= date('now') AND o.valid_to >= date('now') LIMIT 1) AS holder
         FROM om_position pos JOIN om_org_unit ou ON ou.code = pos.org_unit_code
         WHERE ${c.sql} AND pos.code > ? ORDER BY pos.code LIMIT ?`,
        [...c.args, q.cursor ? Buffer.from(q.cursor, "base64url").toString() : "", limit + 1],
      );
      const list = await withExternal(
        "position",
        found.map((r) => ({
          code: String(r.code),
          title: String(r.title),
          department: String(r.org_unit_code),
          job: String(r.job_code),
          reports_to: s(r.reports_to_code),
          is_manager: bool(r.is_manager),
          is_vacant: bool(r.is_vacant),
          holder_employee_id: r.holder === null ? null : Number(r.holder),
          valid_from: String(r.valid_from),
          valid_to: until(s(r.valid_to)),
          is_active: bool(r.is_active),
        })),
      );
      const paged = page(list.map((p) => ({ ...p, id: p.code })), limit, (p) => p.code);
      return { body: { data: paged.data.map(({ id, ...p }) => (void id, pickFields(p, q.fields))), next_cursor: paged.next_cursor } };
    },
  },
  {
    ...codeList({
      path: "/cost-centres",
      summary: "List cost centres",
      description:
        "The org units whose level HR has flagged as a cost centre. Which level that is, is HR's configuration — see `/org-levels`.",
      schema: CostCentre,
      sql: () => ({ sql: COST_CENTRE_SELECT, args: [] }),
      map: costCentreOf,
    }),
    query: z.object({ ...PageQuery, updated_since: z.string().datetime({ offset: true }).optional() }),
    handler: async (ctx) => {
      const q = ctx.query as { limit?: number; cursor?: string; fields?: string; updated_since?: string };
      const limit = q.limit ?? DEFAULT_LIMIT;
      const since = q.updated_since ? new Date(q.updated_since).toISOString() : "";
      const found = await rows(`${COST_CENTRE_SELECT} AND u.code > ? AND updated_at > ? ORDER BY u.code LIMIT ?`, [
        q.cursor ? Buffer.from(q.cursor, "base64url").toString() : "",
        since,
        limit + 1,
      ]);
      const paged = page(found.map((r) => ({ ...costCentreOf(r), id: String(r.code) })), limit, (r) => r.code);
      return { body: { data: paged.data.map(({ id, ...r }) => (void id, pickFields(r, q.fields))), next_cursor: paged.next_cursor } };
    },
  },
  {
    method: "PUT",
    path: "/cost-centres/{code}",
    tag: "Organisation",
    summary: "Create or update a cost centre",
    description:
      "Creates the cost centre, or replaces it. Cost centres are owned by the HRMS by default, so this is refused with `owned_by_hrms` until HR makes the ERP their owner. Send the ETag in If-Match to update safely: a stale write is refused with 412.",
    scopes: ["org:write"],
    params: { code: "The cost centre's code, which is also its id." },
    body: z.object({ name: z.string().min(1), company: z.string().nullable().default(null), is_active: z.boolean().default(true) }),
    response: CostCentre,
    etag: true,
    example: { path: "/cost-centres/CC-IT-02", body: { name: "Platform engineering", company: "CO01", is_active: true } },
    handler: async (ctx) => {
      await requireErpOwned("cost_centre");
      const code = ctx.params.code;
      const [existing] = await rows(`${COST_CENTRE_SELECT} AND u.code = ?`, [code]);
      checkIfMatch(ctx, existing ? etagOf(costCentreOf(existing)) : null);
      const b = ctx.body as { name: string; company: string | null; is_active: boolean };
      const saved = await upsertCostCentre(ctx.actor, code, { name: b.name, companyCode: b.company, isActive: b.is_active });
      if (!saved.ok) throw invalid(saved.error);
      // Read it back the way the listing does: `updated_at` comes from the
      // change log, so building the rep any other way would hand out an ETag
      // that the next read disagrees with.
      const [written] = await rows(`${COST_CENTRE_SELECT} AND u.code = ?`, [code]);
      const rep = costCentreOf(written);
      return { status: saved.value.created ? 201 : 200, body: rep, headers: { ETag: etagOf(rep) } };
    },
  },
  codeList({
    path: "/gl-accounts",
    tag: "Payroll journal",
    summary: "List the chart of accounts",
    description: "Accounts as the ERP last sent them.",
    scopes: ["gl:read"],
    schema: GlAccount,
    sql: () => ({ sql: "SELECT * FROM py_gl_account", args: [] }),
    map: glAccountOf,
  }),
  {
    method: "PUT",
    path: "/gl-accounts/{code}",
    tag: "Payroll journal",
    summary: "Create or update an account",
    description: "The chart of accounts is owned by the ERP by default. Same ownership and If-Match rules as cost centres.",
    scopes: ["gl:write"],
    params: { code: "The account's code." },
    body: z.object({ name: z.string().min(1), kind: z.enum(["expense", "liability", "asset"]), is_active: z.boolean().default(true) }),
    response: GlAccount,
    etag: true,
    example: { path: "/gl-accounts/5010", body: { name: "Salaries and wages", kind: "expense" } },
    handler: async (ctx) => {
      await requireErpOwned("gl_account");
      const code = ctx.params.code;
      const [existing] = await rows("SELECT * FROM py_gl_account WHERE code = ?", [code]);
      checkIfMatch(ctx, existing ? etagOf(glAccountOf(existing)) : null);
      const b = ctx.body as { name: string; kind: "expense" | "liability" | "asset"; is_active: boolean };
      const saved = await upsertGlAccount(ctx.actor, code, { name: b.name, kind: b.kind, isActive: b.is_active });
      if (!saved.ok) throw invalid(saved.error);
      const rep = glAccountOf(saved.value.row);
      return { status: saved.value.created ? 201 : 200, body: rep, headers: { ETag: etagOf(rep) } };
    },
  },
  {
    method: "GET",
    path: "/org-chart",
    tag: "Organisation",
    summary: "The org structure as a tree",
    description:
      "Departments nested under their parent, each with the positions that sit in it. A position names what it reports to, so the reporting line — which can cross departments — is reconstructable from the flat list even though the tree nests by department. For a company the client is not scoped to, nothing is returned.",
    scopes: ["org:read"],
    response: z.object({ data: z.array(OrgChartUnit) }),
    handler: async (ctx) => {
      const c = companyWhere(ctx, "company_code");
      const units = await rows(`SELECT code, name, parent_code, company_code FROM om_org_unit WHERE ${c.sql} AND is_active = 1 ORDER BY code`, c.args);
      const unitCodes = new Set(units.map((u) => String(u.code)));
      const positions = unitCodes.size
        ? await rows(
            `SELECT pos.*, (SELECT o.employee_id FROM pa_it0001_org_assignment o WHERE o.position_code = pos.code
                              AND o.valid_from <= date('now') AND o.valid_to >= date('now') LIMIT 1) AS holder
             FROM om_position pos WHERE pos.is_active = 1 AND pos.org_unit_code IN (${[...unitCodes].map(() => "?").join(", ")})`,
            [...unitCodes],
          )
        : [];
      const positionsByUnit = new Map<string, z.infer<typeof OrgChartPosition>[]>();
      for (const p of positions) {
        const unit = String(p.org_unit_code);
        const list = positionsByUnit.get(unit) ?? [];
        list.push({
          code: String(p.code),
          title: String(p.title),
          reports_to: s(p.reports_to_code),
          is_manager: bool(p.is_manager),
          is_vacant: bool(p.is_vacant),
          holder_employee_id: p.holder === null ? null : Number(p.holder),
        });
        positionsByUnit.set(unit, list);
      }
      const childrenOf = new Map<string | null, Record<string, unknown>[]>();
      for (const u of units) {
        const parent = s(u.parent_code);
        const list = childrenOf.get(parent) ?? [];
        list.push(u);
        childrenOf.set(parent, list);
      }
      const build = (parent: string | null): z.infer<typeof OrgChartUnit>[] =>
        (childrenOf.get(parent) ?? []).map((u) => ({
          code: String(u.code),
          name: String(u.name),
          company: String(u.company_code),
          positions: positionsByUnit.get(String(u.code)) ?? [],
          children: build(String(u.code)),
        }));
      return { body: { data: build(null) } };
    },
  },
  {
    method: "GET",
    path: "/ownership",
    tag: "Integration",
    summary: "Who owns what",
    description: "The owner of each kind of record, and of any field HR has set separately. Only the owner writes it.",
    scopes: [],
    response: z.object({
      data: z.array(z.object({ record_type: z.string(), field: z.string().nullable(), owner: z.enum(["hrms", "erp"]) })),
    }),
    handler: async () => {
      const list = await listOwnership();
      return { body: { data: list.map((o) => ({ record_type: o.recordType, field: o.field || null, owner: o.owner })) } };
    },
  },
];

export { notFound };
