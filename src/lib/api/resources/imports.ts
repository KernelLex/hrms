import "server-only";
import { z } from "zod";
import { confirmImport, getImport, importRows, startImport, IMPORT_KINDS, type ImportKind } from "@/lib/services/imports";
import { DEFAULT_LIMIT, PageQuery } from "../format";
import { ApiError, invalid, notFound } from "../problem";
import type { ApiContext, Endpoint } from "../router";

/**
 * Bulk import, the same engine the import wizard uses (§5.14): positions,
 * employees, or opening balances, checked row by row before anything is
 * written. `POST /imports` is the dry run; `POST /imports/{id}/confirm`
 * writes what passed, a batch at a time. So the ERP's own bulk load faces
 * the same checks a spreadsheet does.
 */

const SCOPE_FOR: Record<ImportKind, "org:write" | "employees:write"> = {
  org_structure: "org:write",
  employees: "employees:write",
  opening_balances: "employees:write",
};

function requireScope(ctx: ApiContext, kind: ImportKind) {
  const scope = SCOPE_FOR[kind];
  if (!ctx.has(scope)) {
    throw new ApiError(403, "insufficient_scope", `Importing ${kind.replace("_", " ")} needs the ${scope} scope.`, undefined, {
      "WWW-Authenticate": `Bearer error="insufficient_scope", scope="${scope}"`,
    });
  }
}

const Import = z
  .object({
    id: z.number().int(),
    kind: z.enum(IMPORT_KINDS),
    file_name: z.string().nullable(),
    status: z.enum(["Validating", "Validated", "Importing", "Completed", "Failed"]),
    total_rows: z.number().int(),
    ok_rows: z.number().int(),
    error_rows: z.number().int(),
    skipped_rows: z.number().int(),
    written_rows: z.number().int(),
    uploaded_by: z.string(),
    uploaded_at: z.string(),
    confirmed_at: z.string().nullable(),
    finished_at: z.string().nullable(),
  })
  .meta({ id: "Import" });

const ImportRow = z
  .object({
    row_number: z.number().int(),
    key: z.string().nullable(),
    outcome: z.enum(["ok", "written", "skipped", "error"]),
    messages: z.array(z.string()),
    data: z.record(z.string(), z.string()),
  })
  .meta({ id: "ImportRow" });

const repOf = (s: Awaited<ReturnType<typeof getImport>>): z.infer<typeof Import> => {
  const v = s!;
  return {
    id: v.id,
    kind: v.kind,
    file_name: v.fileName,
    status: v.status,
    total_rows: v.totalRows,
    ok_rows: v.okRows,
    error_rows: v.errorRows,
    skipped_rows: v.skippedRows,
    written_rows: v.writtenRows,
    uploaded_by: v.uploadedBy,
    uploaded_at: v.uploadedAt,
    confirmed_at: v.confirmedAt,
    finished_at: v.finishedAt,
  };
};

export const importEndpoints: Endpoint[] = [
  {
    method: "POST",
    path: "/imports",
    tag: "Organisation",
    summary: "Check rows for import (dry run)",
    description:
      "Validates rows for one of the import kinds without writing anything, exactly as uploading a spreadsheet does — the same row-by-row checks, including whether each is already on record. Read the report (`GET /imports/{id}`, `GET /imports/{id}/rows`), then `POST /imports/{id}/confirm` to write what passed. Needs org:write for positions, employees:write for employees and opening balances.",
    scopes: [],
    body: z.object({
      kind: z.enum(IMPORT_KINDS),
      rows: z.array(z.record(z.string(), z.string())).min(1).max(20_000),
    }),
    response: Import,
    status: 201,
    idempotent: true,
    example: {
      body: {
        kind: "employees",
        rows: [
          {
            employee_number: "EMP2050",
            first_name: "Meera",
            last_name: "Nair",
            hire_date: "2023-05-02",
            company_code: "CO01",
            org_unit_code: "OU0002",
            position_code: "PS0101",
            basic_pay: "68000",
            work_schedule_code: "WS01",
          },
        ],
      },
    },
    handler: async (ctx) => {
      const b = ctx.body as { kind: ImportKind; rows: Record<string, string>[] };
      requireScope(ctx, b.kind);
      const saved = await startImport(ctx.actor, { kind: b.kind, rows: b.rows, fileName: null, uploadedBy: ctx.client.name });
      if (!saved.ok) throw invalid(saved.error);
      return { status: 201, body: repOf(saved.value) };
    },
  },
  {
    method: "GET",
    path: "/imports/{id}",
    tag: "Organisation",
    summary: "Read an import's status",
    description: "The counts so far: checked, written, already on record, and could not be read.",
    scopes: ["org:read"],
    params: { id: "The import's id." },
    response: Import,
    handler: async (ctx) => {
      const found = await getImport(Number(ctx.params.id));
      if (!found) throw notFound("That import does not exist.");
      return { body: repOf(found) };
    },
  },
  {
    method: "GET",
    path: "/imports/{id}/rows",
    tag: "Organisation",
    summary: "Read an import's rows",
    description:
      "Every row with its outcome and, for one that failed, why. Filter with `outcome`. A row's own data — an imported employee's pay, say — needs the scope that kind of import needs to write, not just org:read: the same boundary /employees and /payroll keep.",
    scopes: [],
    params: { id: "The import's id." },
    query: z.object({ ...PageQuery, outcome: z.enum(["ok", "written", "skipped", "error"]).optional() }),
    response: z.object({ data: z.array(ImportRow) }),
    handler: async (ctx) => {
      const found = await getImport(Number(ctx.params.id));
      if (!found) throw notFound("That import does not exist.");
      requireScope(ctx, found.kind);
      const q = ctx.query as { limit?: number; outcome?: string };
      const rows = await importRows(found.id, { outcome: q.outcome, limit: q.limit ?? DEFAULT_LIMIT });
      return {
        body: {
          data: rows.map((r) => ({ row_number: r.rowNumber, key: r.key, outcome: r.outcome as "ok", messages: r.messages, data: r.data })),
        },
      };
    },
  },
  {
    method: "POST",
    path: "/imports/{id}/confirm",
    tag: "Organisation",
    summary: "Write the rows that passed",
    description: "Commits every row still marked `ok`, in the background — a batch at a time, so a large file does not depend on one request. Poll `GET /imports/{id}` for progress; a completed import arrives as `import.completed`.",
    scopes: [],
    params: { id: "The import's id." },
    response: Import,
    idempotent: true,
    handler: async (ctx) => {
      const found = await getImport(Number(ctx.params.id));
      if (!found) throw notFound("That import does not exist.");
      requireScope(ctx, found.kind);
      const saved = await confirmImport(ctx.actor, found.id);
      if (!saved.ok) {
        if (saved.code === "conflict") throw new ApiError(409, "conflict", saved.error);
        throw invalid(saved.error);
      }
      return { body: repOf(saved.value) };
    },
  },
];
