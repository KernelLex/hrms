import { sqliteTable, text, integer, blob, index, primaryKey } from "drizzle-orm/sqlite-core";

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
    /** Set when an API client read it; `user_id` is then 0. */
    clientPk: integer("client_pk"),
  },
  (t) => [
    index("ix_access_subject").on(t.subjectEmployeeId, t.at),
    index("ix_access_user").on(t.userId, t.at),
  ],
);

/* -------------------------------------------------------------- change log */

/**
 * Every write, before and after: who changed what, when, and on whose record.
 *
 * The other half of the access log. Infotype rows always carried created_by,
 * but an update or a delete left no trace of what was there before. `before`
 * and `after` hold only the fields that changed (all of them for a create or
 * a delete), as JSON, with bank account numbers masked.
 *
 * No foreign keys, like the access log: the trail outlives what it describes.
 */
export const appChangeLog = sqliteTable(
  "app_change_log",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    at: text("at").notNull(),
    /** "user", "system", and from phase 12 "client". */
    actorType: text("actor_type").notNull(),
    actorId: integer("actor_id"),
    actorName: text("actor_name").notNull(),
    /** The table changed, such as "pa_it0008_basic_pay". */
    entity: text("entity").notNull(),
    entityId: text("entity_id").notNull(),
    subjectEmployeeId: integer("subject_employee_id"),
    /** "create", "update" or "delete". */
    action: text("action").notNull(),
    before: text("before"),
    after: text("after"),
    reason: text("reason"),
  },
  (t) => [
    index("ix_change_subject").on(t.subjectEmployeeId, t.at),
    index("ix_change_entity").on(t.entity, t.entityId),
    index("ix_change_at").on(t.at),
  ],
);

/* ----------------------------------------------------------- notifications */

/** A message to one person, shown in their inbox. */
export const appNotification = sqliteTable(
  "app_notification",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id").notNull(),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    link: text("link"),
    /** One notification per event and person, however often the event is retried. */
    dedupeKey: text("dedupe_key").notNull().unique(),
    createdAt: text("created_at").notNull(),
    readAt: text("read_at"),
  },
  (t) => [index("ix_notification_user").on(t.userId, t.readAt, t.createdAt)],
);

/** Per person and kind: whether they want it in-app, by email, or not at all. */
export const appNotificationPref = sqliteTable(
  "app_notification_pref",
  {
    userId: integer("user_id").notNull(),
    kind: text("kind").notNull(),
    inApp: integer("in_app", { mode: "boolean" }).notNull().default(true),
    email: integer("email", { mode: "boolean" }).notNull().default(true),
  },
  (t) => [primaryKey({ columns: [t.userId, t.kind] })],
);

/**
 * Everything waiting to leave the system — email today, the ERP's webhooks
 * from phase 12. A message is written here in the same step as whatever
 * caused it and delivered by a job, so a failed delivery is retried rather
 * than lost, and the dedupe key means a retried cause cannot send it twice.
 */
export const appOutbox = sqliteTable(
  "app_outbox",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** "email" today. */
    channel: text("channel").notNull(),
    dedupeKey: text("dedupe_key").notNull().unique(),
    recipient: text("recipient").notNull(),
    subject: text("subject"),
    bodyText: text("body_text"),
    bodyHtml: text("body_html"),
    /** The notification or event it came from, as JSON. */
    payload: text("payload"),
    /**
     * Files to attach, as JSON: what each is and how to make it, not the
     * bytes — a payslip PDF is rendered when the message is sent or opened,
     * so the outbox never holds a copy of anyone's pay.
     */
    attachments: text("attachments"),
    /** "queued", "sent", "recorded" (delivery not configured) or "failed". */
    status: text("status").notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    createdAt: text("created_at").notNull(),
    nextAttemptAt: text("next_attempt_at"),
    sentAt: text("sent_at"),
  },
  (t) => [index("ix_outbox_status").on(t.status, t.nextAttemptAt)],
);

/* -------------------------------------------------------- background jobs */

/**
 * Work done in the background: payroll runs, deliveries, notifications to
 * many people, and the daily schedule. Jobs are claimed with a conditional
 * update, so two workers can never run the same one.
 */
export const appJob = sqliteTable(
  "app_job",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    kind: text("kind").notNull(),
    payload: text("payload"),
    /** A job with a key is queued at most once. */
    dedupeKey: text("dedupe_key").unique(),
    /** "queued", "running", "done" or "failed". */
    status: text("status").notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    runAfter: text("run_after").notNull(),
    lockedAt: text("locked_at"),
    lockToken: text("lock_token"),
    lastError: text("last_error"),
    createdAt: text("created_at").notNull(),
    finishedAt: text("finished_at"),
  },
  (t) => [index("ix_job_due").on(t.status, t.runAfter)],
);

/** Each time a job ran, and how it went. */
export const appJobRun = sqliteTable(
  "app_job_run",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    jobId: integer("job_id"),
    kind: text("kind").notNull(),
    startedAt: text("started_at").notNull(),
    finishedAt: text("finished_at"),
    /** "ok", "retry" or "failed". */
    outcome: text("outcome"),
    detail: text("detail"),
  },
  (t) => [index("ix_job_run_kind").on(t.kind, t.startedAt)],
);

