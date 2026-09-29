import type { Client } from "@libsql/client";

/**
 * One completed import: a single position loaded from a spreadsheet, so the
 * Imports tab has a real report to open rather than an empty list. Written
 * directly, the way the import engine would have written it — including the
 * position itself, PS0101, which nothing else in the seed depends on being
 * vacant or filled. Idempotent.
 */
export async function seedImports(client: Client): Promise<string[]> {
  const exists = await client.execute("SELECT 1 FROM app_import LIMIT 1");
  if (exists.rows.length > 0) return [];

  const at = new Date().toISOString();
  const row = {
    position_code: "PS0101",
    title: "Backend engineer",
    org_unit_code: "OU0002",
    job_code: "JB0001",
    reports_to_code: "PS0002",
    is_manager: "no",
    budget: "85000",
    valid_from: "",
  };

  const imported = await client.execute({
    sql: `INSERT INTO app_import (kind, file_name, status, total_rows, ok_rows, error_rows, skipped_rows, written_rows,
            uploaded_by, uploaded_at, confirmed_at, finished_at)
          VALUES ('org_structure', 'positions.csv', 'Completed', 1, 0, 0, 0, 1, 'hr.admin', ?, ?, ?) RETURNING id`,
    args: [at, at, at],
  });
  const importId = Number(imported.rows[0].id);

  await client.execute({
    sql: `INSERT INTO app_import_row (import_id, row_number, key, data, outcome, messages)
          VALUES (?, 1, 'PS0101', ?, 'written', NULL)`,
    args: [importId, JSON.stringify(row)],
  });

  await client.execute({
    sql: `INSERT INTO om_position (code, title, org_unit_code, job_code, reports_to_code, is_manager, is_vacant,
            budget_paise, valid_from, valid_to, is_active)
          VALUES ('PS0101', 'Backend engineer', 'OU0002', 'JB0001', 'PS0002', 0, 1, 8500000, '2024-01-01', '9999-12-31', 1)`,
  });

  return ["  1 completed import: a Backend engineer position loaded from a spreadsheet"];
}
