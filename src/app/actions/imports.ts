"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/access";
import { actorOf } from "@/lib/change-log";
import { parseCsv } from "@/lib/csv";
import { confirmImport, getImport, isImportKind, startImport, type ImportSummary } from "@/lib/services/imports";
import { kickJobs } from "@/lib/jobs/runner";

/**
 * The import wizard's two steps: upload a spreadsheet for its dry run, then
 * confirm it to write what passed. Powerful enough — it can create
 * positions, employees and their pay — that it needs both of HR's two edit
 * permissions, the same bar hiring sets for pay.
 */

export type ActionState = { error?: string; ok?: boolean; importId?: number };

const OK = (importId: number): ActionState => ({ ok: true, importId });
const fail = (error: string): ActionState => ({ error });

export async function uploadImport(_prev: ActionState, form: FormData): Promise<ActionState> {
  const session = await requirePermission("employee.edit", "org.edit");
  const kind = form.get("kind");
  if (!isImportKind(kind)) return fail("Choose what kind of file this is.");
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return fail("Choose a file to upload.");
  if (file.size > 10 * 1024 * 1024) return fail("That file is larger than 10 MB. Split it and import the parts.");

  const rows = parseCsv(await file.text());
  const r = await startImport(actorOf(session), { kind, rows, fileName: file.name, uploadedBy: session.username });
  if (!r.ok) return fail(r.error);
  revalidatePath("/org/imports");
  return OK(r.value.id);
}

export async function confirmImportAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const session = await requirePermission("employee.edit", "org.edit");
  const id = Number(form.get("id"));
  const r = await confirmImport(actorOf(session), id);
  if (!r.ok) return fail(r.error);
  await kickJobs();
  revalidatePath("/org/imports");
  revalidatePath(`/org/imports/${id}`);
  return OK(r.value.id);
}

export type ImportProgress = Pick<ImportSummary, "status" | "totalRows" | "okRows" | "errorRows" | "skippedRows" | "writtenRows"> & {
  completed: boolean;
};

/** Polled while an import is writing, so the screen updates without a manual reload. */
export async function watchImport(id: number): Promise<ImportProgress | { error: string }> {
  await requirePermission("org.view");
  const found = await getImport(id);
  if (!found) return { error: "That import no longer exists." };
  const completed = found.status === "Completed" || found.status === "Failed";
  if (found.status === "Importing") await kickJobs();
  if (completed) revalidatePath(`/org/imports/${id}`);
  return {
    status: found.status,
    totalRows: found.totalRows,
    okRows: found.okRows,
    errorRows: found.errorRows,
    skippedRows: found.skippedRows,
    writtenRows: found.writtenRows,
    completed,
  };
}
