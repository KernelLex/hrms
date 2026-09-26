import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { AwsClient } from "aws4fetch";
import { eq } from "drizzle-orm";
import { db, rawClient } from "@/lib/db";
import { appDocument, now } from "@/db/schema";
import { readEnv } from "@/lib/env";

/**
 * Document storage.
 *
 * Every file is registered in `app_document` and nothing refers to one by its
 * bare storage key. Where the bytes live depends on configuration:
 *
 *   - Cloudflare R2, when R2_ACCOUNT_ID, R2_ACCESS_KEY_ID,
 *     R2_SECRET_ACCESS_KEY and R2_BUCKET are all set. Downloads then redirect
 *     to a short-lived presigned URL, so file bytes never pass through a
 *     Vercel function on the way out.
 *   - The database otherwise, in `app_document_content`. Fine for a prototype
 *     of resumes a few hundred kilobytes each, and it needs no account.
 *
 * Each row records which it used, so switching to R2 later needs no
 * migration: old files keep being read from the database.
 */

export const MAX_BYTES = 4 * 1024 * 1024; // under Vercel's 4.5 MB request limit

/** What may be uploaded, recognised by content rather than trusted from the name. */
const KINDS = [
  { type: "application/pdf", ext: ["pdf"], magic: [0x25, 0x50, 0x44, 0x46] }, // %PDF
  {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ext: ["docx"],
    magic: [0x50, 0x4b, 0x03, 0x04], // a zip container
  },
  { type: "application/msword", ext: ["doc"], magic: [0xd0, 0xcf, 0x11, 0xe0] },
  { type: "image/jpeg", ext: ["jpg", "jpeg"], magic: [0xff, 0xd8, 0xff] },
  { type: "image/png", ext: ["png"], magic: [0x89, 0x50, 0x4e, 0x47] },
] as const;

export type FileKind = (typeof KINDS)[number]["type"];

/** Resumes and letters: documents only. */
export const DOCUMENT_TYPES: FileKind[] = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
];

/** Identity and address proofs are often photographs. */
export const DOCUMENT_OR_IMAGE_TYPES: FileKind[] = [...DOCUMENT_TYPES, "image/jpeg", "image/png"];

export type StoredDocument = typeof appDocument.$inferSelect;

type R2Config = { accountId: string; accessKeyId: string; secretAccessKey: string; bucket: string };

function r2Config(): R2Config | null {
  const accountId = readEnv("R2_ACCOUNT_ID");
  const accessKeyId = readEnv("R2_ACCESS_KEY_ID");
  const secretAccessKey = readEnv("R2_SECRET_ACCESS_KEY");
  const bucket = readEnv("R2_BUCKET");
  return accountId && accessKeyId && secretAccessKey && bucket
    ? { accountId, accessKeyId, secretAccessKey, bucket }
    : null;
}

export function storageDriver(): "r2" | "database" {
  return r2Config() ? "r2" : "database";
}

function r2(config: R2Config) {
  const client = new AwsClient({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    service: "s3",
    region: "auto",
  });
  const url = (key: string) =>
    `https://${config.accountId}.r2.cloudflarestorage.com/${config.bucket}/${key
      .split("/")
      .map(encodeURIComponent)
      .join("/")}`;
  return { client, url };
}

/** Checks a file's type from its first bytes. Returns null if not accepted. */
export function recognise(
  bytes: Uint8Array,
  fileName: string,
  allowed: FileKind[] = DOCUMENT_TYPES,
) {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  const kind = KINDS.find(
    (k) =>
      allowed.includes(k.type) &&
      (k.ext as readonly string[]).includes(ext) &&
      k.magic.every((b, i) => bytes[i] === b),
  );
  return kind ? { type: kind.type, ext: kind.ext[0] } : null;
}

/** A file name safe to send back in a Content-Disposition header. */
export function safeFileName(name: string): string {
  const cleaned = name
    .replace(/[\\/]/g, "_")
    .replace(/[^\w.\- ()]/g, "")
    .trim()
    .slice(0, 120);
  return cleaned || "document";
}

export class UploadError extends Error {}

/**
 * Stores a file and registers it. Throws UploadError with a sentence meant
 * for the person uploading when the file is not acceptable.
 */
export async function storeDocument(opts: {
  ownerType: string;
  ownerId: number;
  kind: string;
  file: File;
  uploadedBy: string;
  /** What this kind of document may be. Documents only, unless widened. */
  allowed?: FileKind[];
}): Promise<StoredDocument> {
  const { file } = opts;
  if (!file || file.size === 0) throw new UploadError("Choose a file to upload.");
  if (file.size > MAX_BYTES) {
    throw new UploadError("That file is over 4 MB. Save a smaller copy and try again.");
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const allowed = opts.allowed ?? DOCUMENT_TYPES;
  const kind = recognise(bytes, file.name, allowed);
  if (!kind) {
    throw new UploadError(
      allowed.includes("image/jpeg")
        ? "Upload a PDF, Word document, JPEG or PNG."
        : "Upload a PDF or Word document.",
    );
  }

  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const storageKey = `${opts.ownerType}/${opts.ownerId}/${randomUUID()}.${kind.ext}`;
  const config = r2Config();
  const base = {
    ownerType: opts.ownerType,
    ownerId: opts.ownerId,
    kind: opts.kind,
    fileName: safeFileName(file.name),
    contentType: kind.type,
    sizeBytes: bytes.byteLength,
    sha256,
    storageKey,
    uploadedBy: opts.uploadedBy,
    uploadedAt: now(),
  };

  if (config) {
    const { client, url } = r2(config);
    const res = await client.fetch(url(storageKey), {
      method: "PUT",
      body: bytes,
      headers: { "Content-Type": kind.type },
    });
    if (!res.ok) throw new Error(`R2 refused the upload (${res.status}).`);
    const [doc] = await db.insert(appDocument).values({ ...base, storage: "r2" }).returning();
    return doc;
  }

  // The registry row and its bytes go in together or not at all.
  const [inserted] = await rawClient().batch(
    [
      {
        sql: `INSERT INTO app_document
                (owner_type, owner_id, kind, file_name, content_type, size_bytes, sha256,
                 storage, storage_key, uploaded_by, uploaded_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, 'database', ?, ?, ?) RETURNING id`,
        args: [
          base.ownerType,
          base.ownerId,
          base.kind,
          base.fileName,
          base.contentType,
          base.sizeBytes,
          base.sha256,
          base.storageKey,
          base.uploadedBy,
          base.uploadedAt,
        ],
      },
      {
        sql: `INSERT INTO app_document_content (document_id, bytes)
              VALUES ((SELECT id FROM app_document WHERE storage_key = ?), ?)`,
        args: [storageKey, bytes],
      },
    ],
    "write",
  );
  const id = Number(inserted.rows[0].id);
  const doc = await db.query.appDocument.findFirst({ where: eq(appDocument.id, id) });
  return doc!;
}

export type DocumentBody =
  | { kind: "bytes"; bytes: Uint8Array }
  | { kind: "redirect"; url: string };

/** The file's contents, or where to fetch them from. */
export async function readDocument(doc: StoredDocument): Promise<DocumentBody | null> {
  if (doc.storage === "r2") {
    const config = r2Config();
    if (!config) return null;
    const { client, url } = r2(config);
    const target = new URL(url(doc.storageKey));
    target.searchParams.set("X-Amz-Expires", "300");
    target.searchParams.set(
      "response-content-disposition",
      `attachment; filename="${safeFileName(doc.fileName)}"`,
    );
    const signed = await client.sign(target.toString(), { method: "GET", aws: { signQuery: true } });
    return { kind: "redirect", url: signed.url };
  }

  const r = await rawClient().execute({
    sql: "SELECT bytes FROM app_document_content WHERE document_id = ?",
    args: [doc.id],
  });
  const raw = r.rows[0]?.bytes;
  if (!raw) return null;
  return { kind: "bytes", bytes: new Uint8Array(raw as ArrayBuffer) };
}

/** Removes a document and its bytes, wherever they are. */
export async function deleteDocument(doc: StoredDocument): Promise<void> {
  if (doc.storage === "r2") {
    const config = r2Config();
    if (config) {
      const { client, url } = r2(config);
      const res = await client.fetch(url(doc.storageKey), { method: "DELETE" });
      if (!res.ok && res.status !== 404) throw new Error(`R2 refused the delete (${res.status}).`);
    }
  }
  await rawClient().batch(
    [
      { sql: "DELETE FROM app_document_content WHERE document_id = ?", args: [doc.id] },
      { sql: "DELETE FROM app_document WHERE id = ?", args: [doc.id] },
    ],
    "write",
  );
}

export async function documentsFor(ownerType: string, ownerIds: number[]) {
  if (ownerIds.length === 0) return [];
  const r = await rawClient().execute({
    sql: `SELECT id, owner_id, kind, file_name, size_bytes, uploaded_at FROM app_document
          WHERE owner_type = ? AND owner_id IN (${ownerIds.map(() => "?").join(", ")})
          ORDER BY uploaded_at DESC`,
    args: [ownerType, ...ownerIds],
  });
  return r.rows.map((row) => ({
    id: Number(row.id),
    ownerId: Number(row.owner_id),
    kind: String(row.kind),
    fileName: String(row.file_name),
    sizeBytes: Number(row.size_bytes),
    uploadedAt: String(row.uploaded_at),
  }));
}
