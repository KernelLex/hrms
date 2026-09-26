import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { appDocument } from "@/db/schema";
import { can, getAccess, inScope, type Access } from "@/lib/access";
import { logAccess } from "@/lib/access-log";
import { readDocument, safeFileName, type StoredDocument } from "@/lib/storage";

/**
 * Downloads a stored document, after checking who is asking.
 *
 * Permission follows what the document belongs to: candidate files to whoever
 * manages recruitment, an employee's files to them and to whoever may open
 * their record. New owner types must add a rule here, and until they do
 * nobody can read them — the default is no.
 */
async function mayRead(access: Access, doc: StoredDocument): Promise<boolean> {
  if (doc.ownerType === "candidate") return can(access, "recruitment.manage");
  // An employee's own documents, and whoever may open their record.
  if (doc.ownerType === "employee") {
    if (access.employeeId === doc.ownerId) return true;
    return can(access, "employee.view_all") && (await inScope(access, doc.ownerId));
  }
  return false;
}

export async function GET(_req: Request, ctx: RouteContext<"/api/documents/[id]">) {
  const session = await getAccess();
  if (!session) return new Response("Sign in first.", { status: 401 });

  const { id } = await ctx.params;
  const doc = await db.query.appDocument.findFirst({ where: eq(appDocument.id, Number(id)) });
  if (!doc || !(await mayRead(session, doc))) return new Response("Not found.", { status: 404 });

  const body = await readDocument(doc);
  if (!body) return new Response("The file is missing from storage.", { status: 410 });

  logAccess(session, {
    subjectEmployeeId: doc.ownerType === "employee" ? doc.ownerId : null,
    resource:
      doc.ownerType === "employee"
        ? `Document: ${doc.kind}`
        : `${doc.kind} for ${doc.ownerType} ${doc.ownerId}`,
    resourceId: doc.id,
  });

  if (body.kind === "redirect") return Response.redirect(body.url, 302);

  return new Response(body.bytes as BodyInit, {
    headers: {
      "Content-Type": doc.contentType,
      "Content-Length": String(body.bytes.byteLength),
      "Content-Disposition": `attachment; filename="${safeFileName(doc.fileName)}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
