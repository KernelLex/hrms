import { sqliteTable, text, integer, index, uniqueIndex, primaryKey } from "drizzle-orm/sqlite-core";

/**
 * The integration API: the client's ERP, and any later system, as registered
 * clients that call this module and receive its events.
 *
 * A client authenticates with an id and a secret (stored hashed; two can be
 * valid at once while a secret is rotated), is limited to scopes and
 * optionally to companies and IP addresses, and every call it makes is
 * logged. Changes become events in `int_event` — the pull feed — and are
 * delivered to each client's webhook subscriptions through the outbox.
 */

export const intClient = sqliteTable("int_client", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  /** The public id the client authenticates with: "cl_…". */
  clientId: text("client_id").notNull().unique(),
  name: text("name").notNull(),
  /** How this system's own ids are labelled in `external_ids`: "erp". */
  systemKey: text("system_key").notNull().default("erp"),
  /** "active" or "suspended". */
  status: text("status").notNull().default("active"),
  /** Space-separated scopes, such as "employees:read pay:read". */
  scopes: text("scopes").notNull().default(""),
  /** Comma-separated company codes, or null for every company. */
  companies: text("companies"),
  /** Comma-separated IP addresses, or null for any. */
  allowedIps: text("allowed_ips"),
  /** Requests a minute before 429. */
  rateLimit: integer("rate_limit").notNull().default(600),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull(),
  lastUsedAt: text("last_used_at"),
});

export const intClientSecret = sqliteTable(
  "int_client_secret",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    clientPk: integer("client_pk")
      .notNull()
      .references(() => intClient.id, { onDelete: "cascade" }),
    /** SHA-256 of the secret; the secret itself is shown once and never stored. */
    secretHash: text("secret_hash").notNull().unique(),
    /** The last four characters, so HR can tell secrets apart. */
    hint: text("hint").notNull(),
    createdAt: text("created_at").notNull(),
    /** Set on the old secret when a new one replaces it: both work until then. */
    expiresAt: text("expires_at"),
    revokedAt: text("revoked_at"),
  },
  (t) => [index("ix_int_secret_client").on(t.clientPk)],
);

/** Every call a client makes. */
export const intRequestLog = sqliteTable(
  "int_request_log",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    clientPk: integer("client_pk"),
    method: text("method").notNull(),
    /** The route as defined, not the URL: "/employees/{id}". */
    route: text("route").notNull(),
    status: integer("status").notNull(),
    durationMs: integer("duration_ms").notNull(),
    correlationId: text("correlation_id").notNull(),
    at: text("at").notNull(),
  },
  (t) => [index("ix_int_request_client").on(t.clientPk, t.at)],
);

/** A POST's first response, replayed when the same Idempotency-Key comes again. */
export const intIdempotency = sqliteTable(
  "int_idempotency",
  {
    clientPk: integer("client_pk").notNull(),
    key: text("key").notNull(),
    method: text("method").notNull(),
    route: text("route").notNull(),
    requestHash: text("request_hash").notNull(),
    /** 0 while the first request is still being handled. */
    status: integer("status").notNull().default(0),
    body: text("body"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.clientPk, t.key] })],
);

/** Another system's id for one of our records, unique both ways. */
export const intExternalRef = sqliteTable(
  "int_external_ref",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    system: text("system").notNull(),
    entity: text("entity").notNull(),
    entityId: text("entity_id").notNull(),
    externalId: text("external_id").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("ux_int_ref_ours").on(t.system, t.entity, t.entityId),
    uniqueIndex("ux_int_ref_theirs").on(t.system, t.entity, t.externalId),
  ],
);

/**
 * Who owns each kind of record, and optionally each field: only the owner
 * writes it. `field` is empty for the whole record.
 */
export const intOwnership = sqliteTable(
  "int_ownership",
  {
    recordType: text("record_type").notNull(),
    field: text("field").notNull().default(""),
    /** "hrms" or "erp". */
    owner: text("owner").notNull(),
    updatedBy: text("updated_by"),
    updatedAt: text("updated_at"),
  },
  (t) => [primaryKey({ columns: [t.recordType, t.field] })],
);

/**
 * Whether the ERP booked what we sent: a journal, a payment batch or a
 * remittance, with its reference or its reason for refusing.
 */
export const intAck = sqliteTable(
  "int_ack",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** "gl_posting", "payment_batch" or "remittance". */
    entity: text("entity").notNull(),
    entityId: text("entity_id").notNull(),
    /** "pending", "acknowledged" or "rejected". */
    state: text("state").notNull().default("pending"),
    reference: text("reference"),
    reason: text("reason"),
    /** What the ERP says it booked, as JSON: {"debit": "…", "credit": "…"}. */
    totals: text("totals"),
    clientPk: integer("client_pk"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [uniqueIndex("ux_int_ack_entity").on(t.entity, t.entityId)],
);

/** What could not be applied automatically, for HR to retry or discard. */
export const intSyncIssue = sqliteTable(
  "int_sync_issue",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    clientPk: integer("client_pk"),
    /** "inbound" or "outbound". */
    direction: text("direction").notNull(),
    /** What it was about: "payment_confirmation", "webhook". */
    kind: text("kind").notNull(),
    reference: text("reference"),
    payload: text("payload"),
    reason: text("reason").notNull(),
    /** "open", "resolved" or "discarded". */
    state: text("state").notNull().default("open"),
    createdAt: text("created_at").notNull(),
    resolvedAt: text("resolved_at"),
    resolvedBy: text("resolved_by"),
  },
  (t) => [index("ix_int_issue_state").on(t.state, t.createdAt)],
);

/**
 * Every event, in order. The id is the sequence the pull feed pages by;
 * `data` is the full record, filtered by each client's scopes when sent.
 */
export const intEvent = sqliteTable(
  "int_event",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    eventId: text("event_id").notNull().unique(),
    type: text("type").notNull(),
    /** The resource it is about: "employees/42". */
    subject: text("subject").notNull(),
    time: text("time").notNull(),
    data: text("data").notNull(),
    /** The client whose change caused it, so it is not sent back to them. */
    causedByClientPk: integer("caused_by_client_pk"),
    /** The last change-log entry it was derived from. */
    changeId: integer("change_id"),
  },
  (t) => [index("ix_int_event_type").on(t.type, t.id)],
);

export const intWebhook = sqliteTable(
  "int_webhook",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    clientPk: integer("client_pk")
      .notNull()
      .references(() => intClient.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    /** "whsec_…", per the Standard Webhooks specification. */
    secret: text("secret").notNull(),
    /** Comma-separated event types, or null for every type the client may see. */
    eventTypes: text("event_types"),
    /** Deliver the client's own changes back to it too. Off by default. */
    includeOwn: integer("include_own", { mode: "boolean" }).notNull().default(false),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("ix_int_webhook_client").on(t.clientPk)],
);

/** Named positions in a stream this module reads, such as the change log. */
export const appCursor = sqliteTable("app_cursor", {
  name: text("name").primaryKey(),
  value: integer("value").notNull().default(0),
});

/* ------------------------------------------------ records the ERP owns */

/** Cost centres, kept in step with the ERP's controlling area. */
export const omCostCentre = sqliteTable("om_cost_centre", {
  code: text("code").primaryKey(),
  name: text("name").notNull(),
  companyCode: text("company_code"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  updatedAt: text("updated_at").notNull(),
});

/** The ERP's chart of accounts, as far as payroll posts to it. */
export const pyGlAccount = sqliteTable("py_gl_account", {
  code: text("code").primaryKey(),
  name: text("name").notNull(),
  /** "expense", "liability" or "asset". */
  kind: text("kind").notNull(),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  updatedAt: text("updated_at").notNull(),
});
