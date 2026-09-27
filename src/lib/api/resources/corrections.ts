import "server-only";
import { z } from "zod";
import type { InValue } from "@libsql/client";
import { rawClient } from "@/lib/db";
import { submitChangeRequest } from "@/lib/services/corrections";
import { SECTION_CODES, maskedAccount } from "@/lib/corrections-values";
import { DEFAULT_LIMIT, IsoDate, PageQuery, decodeCursor, page, pageSchema, pickFields } from "../format";
import { ApiError, invalid, notFound } from "../problem";
import type { ApiContext, Endpoint } from "../router";
import { companyClause, resolveEmployee } from "./employees";

/**
 * Correction requests: an employee asking for their record to change,
 * decided by HR through the corrections approval flow. The ERP's own
 * employee portal, if it has one, can file them here; the HRMS still
 * decides, exactly as for a request made on My profile.
 */

const ChangeRequest = z
  .object({
    id: z.number().int(),
    employee_id: z.number().int(),
    section: z.enum(SECTION_CODES),
    subtype: z.string().nullable().meta({ description: "The address type or contact kind, where the section has several." }),
    proposed: z.record(z.string(), z.string().nullable()).meta({ description: "The values asked for. An account number shows only its last four digits without bank:read." }),
    effective_date: IsoDate,
    note: z.string().nullable(),
    status: z.enum(["Pending", "Approved", "Rejected", "Cancelled"]),
    channel: z.enum(["self", "api"]),
    requested_at: z.string(),
    decided_at: z.string().nullable(),
    decision_note: z.string().nullable(),
  })
  .meta({ id: "ChangeRequest" });

const Input = z
  .object({
    section: z.enum(SECTION_CODES),
    subtype: z
      .string()
      .nullable()
      .default(null)
      .meta({ description: "For an address: Permanent or Temporary. For a contact: Mobile phone or Email (personal)." }),
    values: z
      .record(z.string(), z.string().nullable())
      .meta({ description: "The section's fields, as the section lists them (see the ChangeRequest reference in API.md)." }),
    effective_date: IsoDate.meta({ description: "The day it applies from. A bank change: today or later." }),
    note: z.string().max(1000).nullable().default(null),
    evidence: z
      .object({ file_name: z.string().min(1).max(200), content_base64: z.string().min(1) })
      .nullable()
      .default(null)
      .meta({ description: "Proof: a PDF, JPEG or PNG up to 4 MB. Required for a bank change." }),
  })
  .meta({ id: "ChangeRequestInput" });

function repOf(ctx: ApiContext, r: Record<string, unknown>): z.infer<typeof ChangeRequest> {
  const proposed = JSON.parse(String(r.proposed)) as Record<string, string | null>;
  if (proposed.account_number && !ctx.has("bank:read")) proposed.account_number = maskedAccount(proposed.account_number);
  return {
    id: Number(r.id),
    employee_id: Number(r.employee_id),
    section: String(r.section) as (typeof SECTION_CODES)[number],
    subtype: r.subtype === null ? null : String(r.subtype),
    proposed,
    effective_date: String(r.effective_date),
    note: r.note === null ? null : String(r.note),
    status: String(r.status) as "Pending",
    channel: String(r.channel) as "self" | "api",
    requested_at: String(r.requested_at),
    decided_at: r.decided_at === null ? null : String(r.decided_at),
    decision_note: r.decision_note === null ? null : String(r.decision_note),
  };
}

export const correctionEndpoints: Endpoint[] = [
  {
    method: "POST",
    path: "/employees/{id}/change-requests",
    tag: "People",
    summary: "Ask for a correction",
    description:
      "Files a correction to an employee's personal details, an address, a contact, or their bank account, on their behalf — from the ERP's own employee portal, say. It goes through the same approval as one made on My profile: HR checks it, and a bank change needs a second approver. Approved, it is written from its effective date and arrives as `employee.updated`; the outcome arrives as `change_request.decided`. A bank change needs bank:read.",
    scopes: ["employees:write"],
    optionalScopes: ["bank:read"],
    params: { id: "The employee's id." },
    body: Input,
    response: ChangeRequest,
    status: 201,
    idempotent: true,
    example: {
      path: "/employees/3/change-requests",
      body: {
        section: "address",
        subtype: "Permanent",
        values: { line: "22 New Street, Indiranagar", city: "Bengaluru", state: "Karnataka", postal_code: "560038", country: "India" },
        effective_date: "2026-10-01",
        note: "Moved house",
      },
    },
    handler: async (ctx) => {
      const employeeId = await resolveEmployee(ctx, ctx.params.id);
      const b = ctx.body as z.infer<typeof Input>;
      if (b.section === "bank" && !ctx.has("bank:read")) {
        throw new ApiError(403, "insufficient_scope", "A bank change needs the bank:read scope.");
      }
      let evidence: File | null = null;
      if (b.evidence) {
        const bytes = Buffer.from(b.evidence.content_base64, "base64");
        if (bytes.length === 0) throw invalid("The evidence could not be read as base64.");
        evidence = new File([new Uint8Array(bytes)], b.evidence.file_name);
      }
      const name = `${ctx.client.name} (API)`;
      const saved = await submitChangeRequest(
        { userId: null, username: name, displayName: name, employeeId: null },
        ctx.actor,
        { employeeId, section: b.section, subtype: b.subtype, values: b.values, effectiveDate: b.effective_date, note: b.note, evidence, channel: "api" },
      );
      if (!saved.ok) {
        if (saved.code === "conflict") throw new ApiError(409, "conflict", saved.error);
        if (saved.code === "not_found") throw notFound(saved.error);
        throw invalid(saved.error);
      }
      const [row] = (await rawClient().execute({ sql: "SELECT * FROM pa_change_request WHERE id = ?", args: [saved.value.id] })).rows;
      return { status: 201, body: repOf(ctx, row as unknown as Record<string, unknown>) };
    },
  },
  {
    method: "GET",
    path: "/change-requests",
    tag: "People",
    summary: "List correction requests",
    description: "Correction requests, oldest first, whoever filed them. Filter with `status` and `employee_id`.",
    scopes: ["employees:read"],
    optionalScopes: ["bank:read"],
    query: z.object({
      ...PageQuery,
      status: z.enum(["Pending", "Approved", "Rejected", "Cancelled"]).optional(),
      employee_id: z.coerce.number().int().optional(),
    }),
    response: pageSchema(ChangeRequest),
    handler: async (ctx) => {
      const q = ctx.query as { limit?: number; cursor?: string; fields?: string; status?: string; employee_id?: number };
      const limit = q.limit ?? DEFAULT_LIMIT;
      const c = companyClause(ctx, "o.company_code");
      const where = ["c.id > ?"];
      const args: InValue[] = [decodeCursor(q.cursor)];
      if (q.status) {
        where.push("c.status = ?");
        args.push(q.status);
      }
      if (q.employee_id) {
        where.push("c.employee_id = ?");
        args.push(q.employee_id);
      }
      if (ctx.client.companies) {
        where.push(`EXISTS (SELECT 1 FROM pa_it0001_org_assignment o WHERE o.employee_id = c.employee_id AND ${c.sql})`);
        args.push(...c.args);
      }
      const found = await rawClient().execute({
        sql: `SELECT c.* FROM pa_change_request c WHERE ${where.join(" AND ")} ORDER BY c.id LIMIT ?`,
        args: [...args, limit + 1],
      });
      const paged = page(found.rows.map((r) => repOf(ctx, r as unknown as Record<string, unknown>)), limit);
      return { body: { data: paged.data.map((r) => pickFields(r, q.fields)), next_cursor: paged.next_cursor } };
    },
  },
];
