import { sqliteTable, text, integer, blob, index } from "drizzle-orm/sqlite-core";

/**
 * Cross-cutting tables that belong to no single module.
 */

/* --------------------------------------------------------------- documents */

/**
 * Every stored file, registered once. Nothing refers to a file by its bare
 * storage key: screens and downloads go through this row, which records who
 * uploaded it, what it belongs to, and where the bytes actually live.
 *
 * `storage` is "database" until Cloudflare R2 is configured, then "r2". Rows
 * of both kinds can coexist, so switching drivers needs no migration of old
 * files.
 */
export const appDocument = sqliteTable(
  "app_document",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** What the file belongs to: "candidate" today. */
    ownerType: text("owner_type").notNull(),
    ownerId: integer("owner_id").notNull(),
    /** What it is: "Resume". */
    kind: text("kind").notNull(),
    fileName: text("file_name").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    sha256: text("sha256").notNull(),
    storage: text("storage").notNull(),
    storageKey: text("storage_key").notNull().unique(),
    uploadedBy: text("uploaded_by").notNull(),
    uploadedAt: text("uploaded_at").notNull(),
  },
  (t) => [index("ix_document_owner").on(t.ownerType, t.ownerId)],
);

/**
 * The bytes, for files stored in the database. Kept apart from the registry
 * so listing documents never drags file contents over the wire.
 */
export const appDocumentContent = sqliteTable("app_document_content", {
  documentId: integer("document_id")
    .primaryKey()
    .references(() => appDocument.id, { onDelete: "cascade" }),
  bytes: blob("bytes", { mode: "buffer" }).notNull(),
});

/* -------------------------------------------------------------- access log */

/**
 * Who read whose personal data, and when.
 *
 * Writes already leave a trail — every infotype row carries created_by and
 * every workflow keeps a history table — but reads left none, so nobody could
 * answer "who has looked at my salary". This answers it for the screens that
 * show pay, bank details, tax and documents.
 *
 * No foreign keys, deliberately: the log must outlive the records it
 * mentions, including a deleted employee.
 */
export const appAccessLog = sqliteTable(
  "app_access_log",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    at: text("at").notNull(),
    userId: integer("user_id").notNull(),
    username: text("username").notNull(),
    /** The person whose data was read, when there is one. */
    subjectEmployeeId: integer("subject_employee_id"),
    /** What was read: "payslip", "form16", "infotype 0008", "document". */
    resource: text("resource").notNull(),
    resourceId: text("resource_id"),
  },
  (t) => [
    index("ix_access_subject").on(t.subjectEmployeeId, t.at),
    index("ix_access_user").on(t.userId, t.at),
  ],
);
