/**
 * Who owns each kind of record by default. Only the owner writes it: the
 * other side reads it, and its writes are refused. HR changes these on the
 * Integrations screen, per record type and, where needed, per field.
 *
 * Plain module: migration 0009, the seed and the screens read it.
 */
export const OWNERSHIP_DEFAULTS: { recordType: string; label: string; owner: "hrms" | "erp"; fields?: string[] }[] = [
  { recordType: "employee", label: "People and their dated records", owner: "hrms", fields: ["first_name", "last_name", "work_email", "cost_centre"] },
  { recordType: "org", label: "Companies, locations, departments and positions", owner: "hrms" },
  { recordType: "absence", label: "Leave and absences", owner: "hrms" },
  { recordType: "payroll", label: "Pay results, payslips and the journal", owner: "hrms" },
  { recordType: "cost_centre", label: "Cost centres", owner: "erp" },
  { recordType: "gl_account", label: "Chart of accounts", owner: "erp" },
  { recordType: "payment", label: "Payments once made: salary credits and remittances", owner: "erp" },
];

export const OWNED_RECORD_TYPES = OWNERSHIP_DEFAULTS.map((o) => o.recordType);
