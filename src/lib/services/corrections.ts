import "server-only";
import { z } from "zod";
import { rawClient } from "@/lib/db";
import { changeStatement, type Actor as LogActor } from "@/lib/change-log";
import { notificationStatements } from "@/lib/notifications";
import { storeDocument, UploadError, DOCUMENT_OR_IMAGE_TYPES } from "@/lib/storage";
import { formatDate, todayInIndia } from "@/lib/dates";
import { planRequest, writeRequest, cancelStatements, type Actor } from "@/lib/workflow/engine";
import { PROCESSES } from "@/lib/workflow/processes";
import {
  ADDRESS_TYPES,
  CONTACT_TYPES,
  GENDERS,
  MARITAL_STATUSES,
  SECTIONS,
  describeChange,
  type Section,
} from "@/lib/corrections-values";
import type { Result } from "./result";

/**
 * Asking for a correction to one's own record: what changes, from when, with
 * proof where it matters. The request goes through the corrections approval
 * flow (§5.6); approved, it is written through the time-slice engine from
 * its effective date (see `workflow/correction.ts`). My profile and the API
 * both come through here.
 */

type Values = Record<string, string | null>;

const text = (max: number) => z.string().trim().min(1).max(max);
const optional = (max: number) => z.string().trim().max(max).nullable();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a date.");

const SCHEMAS: Record<Section, z.ZodType<Values>> = {
  personal: z.object({
    first_name: text(60),
    last_name: text(60),
    date_of_birth: date.nullable(),
    gender: z.enum(GENDERS).nullable(),
    marital_status: z.enum(MARITAL_STATUSES).nullable(),
    nationality: optional(60),
  }) as z.ZodType<Values>,
  address: z.object({
    line: z.string().trim().min(1, "Enter the address.").max(300),
    city: optional(80),
    state: optional(80),
    postal_code: z.string().trim().regex(/^\d{6}$/, "A PIN code is six digits.").nullable(),
    country: optional(80),
  }) as z.ZodType<Values>,
  contact: z.object({ value: z.string().trim().min(1, "Enter the new value.").max(200) }) as z.ZodType<Values>,
  bank: z.object({
    bank_name: z.string().trim().min(2, "Enter the bank's name.").max(100),
    account_number: z.string().trim().regex(/^\d{9,18}$/, "An account number is 9 to 18 digits."),
    ifsc: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, "An IFSC is 11 characters, such as HDFC0001234."),
    holder_name: z.string().trim().min(2, "Enter the name on the account.").max(120),
  }) as z.ZodType<Values>,
};

const TABLES: Record<Section, string> = {
  personal: "pa_it0002_personal_data",
  address: "pa_it0006_address",
  contact: "pa_it0105_communication",
  bank: "pa_it0009_bank_details",
};

const TYPE_COLUMN: Partial<Record<Section, string>> = { address: "address_type", contact: "comm_type" };

/** The section's values on record on a date, or null if there were none. */
export async function valuesOn(employeeId: number, section: Section, subtype: string | null, on: string): Promise<Values | null> {
  const typeColumn = TYPE_COLUMN[section];
  const r = await rawClient().execute({
    sql: `SELECT * FROM ${TABLES[section]} WHERE employee_id = ? AND valid_from <= ? AND valid_to >= ?
          ${typeColumn ? `AND ${typeColumn} = ?` : ""} ORDER BY valid_from DESC LIMIT 1`,
    args: [employeeId, on, on, ...(typeColumn ? [subtype ?? ""] : [])],
  });
  const row = r.rows[0] as unknown as Record<string, unknown> | undefined;
  if (!row) return null;
  return Object.fromEntries(
    Object.keys(SECTIONS[section].fields).map((f) => [f, row[f] === null || row[f] === undefined ? null : String(row[f])]),
  );
}

export type ChangeInput = {
  employeeId: number;
  section: Section;
  subtype: string | null;
  values: Record<string, unknown>;
  effectiveDate: string;
  note: string | null;
  evidence: File | null;
  channel: "self" | "api";
};

/**
 * Validates and files a request, and starts its approval. The requester is
 * the employee on My profile, or a connected system (with no sign-in of its
 * own) through the API.
 */
export async function submitChangeRequest(
  requester: Omit<Actor, "userId"> & { userId: number | null },
  logActor: LogActor,
  input: ChangeInput,
): Promise<Result<{ id: number; requestId: number }>> {
  const { employeeId, section } = input;
  const def = SECTIONS[section];

  const employee = (
    await rawClient().execute({
      sql: `SELECT e.id, e.hire_date, e.employment_status,
              (SELECT p.first_name || ' ' || p.last_name FROM pa_it0002_personal_data p WHERE p.employee_id = e.id
                ORDER BY p.valid_from DESC LIMIT 1) AS name
            FROM pa_employee e WHERE e.id = ?`,
      args: [employeeId],
    })
  ).rows[0];
  if (!employee) return { error: "That employee does not exist.", code: "not_found" };
  if (String(employee.employment_status) === "Terminated") return { error: "The record of someone who has left cannot be changed this way." };

  // The type decides which record a change replaces.
  let subtype: string | null = null;
  if (section === "address") {
    subtype = (ADDRESS_TYPES as readonly string[]).includes(String(input.subtype)) ? String(input.subtype) : null;
    if (!subtype) return { error: "Choose the address type." };
  } else if (section === "contact") {
    subtype = (CONTACT_TYPES as readonly string[]).includes(String(input.subtype)) ? String(input.subtype) : null;
    if (!subtype) return { error: "Choose which contact detail to change." };
  }

  const blankToNull = Object.fromEntries(
    Object.keys(def.fields).map((f) => {
      const v = input.values[f];
      return [f, typeof v === "string" && v.trim() !== "" ? v : v === undefined || v === "" ? null : v];
    }),
  );
  const parsed = SCHEMAS[section].safeParse(blankToNull);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = String(issue?.path[0] ?? "");
    const label = (def.fields as Record<string, string>)[field];
    return { error: issue?.message && !issue.message.startsWith("Invalid") && !issue.message.startsWith("Too") ? issue.message : `Check the ${label?.toLowerCase() ?? "form"}.` };
  }
  const proposed = parsed.data;
  if (section === "contact" && subtype === "Email (personal)" && !z.email().safeParse(proposed.value).success) {
    return { error: "Enter a valid email address." };
  }
  if (section === "contact" && subtype === "Mobile phone" && !/^[+\d][\d\s-]{6,19}$/.test(String(proposed.value))) {
    return { error: "Enter a phone number, such as +91 98765 43210." };
  }

  const today = todayInIndia();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.effectiveDate)) return { error: "Enter the date the change applies from." };
  if (input.effectiveDate < String(employee.hire_date)) return { error: "A change cannot apply from before the day they joined." };
  // A past bank change would rewrite where salaries already paid went.
  if (section === "bank" && input.effectiveDate < today) return { error: "A bank change applies from today or later." };
  const yearAhead = new Date(Date.now() + 366 * 86_400_000).toISOString().slice(0, 10);
  if (input.effectiveDate > yearAhead) return { error: "A change applies within the next year." };

  const current = await valuesOn(employeeId, section, subtype, input.effectiveDate);
  const changed = Object.keys(def.fields).filter((f) => (current?.[f] ?? null) !== (proposed[f] ?? null));
  if (current && changed.length === 0) return { error: "Nothing has changed." };

  if (section === "bank" && !input.evidence) {
    return { error: "Attach proof of the account: a cancelled cheque or the first page of the passbook." };
  }
  const waiting = await rawClient().execute({
    sql: "SELECT 1 FROM pa_change_request WHERE employee_id = ? AND section = ? AND COALESCE(subtype, '') = ? AND status = 'Pending'",
    args: [employeeId, section, subtype ?? ""],
  });
  if (waiting.rows.length > 0) {
    return { error: `A change to ${describeChange(section, subtype).toLowerCase()} is already waiting. Cancel it first, or wait for the decision.`, code: "conflict" };
  }

  const name = String(employee.name ?? "An employee");
  const summary = `${name}: ${describeChange(section, subtype).toLowerCase()} from ${formatDate(input.effectiveDate)}`;
  const start = {
    process: "correction" as const,
    subjectType: "pa_change_request",
    subjectId: 0,
    subjectEmployeeId: employeeId,
    requester: requester as Actor,
    summary,
    facts: { bank: section === "bank" ? 1 : 0 },
  };
  let plan: Awaited<ReturnType<typeof planRequest>>;
  try {
    plan = await planRequest(start);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "The request could not be started." };
  }

  let evidenceId: number | null = null;
  if (input.evidence) {
    try {
      const doc = await storeDocument({
        ownerType: "employee",
        ownerId: employeeId,
        kind: section === "bank" ? "Bank proof" : section === "address" ? "Address proof" : "Identity proof",
        file: input.evidence,
        uploadedBy: requester.username,
        allowed: DOCUMENT_OR_IMAGE_TYPES,
      });
      evidenceId = doc.id;
    } catch (err) {
      if (err instanceof UploadError) return { error: err.message };
      throw err;
    }
  }

  const notices = await notificationStatements(
    plan.recipients.map((userId) => ({
      userId,
      kind: "approval.waiting" as const,
      title: `Waiting for your approval: ${summary}`,
      body: "An employee asked for their record to be corrected. Compare it with what is on record, then decide.",
      link: PROCESSES.correction.link,
      dedupeKey: `approval.waiting:correction:${employeeId}:${section}:${subtype ?? ""}:${Date.now()}:${userId}`,
    })),
  );

  const at = new Date().toISOString();
  const tx = await rawClient().transaction("write");
  let id: number;
  let requestId: number;
  try {
    const inserted = await tx.execute({
      sql: `INSERT INTO pa_change_request
              (employee_id, section, subtype, proposed, current, effective_date, note, evidence_document_id, status,
               channel, requested_by_user_id, requested_by_name, requested_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Pending', ?, ?, ?, ?) RETURNING id`,
      args: [
        employeeId,
        section,
        subtype,
        JSON.stringify(proposed),
        current ? JSON.stringify(current) : null,
        input.effectiveDate,
        input.note,
        evidenceId,
        input.channel,
        requester.userId,
        requester.displayName,
        at,
      ],
    });
    id = Number(inserted.rows[0].id);
    requestId = await writeRequest(tx, { ...start, subjectId: id }, plan);
    const logged = changeStatement(logActor, {
      entity: "pa_change_request",
      entityId: id,
      subjectEmployeeId: employeeId,
      action: "create",
      // Never the account number in the log: the change itself logs it masked.
      after: { section, subtype, effective_date: input.effectiveDate, status: "Pending", fields: changed.join(", ") },
    });
    for (const st of [...(logged ? [logged] : []), ...notices]) await tx.execute(st);
    await tx.commit();
  } catch (err) {
    await tx.rollback();
    throw err;
  } finally {
    tx.close();
  }
  return { ok: true, value: { id, requestId } };
}

/** Withdraws a request still waiting; only the employee it is about. */
export async function cancelChangeRequest(actor: Actor, logActor: LogActor, id: number): Promise<Result<null>> {
  const r = await rawClient().execute({ sql: "SELECT * FROM pa_change_request WHERE id = ?", args: [id] });
  const row = r.rows[0];
  if (!row || actor.employeeId === null || Number(row.employee_id) !== actor.employeeId) {
    return { error: "That request no longer exists.", code: "not_found" };
  }
  if (String(row.status) !== "Pending") return { error: `That request was already ${String(row.status).toLowerCase()}.` };
  const at = new Date().toISOString();
  const logged = changeStatement(logActor, {
    entity: "pa_change_request",
    entityId: id,
    subjectEmployeeId: actor.employeeId,
    action: "update",
    before: { status: "Pending" },
    after: { status: "Cancelled" },
  });
  await rawClient().batch(
    [
      { sql: "UPDATE pa_change_request SET status = 'Cancelled', decided_at = ? WHERE id = ? AND status = 'Pending'", args: [at, id] },
      ...(await cancelStatements("pa_change_request", id, actor)),
      ...(logged ? [logged] : []),
    ],
    "write",
  );
  return { ok: true, value: null };
}
