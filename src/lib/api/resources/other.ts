import "server-only";
import { z } from "zod";
import type { InValue } from "@libsql/client";
import { rawClient } from "@/lib/db";
import { DEFAULT_LIMIT, IsoDate, Money, PageQuery, decodeCursor, money, page, pageSchema, pickFields } from "../format";
import type { ApiContext, Endpoint } from "../router";
import {
  EMPLOYMENT_TYPES,
  INTERVIEW_STATUS,
  PIPELINE_STAGES,
  RECOMMENDATIONS,
  REQUISITION_STATUS,
  WORK_MODES,
} from "@/lib/recruitment-values";

/** Tax, recruitment and performance: read-only. */

const rows = async (sql: string, args: InValue[] = []) => (await rawClient().execute({ sql, args })).rows as unknown as Record<string, unknown>[];
const s = (v: unknown) => (v === null || v === undefined ? null : String(v));

const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));

async function idPage<T extends { id: number }>(
  ctx: ApiContext,
  sql: string,
  args: InValue[],
  map: (r: Record<string, unknown>) => T,
  idColumn = "id",
) {
  const q = ctx.query as { limit?: number; cursor?: string; fields?: string };
  const limit = q.limit ?? DEFAULT_LIMIT;
  const found = await rows(`${sql} AND ${idColumn} > ? ORDER BY ${idColumn} LIMIT ?`, [...args, decodeCursor(q.cursor), limit + 1]);
  const paged = page(found.map(map), limit);
  return { body: { data: paged.data.map((r) => pickFields(r, q.fields)), next_cursor: paged.next_cursor } };
}

const visible = (ctx: ApiContext, column: string) => {
  const companies = ctx.client.companies;
  if (!companies) return { sql: "1 = 1", args: [] as string[] };
  return {
    sql: `${column} IN (SELECT employee_id FROM pa_it0001_org_assignment WHERE company_code IN (${companies.map(() => "?").join(", ")}))`,
    args: companies,
  };
};

/** Requisitions in the client's companies, through each one's department. */
const requisitionCompanies = (ctx: ApiContext, column: string) => {
  const companies = ctx.client.companies;
  if (!companies) return { sql: "1 = 1", args: [] as string[] };
  return {
    sql: `${column} IN (SELECT code FROM om_org_unit WHERE company_code IN (${companies.map(() => "?").join(", ")}))`,
    args: companies,
  };
};

const RegisterRow = z
  .object({
    id: z.number().int(),
    employee_id: z.number().int(),
    financial_year: z.string(),
    quarter: z.number().int(),
    gross_paid: Money.optional().meta({ description: "With pay:read." }),
    tds_deducted: Money,
    challan_bsr: z.string().nullable(),
    deposit_date: IsoDate.nullable(),
    receipt_24q: z.string().nullable(),
  })
  .meta({ id: "TdsRegisterRow" });
const Requisition = z
  .object({
    id: z.number().int(),
    code: z.string(),
    title: z.string().meta({ description: "The role as candidates see it." }),
    position: z.string(),
    department: z.string(),
    company: z.string().nullable(),
    job: z.string(),
    description: z.string().nullable(),
    qualifications: z.string().nullable().meta({ description: "One per line." }),
    skills: z.string().nullable().meta({ description: "One per line." }),
    experience_years: z.object({ min: z.number().int().nullable(), max: z.number().int().nullable() }),
    employment_type: z.enum(EMPLOYMENT_TYPES),
    work_mode: z.enum(WORK_MODES),
    location: z.string().nullable(),
    budget: z
      .object({ min: Money.nullable(), max: Money.nullable() })
      .optional()
      .meta({ description: "The monthly salary budgeted. With pay:read." }),
    hiring_manager_employee_id: z.number().int().nullable(),
    openings: z.number().int(),
    priority: z.string(),
    posted_date: IsoDate.nullable(),
    target_close_date: IsoDate.nullable(),
    status: z.enum(REQUISITION_STATUS),
    is_published: z.boolean().meta({ description: "On the public careers page." }),
  })
  .meta({ id: "Requisition" });
const InterviewRound = z
  .object({
    id: z.number().int(),
    round: z.string(),
    interviewer_employee_id: z.number().int().nullable().meta({ description: "Null for an interviewer from outside the company." }),
    scheduled_date: IsoDate,
    scheduled_time: z.string().nullable().meta({ description: "HH:MM, India time." }),
    status: z.enum(INTERVIEW_STATUS),
    rating: z.number().int().nullable().meta({ description: "1 to 5, once done." }),
    recommendation: z.enum(RECOMMENDATIONS).nullable(),
  })
  .meta({ id: "InterviewRound", description: "One round. The interviewer's notes stay in the HRMS." });
const Application = z
  .object({
    id: z.number().int(),
    requisition_id: z.number().int(),
    candidate_id: z.number().int(),
    stage: z.enum(PIPELINE_STAGES).meta({ description: "Applied, then Interviewing, Selected (approved), Offered and Hired. A rejected application keeps the stage it reached." }),
    outcome: z.enum(["open", "rejected", "hired"]),
    channel: z.enum(["Careers page", "Added by HR"]),
    applied_date: IsoDate,
    rejected_at: z.string().nullable(),
    selected_at: z.string().nullable(),
    offered_at: z.string().nullable(),
    offered_salary: Money.nullable().optional().meta({ description: "Monthly. With pay:read." }),
    employee_id: z.number().int().nullable().meta({ description: "Once hired." }),
    interviews: z.array(InterviewRound),
  })
  .meta({ id: "Application", description: "Where a candidate stands against a requisition. Candidates' personal details are not exposed." });
const Appraisal = z
  .object({
    id: z.number().int(),
    cycle_id: z.number().int(),
    employee_id: z.number().int(),
    status: z.string(),
    final_rating: z.number().int().nullable().meta({ description: "The calibrated rating, once calibration is finalised." }),
    finalised_at: z.string().nullable(),
  })
  .meta({ id: "Appraisal" });

export const otherEndpoints: Endpoint[] = [
  {
    method: "GET",
    path: "/tax/register",
    tag: "Tax",
    summary: "The TDS register",
    description: "Tax deducted per employee and quarter, with the challan it was deposited under.",
    scopes: ["tax:read"],
    optionalScopes: ["pay:read"],
    query: z.object({ ...PageQuery, financial_year: z.string().regex(/^\d{4}-\d{2}$/).optional().meta({ description: "Such as 2026-27." }) }),
    response: pageSchema(RegisterRow),
    handler: (ctx) => {
      const fy = (ctx.query as { financial_year?: string }).financial_year;
      const v = visible(ctx, "employee_id");
      return idPage(ctx, `SELECT * FROM tds_deduction_register WHERE ${v.sql} ${fy ? "AND financial_year = ?" : ""}`, [...v.args, ...(fy ? [fy] : [])], (r) => ({
        id: Number(r.id),
        employee_id: Number(r.employee_id),
        financial_year: String(r.financial_year),
        quarter: Number(r.quarter),
        ...(ctx.has("pay:read") ? { gross_paid: money(Number(r.gross_paid_paise))! as { amount: string; currency: "INR" } } : {}),
        tds_deducted: money(Number(r.tds_deducted_paise))! as { amount: string; currency: "INR" },
        challan_bsr: s(r.challan_bsr),
        deposit_date: s(r.deposit_date),
        receipt_24q: s(r.receipt_24q),
      }));
    },
  },
  {
    method: "GET",
    path: "/requisitions",
    tag: "Recruitment",
    summary: "List requisitions",
    description: "Open and past hiring: each vacant position and the role it offers, as HR described it. Filter with `status` and `published`.",
    scopes: ["recruitment:read"],
    optionalScopes: ["pay:read"],
    query: z.object({
      ...PageQuery,
      status: z.enum(REQUISITION_STATUS).optional(),
      published: z.enum(["true", "false"]).optional().meta({ description: "Only those on, or off, the careers page." }),
    }),
    response: pageSchema(Requisition),
    handler: (ctx) => {
      const q = ctx.query as { status?: string; published?: string };
      const c = requisitionCompanies(ctx, "org_unit_code");
      const where = [c.sql, ...(q.status ? ["status = ?"] : []), ...(q.published ? ["is_published = ?"] : [])];
      const args: InValue[] = [...c.args, ...(q.status ? [q.status] : []), ...(q.published ? [q.published === "true" ? 1 : 0] : [])];
      return idPage(
        ctx,
        `SELECT r.*, ou.company_code FROM rc_requisition r JOIN om_org_unit ou ON ou.code = r.org_unit_code WHERE ${where.join(" AND ")}`,
        args,
        (r) => ({
          id: Number(r.id),
          code: String(r.code),
          title: String(r.title),
          position: String(r.position_code),
          department: String(r.org_unit_code),
          company: s(r.company_code),
          job: String(r.job_code),
          description: s(r.description),
          qualifications: s(r.qualifications),
          skills: s(r.skills),
          experience_years: { min: n(r.experience_min_years), max: n(r.experience_max_years) },
          employment_type: String(r.employment_type) as (typeof EMPLOYMENT_TYPES)[number],
          work_mode: String(r.work_mode) as (typeof WORK_MODES)[number],
          location: s(r.location),
          ...(ctx.has("pay:read") ? { budget: { min: money(n(r.budget_min_paise)), max: money(n(r.budget_max_paise)) } } : {}),
          hiring_manager_employee_id: n(r.hiring_manager_employee_id),
          openings: Number(r.openings),
          priority: String(r.priority),
          posted_date: s(r.posted_date),
          target_close_date: s(r.target_close_date),
          status: String(r.status) as (typeof REQUISITION_STATUS)[number],
          is_published: Number(r.is_published) === 1,
        }),
        "r.id",
      );
    },
  },
  {
    method: "GET",
    path: "/applications",
    tag: "Recruitment",
    summary: "List applications",
    description:
      "Where each candidate stands against each requisition, with their interview rounds. Filter with `requisition_id` and `stage`. Candidates' personal details and interview notes stay in the HRMS; a hire arrives as the `candidate.hired` event and the new employee.",
    scopes: ["recruitment:read"],
    optionalScopes: ["pay:read"],
    query: z.object({
      ...PageQuery,
      requisition_id: z.coerce.number().int().optional(),
      stage: z.enum(PIPELINE_STAGES).optional(),
    }),
    response: pageSchema(Application),
    handler: async (ctx) => {
      const q = ctx.query as { requisition_id?: number; stage?: string };
      const c = requisitionCompanies(ctx, "r.org_unit_code");
      const where = [c.sql, ...(q.requisition_id ? ["a.requisition_id = ?"] : []), ...(q.stage ? ["a.stage = ?"] : [])];
      const args: InValue[] = [...c.args, ...(q.requisition_id ? [q.requisition_id] : []), ...(q.stage ? [q.stage] : [])];
      const result = await idPage(
        ctx,
        `SELECT a.*, h.employee_id AS hired_employee_id FROM rc_application a
         JOIN rc_requisition r ON r.id = a.requisition_id
         LEFT JOIN rc_hire_conversion h ON h.application_id = a.id
         WHERE ${where.join(" AND ")}`,
        args,
        (r) => ({
          id: Number(r.id),
          requisition_id: Number(r.requisition_id),
          candidate_id: Number(r.candidate_id),
          stage: String(r.stage) as (typeof PIPELINE_STAGES)[number],
          outcome: (r.rejected_at ? "rejected" : String(r.stage) === "Hired" ? "hired" : "open") as "open" | "rejected" | "hired",
          channel: String(r.channel) as "Careers page" | "Added by HR",
          applied_date: String(r.applied_date),
          rejected_at: s(r.rejected_at),
          selected_at: s(r.selected_at),
          offered_at: s(r.offered_at),
          ...(ctx.has("pay:read") ? { offered_salary: money(n(r.offered_salary_paise)) } : {}),
          employee_id: n(r.hired_employee_id),
          interviews: [] as z.infer<typeof InterviewRound>[],
        }),
        "a.id",
      );
      const apps = result.body.data as { id: number; interviews?: z.infer<typeof InterviewRound>[] }[];
      if (apps.length > 0) {
        const rounds = await rows(
          `SELECT * FROM rc_interview WHERE application_id IN (${apps.map(() => "?").join(", ")}) ORDER BY scheduled_date, scheduled_time, id`,
          apps.map((a) => a.id),
        );
        for (const a of apps) {
          if (!a.interviews) continue;
          a.interviews = rounds
            .filter((i) => Number(i.application_id) === a.id)
            .map((i) => ({
              id: Number(i.id),
              round: String(i.round),
              interviewer_employee_id: n(i.interviewer_employee_id),
              scheduled_date: String(i.scheduled_date),
              scheduled_time: s(i.scheduled_time),
              status: String(i.status) as (typeof INTERVIEW_STATUS)[number],
              rating: n(i.rating),
              recommendation: s(i.recommendation) as (typeof RECOMMENDATIONS)[number] | null,
            }));
        }
      }
      return result;
    },
  },
  {
    method: "GET",
    path: "/appraisals",
    tag: "Performance",
    summary: "List appraisals",
    description: "Each person's appraisal in a cycle, with the final rating once calibration has finalised it. Self and manager ratings are not exposed.",
    scopes: ["performance:read"],
    query: z.object({ ...PageQuery, cycle_id: z.coerce.number().int().optional() }),
    response: pageSchema(Appraisal),
    handler: (ctx) => {
      const cycle = (ctx.query as { cycle_id?: number }).cycle_id;
      const v = visible(ctx, "a.employee_id");
      return idPage(
        ctx,
        `SELECT * FROM (SELECT a.id, a.cycle_id, a.employee_id, a.status, c.calibrated_rating, c.status AS c_status, c.finalised_at
                        FROM pm_appraisal a LEFT JOIN pm_calibration c ON c.appraisal_id = a.id WHERE ${v.sql})
         WHERE ${cycle ? "cycle_id = ?" : "1 = 1"}`,
        [...v.args, ...(cycle ? [cycle] : [])],
        (r) => ({
          id: Number(r.id),
          cycle_id: Number(r.cycle_id),
          employee_id: Number(r.employee_id),
          status: String(r.status),
          final_rating: r.c_status === "Finalised" && r.calibrated_rating !== null ? Number(r.calibrated_rating) : null,
          finalised_at: r.c_status === "Finalised" ? s(r.finalised_at) : null,
        }),
      );
    },
  },
];
