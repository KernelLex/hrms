/**
 * A letter template's merge fields, and how they are filled in. A plain
 * module: the letter-template screen (which needs the field names, in the
 * browser) and the letters service (which resolves and fills them) both use
 * it.
 */

export const MERGE_FIELD_NAMES = [
  "first_name",
  "last_name",
  "full_name",
  "employee_number",
  "position_title",
  "department",
  "company_name",
  "company_address",
  "hire_date",
  "effective_date",
  "basic_pay",
  "pay_scale_group",
  "today",
] as const;

export type MergeFields = Record<string, string>;

/** Fills a template body's `{{field}}` tokens; anything unrecognised is left as typed. */
export function mergeBody(body: string, fields: MergeFields): string {
  return body.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (whole, name: string) => (name in fields ? fields[name] : whole));
}
