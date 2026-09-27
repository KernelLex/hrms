/**
 * What an API client may do, one scope at a time. A client is granted scopes
 * on the Integrations screen and may ask for fewer when it takes a token.
 *
 * Sensitive fields have scopes of their own: without `pay:read`, salary and
 * every amount of pay are absent from responses and events — not empty,
 * absent — and the same for `bank:read` and bank account numbers.
 *
 * Plain module: the router, the Integrations screen, the OpenAPI document and
 * API.md all read it.
 */

export const SCOPES = {
  "org:read": "Read companies, personnel areas, departments, jobs, positions and cost centres",
  "org:write": "Write cost centres, which the ERP owns by default",
  "employees:read": "Read employees and their dated records, without pay, bank or tax identifiers",
  "employees:write": "Change the employee fields the ERP owns, and record the ERP's own ids",
  "employees:hire": "Hire people through the hire action, with the same checks as the screens (sets basic pay)",
  "pay:read": "See salaries and every amount of pay: basic pay, pay results, payment amounts",
  "bank:read": "See bank account numbers",
  "tax_ids:read": "See tax identifiers such as PAN, where they are held (none are held yet)",
  "time:read": "Read holidays, absences, leave requests and leave balances",
  "time:write": "Record absences",
  "payroll:read": "Read payroll periods, runs, payment batches and statutory remittances",
  "payroll:write": "Send one-off and recurring payments, and confirm salary and remittance payments",
  "gl:read": "Read the payroll journal (GL postings) and the chart of accounts",
  "gl:write": "Acknowledge or reject journals, and write the accounts the ERP owns",
  "tax:read": "Read the TDS register",
  "recruitment:read": "Read requisitions and applications",
  "performance:read": "Read appraisal cycles and final ratings",
  "events:read": "Read the event feed and deletions, and manage the client's own webhook subscriptions",
} as const;

export type Scope = keyof typeof SCOPES;

export const ALL_SCOPES = Object.keys(SCOPES) as Scope[];

export function isScope(value: string): value is Scope {
  return value in SCOPES;
}

/** What the client's ERP is usually given: everything it needs both ways. */
export const ERP_SCOPES: Scope[] = [
  "org:read",
  "org:write",
  "employees:read",
  "employees:write",
  "pay:read",
  "bank:read",
  "time:read",
  "time:write",
  "payroll:read",
  "payroll:write",
  "gl:read",
  "gl:write",
  "tax:read",
  "events:read",
];

/** Splits a stored or requested scope string, keeping only known scopes. */
export function parseScopes(value: string | null | undefined): Scope[] {
  return [...new Set((value ?? "").split(/[\s,]+/).filter(isScope))];
}
