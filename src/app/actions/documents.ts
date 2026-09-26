"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { actorOf, recordCreated, recordDeleted } from "@/lib/change-log";
import { appDocument, paEmployee } from "@/db/schema";
import {
  storeDocument,
  deleteDocument,
  UploadError,
  DOCUMENT_OR_IMAGE_TYPES,
} from "@/lib/storage";
import { EMPLOYEE_DOCUMENT_KINDS, documentSummary } from "@/lib/document-kinds";

export type ActionState = { error?: string; ok?: boolean };

function revalidate(employeeId: number) {
  revalidatePath(`/core-hr/${employeeId}/documents`);
  revalidatePath("/me");
}

/**
 * Files an employee document. Only HR files them; the employee reads their
 * own from their profile, which the download route allows.
 */
export async function uploadEmployeeDocument(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireRole("HR_ADMIN");
  const actor = actorOf(session);
  const employeeId = Number(form.get("employeeId"));
  const kind = String(form.get("kind") ?? "");
  const file = form.get("file");

  const employee = await db.query.paEmployee.findFirst({ where: eq(paEmployee.id, employeeId) });
  if (!employee) return { error: "That employee no longer exists." };
  if (!(EMPLOYEE_DOCUMENT_KINDS as readonly string[]).includes(kind)) {
    return { error: "Choose what kind of document this is." };
  }
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a file to upload." };

  try {
    const stored = await storeDocument({
      ownerType: "employee",
      ownerId: employeeId,
      kind,
      file,
      uploadedBy: session.username,
      allowed: DOCUMENT_OR_IMAGE_TYPES,
    });
    await recordCreated(actor, "app_document", [documentSummary(stored)]);
  } catch (err) {
    if (err instanceof UploadError) return { error: err.message };
    throw err;
  }
  revalidate(employeeId);
  return { ok: true };
}

export async function removeEmployeeDocument(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const actor = actorOf(await requireRole("HR_ADMIN"));
  const doc = await db.query.appDocument.findFirst({
    where: and(eq(appDocument.id, Number(form.get("documentId"))), eq(appDocument.ownerType, "employee")),
  });
  if (!doc) return { error: "That document has already been removed." };
  await deleteDocument(doc);
  await recordDeleted(actor, "app_document", [documentSummary(doc)]);
  revalidate(doc.ownerId);
  return { ok: true };
}
