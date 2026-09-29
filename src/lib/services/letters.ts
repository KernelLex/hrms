import "server-only";
import { rawClient } from "@/lib/db";
import { now } from "@/db/schema";
import { changeStatement, type Actor } from "@/lib/change-log";
import { formatDate } from "@/lib/dates";
import { formatINR } from "@/lib/money";
import { storeDocument } from "@/lib/storage";
import { renderLetterPdf } from "@/lib/documents/letter-pdf";
import { mergeBody, type MergeFields } from "@/lib/lifecycle-values";
import type { Result } from "./result";

/**
 * Letters, from a template's merge fields to the PDF filed on the record.
 * The merged text is kept exactly as issued — reading the record as it
 * stood on the issue date, never regenerated — so it cannot silently change
 * if the person's record or the template is edited afterwards.
 */

const one = async (sql: string, args: (string | number)[]) =>
  (await rawClient().execute({ sql, args })).rows[0] as Record<string, unknown> | undefined;

export async function mergeFieldsFor(employeeId: number, asOf: string): Promise<MergeFields | null> {
  const row = await one(
    `SELECT e.employee_number, e.hire_date,
            p.first_name, p.last_name, p.gender,
            o.company_code, o.org_unit_code, o.cost_center,
            pos.title AS position_title,
            ou.name AS org_unit_name,
            bp.amount_paise, bp.pay_scale_group,
            co.name AS company_name, co.address AS company_address, co.city AS company_city
     FROM pa_employee e
     LEFT JOIN pa_it0002_personal_data p ON p.employee_id = e.id AND p.valid_from <= ?2 AND p.valid_to >= ?2
     LEFT JOIN pa_it0001_org_assignment o ON o.employee_id = e.id AND o.valid_from <= ?2 AND o.valid_to >= ?2
     LEFT JOIN pa_it0008_basic_pay bp ON bp.employee_id = e.id AND bp.valid_from <= ?2 AND bp.valid_to >= ?2
     LEFT JOIN om_position pos ON pos.code = o.position_code
     LEFT JOIN om_org_unit ou ON ou.code = o.org_unit_code
     LEFT JOIN om_company co ON co.code = o.company_code
     WHERE e.id = ?1`,
    [employeeId, asOf],
  );
  if (!row) return null;
  const s = (v: unknown, fallback = "") => (v === null || v === undefined ? fallback : String(v));
  return {
    first_name: s(row.first_name),
    last_name: s(row.last_name),
    full_name: [s(row.first_name), s(row.last_name)].filter(Boolean).join(" "),
    employee_number: s(row.employee_number),
    position_title: s(row.position_title, "—"),
    department: s(row.org_unit_name, "—"),
    company_name: s(row.company_name, "the company"),
    company_address: [row.company_address, row.company_city].filter(Boolean).join(", "),
    hire_date: row.hire_date ? formatDate(String(row.hire_date)) : "—",
    effective_date: formatDate(asOf),
    basic_pay: row.amount_paise !== null && row.amount_paise !== undefined ? formatINR(Number(row.amount_paise)) : "—",
    pay_scale_group: s(row.pay_scale_group, "—"),
    today: formatDate(new Date().toISOString().slice(0, 10)),
  };
}

/** Re-renders an issued letter's PDF from its stored merged text — never from the template, which may have moved on. */
export async function renderIssuedLetter(letter: { employeeId: number; kind: string; issueDate: string; mergedText: string }): Promise<Uint8Array> {
  const fields = await mergeFieldsFor(letter.employeeId, letter.issueDate);
  return renderLetterPdf({ kind: letter.kind, employer: fields?.company_name ?? "the company", text: letter.mergedText, issueDate: letter.issueDate });
}

export type IssueLetterInput = {
  employeeId: number;
  templateId: number;
  issueDate: string;
};

/**
 * Merges the template with the record as of the issue date, renders it to
 * PDF, files it on the employee's record, and keeps the merged text itself
 * so the letter reads the same for good.
 */
export async function issueLetter(actor: Actor, v: IssueLetterInput, issuedBy: string): Promise<Result<{ id: number; documentId: number }>> {
  const [employee, template] = await Promise.all([
    one("SELECT id, employee_number FROM pa_employee WHERE id = ?", [v.employeeId]),
    one("SELECT * FROM pa_letter_template WHERE id = ?", [v.templateId]),
  ]);
  if (!employee) return { error: "That employee does not exist.", code: "not_found" };
  if (!template) return { error: "That letter template no longer exists.", code: "not_found" };

  const fields = await mergeFieldsFor(v.employeeId, v.issueDate);
  if (!fields) return { error: "That employee does not exist.", code: "not_found" };
  const mergedText = mergeBody(String(template.body), fields);
  const kind = String(template.kind);

  const pdf = await renderLetterPdf({ kind, employer: fields.company_name, text: mergedText, issueDate: v.issueDate });
  const fileName = `${kind.toLowerCase().replace(/\s+/g, "-")}-${fields.employee_number}.pdf`;
  const stored = await storeDocument({
    ownerType: "employee",
    ownerId: v.employeeId,
    kind: `${kind} letter`,
    file: new File([new Uint8Array(pdf)], fileName, { type: "application/pdf" }),
    uploadedBy: issuedBy,
  });

  const at = now();
  const inserted = await rawClient().execute({
    sql: `INSERT INTO pa_letter (employee_id, template_id, kind, issue_date, merged_text, document_id, issued_by, issued_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    args: [v.employeeId, v.templateId, kind, v.issueDate, mergedText, stored.id, issuedBy, at],
  });
  const id = Number(inserted.rows[0].id);
  const logged = changeStatement(actor, {
    entity: "pa_letter",
    entityId: id,
    subjectEmployeeId: v.employeeId,
    action: "create",
    after: { kind, issueDate: v.issueDate, templateId: v.templateId },
  });
  if (logged) await rawClient().execute(logged);

  return { ok: true, value: { id, documentId: stored.id } };
}
