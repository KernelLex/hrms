import { formatDate } from "@/lib/dates";
import { formatINR, formatINRExact } from "@/lib/money";

/**
 * Turns change-log rows into sentences a person can read:
 * "Basic pay from 1 Apr 2025 · Amount ₹65,000 → ₹72,000".
 *
 * Pure, so the employee's Change log tab, the HR-wide log and the tests
 * all read entries the same way.
 */

export type ChangeEntry = {
  entity: string;
  action: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
};

export type ChangeLine = { label: string; before?: string; after?: string };

export type DescribedChange = { title: string; lines: ChangeLine[] };

export const ENTITY_LABELS: Record<string, string> = {
  pa_employee: "Employee",
  pa_it0000_action: "Personnel action",
  pa_it0001_org_assignment: "Org assignment",
  pa_it0002_personal_data: "Personal data",
  pa_it0006_address: "Address",
  pa_it0007_planned_working_time: "Working time",
  pa_it0008_basic_pay: "Basic pay",
  pa_it0009_bank_details: "Bank details",
  pa_it0021_family_member: "Family member",
  pa_it0105_communication: "Contact detail",
  om_company: "Company",
  om_personnel_area: "Personnel area",
  om_personnel_sub_area: "Personnel sub-area",
  om_job: "Job",
  om_org_unit: "Department",
  om_position: "Position",
  om_reporting_line: "Reporting line",
  pt_leave_request: "Leave request",
  pt_it2001_absence: "Absence",
  pt_it2002_attendance: "Attendance",
  pt_it2006_absence_quota: "Leave quota",
  pt_work_schedule_rule: "Work schedule",
  pt_holiday: "Holiday",
  py_payroll_period: "Payroll period",
  py_payroll_run: "Payroll run",
  py_wage_type: "Wage type",
  py_it0014_recurring_payment: "Recurring payment",
  py_it0015_additional_payment: "One-off payment",
  py_bank_transfer_file: "Bank transfer file",
  py_gl_posting: "Accounting posting",
  py_statutory_remittance: "Statutory remittance",
  pm_appraisal_cycle: "Appraisal cycle",
  pm_goal: "Goal",
  pm_appraisal: "Appraisal",
  pm_calibration: "Calibration",
  pm_increment_recommendation: "Increment",
  rc_requisition: "Requisition",
  rc_candidate: "Candidate",
  rc_application: "Application",
  rc_interview: "Interview",
  tds_section_master: "Tax section",
  tds_employee_declaration: "Tax declaration",
  tds_deduction_register: "TDS register",
  tds_form16: "Form 16",
  app_document: "Document",
};

export function entityLabel(entity: string): string {
  return ENTITY_LABELS[entity] ?? sentence(entity.replace(/^[a-z]+_(it\d{4}_)?/, ""));
}

/** Names that read better than the column's. */
const FIELD_LABELS: Record<string, string> = {
  amount_paise: "Amount",
  current_salary_paise: "Current salary",
  new_salary_paise: "New salary",
  increment_basis_points: "Increment",
  gross_paid_paise: "Gross paid",
  tds_deducted_paise: "TDS deducted",
  offered_salary_paise: "Offered salary",
  entitled_half_days: "Entitled",
  used_half_days: "Used",
  payroll_days: "Working days",
  calendar_days: "Calendar days",
  is_vacant: "Vacant",
  is_active: "Active",
  is_half_day: "Half day",
  reports_to_code: "Reports to",
  org_unit_code: "Department",
  position_code: "Position",
  company_code: "Company",
  area_code: "Personnel area",
  sub_area_code: "Sub-area",
  job_code: "Job",
  parent_code: "Parent department",
  cost_center: "Cost centre",
  work_schedule_code: "Work schedule",
  absence_type_code: "Leave type",
  attendance_type_code: "Attendance type",
  quota_type_code: "Quota type",
  pay_scale_group: "Pay scale group",
  pay_scale_type: "Pay scale type",
  pay_scale_area: "Pay scale area",
  account_number: "Account number",
  ifsc: "IFSC",
  holder_name: "Account holder",
  employee_number: "Employee number",
  employment_status: "Status",
  termination_date: "Termination date",
  hire_date: "Hire date",
  first_name: "First name",
  last_name: "Last name",
  date_of_birth: "Date of birth",
  decision_note: "Note",
  decided_by_employee_id: "Decided by",
  valid_from: "From",
  valid_to: "Until",
  comm_type: "Type",
  weightage_percent: "Weightage",
  self_rating: "Self rating",
  manager_rating: "Manager rating",
  calibrated_rating: "Calibrated rating",
  final_rating: "Final rating",
  challan_bsr: "Challan BSR",
  receipt24q: "24Q receipt",
  size_bytes: "Size",
};

/** Keys that identify a row rather than describe it. */
const QUIET = new Set([
  "id",
  "employee_id",
  "seq",
  "created_by",
  "created_at",
  "updated_at",
  "source_request_id",
  "candidate_id",
  "cycle_id",
  "appraisal_id",
  "application_id",
  "requisition_id",
]);

const OPEN_ENDED = "9999-12-31";

function sentence(key: string): string {
  const words = key.replace(/_(paise|code|id)$/, "").replace(/_/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function fieldLabel(key: string): string {
  return FIELD_LABELS[key] ?? sentence(key);
}

/** One value as a person would write it. */
export function formatValue(key: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (key.endsWith("_paise") && typeof value === "number") {
    return value % 100 === 0 ? formatINR(value) : formatINRExact(value);
  }
  if (key === "increment_basis_points" && typeof value === "number") return `${value / 100}%`;
  if (key.endsWith("_half_days") && typeof value === "number") {
    const days = value / 2;
    return `${days} ${days === 1 ? "day" : "days"}`;
  }
  if (key === "weightage_percent") return `${value}%`;
  if (key === "size_bytes" && typeof value === "number") {
    return value >= 1024 * 1024
      ? `${(value / (1024 * 1024)).toFixed(1)} MB`
      : `${Math.max(1, Math.round(value / 1024))} KB`;
  }
  if (key.startsWith("is_") || typeof value === "boolean") {
    return value === true || value === 1 || value === "1" ? "Yes" : "No";
  }
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value === OPEN_ENDED ? "open-ended" : formatDate(value);
  }
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

const visible = (row: Record<string, unknown> | null) =>
  Object.entries(row ?? {}).filter(([k]) => !QUIET.has(k));

/** A title and the lines that say what changed. */
export function describeChange(entry: ChangeEntry): DescribedChange {
  const label = entityLabel(entry.entity);
  const after = entry.after ?? {};
  const before = entry.before ?? {};
  const from = typeof after.valid_from === "string" ? formatDate(after.valid_from) : null;

  if (entry.action === "create") {
    // A new time slice that follows an earlier one: show what moved.
    if (entry.before && Object.keys(entry.before).length > 0) {
      return {
        title: from ? `${label} from ${from}` : `${label} changed`,
        lines: visible(entry.before).map(([k, was]) => ({
          label: fieldLabel(k),
          before: formatValue(k, was),
          after: formatValue(k, after[k]),
        })),
      };
    }
    return {
      title: from ? `${label} added from ${from}` : `${label} added`,
      lines: visible(entry.after)
        .filter(([k, v]) => v !== null && v !== "" && !(k === "valid_to" && v === OPEN_ENDED))
        .filter(([k]) => k !== "valid_from" || !from)
        .map(([k, v]) => ({ label: fieldLabel(k), after: formatValue(k, v) })),
    };
  }

  if (entry.action === "delete") {
    return {
      title: `${label} removed`,
      lines: visible(entry.before)
        .filter(([, v]) => v !== null && v !== "")
        .map(([k, v]) => ({ label: fieldLabel(k), before: formatValue(k, v) })),
    };
  }

  // An update to a time slice that only moves its end is the old record being
  // closed off by a newer one.
  const keys = Object.keys(after);
  if (keys.length === 1 && keys[0] === "valid_to") {
    return {
      title: `${label} closed`,
      lines: [
        {
          label: fieldLabel("valid_to"),
          before: formatValue("valid_to", before.valid_to),
          after: formatValue("valid_to", after.valid_to),
        },
      ],
    };
  }

  return {
    title: `${label} changed`,
    lines: visible(entry.after).map(([k, v]) => ({
      label: fieldLabel(k),
      before: formatValue(k, before[k]),
      after: formatValue(k, v),
    })),
  };
}
