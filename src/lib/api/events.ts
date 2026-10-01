import "server-only";
import { createHmac, randomBytes } from "node:crypto";
import type { InStatement } from "@libsql/client";
import { rawClient } from "@/lib/db";
import { todayInIndia } from "@/lib/dates";
import type { Scope } from "./scopes";

/**
 * Events: what changed, for the ERP.
 *
 * Every write already records a change-log entry, in the same transaction as
 * the write wherever the write is one. Events are derived from those
 * entries, in order, so there is never an event for a change that did not
 * happen, and none is missed. Each event is stored once (`int_event`, whose
 * id is the sequence the pull feed pages by), then shaped for each client —
 * salary and bank details only for clients holding those scopes — and
 * delivered to its webhook subscriptions through the outbox, signed to the
 * Standard Webhooks specification, retried with backoff, and parked for
 * replay if it keeps failing. A client is not sent its own changes back.
 */

export const EVENT_TYPES = {
  "employee.hired": { scope: "employees:read", description: "Someone was hired — on the screen, through recruitment or through the API. `data` is the employee." },
  "employee.updated": { scope: "employees:read", description: "Any of an employee's dated records changed. `data` is the employee as of today." },
  "employee.status_changed": { scope: "employees:read", description: "An employee went on leave, came back, or was terminated. `data` is the employee." },
  "org.changed": { scope: "org:read", description: "A company, personnel area, sub-area, job or department was created, changed or removed. `data` says which." },
  "position.changed": { scope: "org:read", description: "A position or its reporting line changed. `data` names the position." },
  "cost_centre.changed": { scope: "org:read", description: "A cost centre was created or changed. `data` is the cost centre." },
  "leave.requested": { scope: "time:read", description: "Someone asked for leave. `data` is the request." },
  "leave.approved": { scope: "time:read", description: "A leave request was approved. `data` is the request." },
  "leave.rejected": { scope: "time:read", description: "A leave request was rejected. `data` is the request." },
  "leave.cancelled": { scope: "time:read", description: "A leave request was withdrawn. `data` is the request." },
  "absence.recorded": { scope: "time:read", description: "An absence was recorded — approved leave, or entered by HR or the ERP. `data` is the absence." },
  "absence.removed": { scope: "time:read", description: "An absence was removed. `data` has its id." },
  "payroll.run.completed": { scope: "payroll:read", description: "A payroll run finished calculating. `data` is the run; totals with pay:read." },
  "payroll.period.posted": { scope: "payroll:read", description: "A payroll month was posted: payslips are final. `data` is the period." },
  "gl.posting.created": { scope: "gl:read", description: "A payroll journal was posted, ready to book. `data` is the journal with its lines. Acknowledge it." },
  "payment_batch.created": { scope: "payroll:read", description: "Salaries of a run are ready to pay. `data` is the batch; amounts with pay:read, accounts with bank:read. Confirm it." },
  "payslip.published": {
    scope: "payroll:read",
    description: "A payslip became visible to its employee: its month was posted, or its off-cycle payment made. `data` names it; the PDF is at /payroll/results/{id}/payslip. Net pay with pay:read.",
  },
  "remittance.due": { scope: "payroll:read", description: "A statutory remittance fell due. `data` is the remittance." },
  "remittance.paid": { scope: "payroll:read", description: "A statutory remittance — PF, ESI, TDS, professional tax or LWF — was marked remitted. `data` is the remittance." },
  "change_request.decided": {
    scope: "employees:read",
    description: "HR decided a correction an employee asked for to their record. `data` says what, from when, and the outcome; an approved change also arrives as employee.updated.",
  },
  "candidate.hired": { scope: "recruitment:read", description: "An offered candidate became an employee. `data` has the application and the new employee's id." },
  "appraisal.finalised": { scope: "performance:read", description: "Calibration made a rating final. `data` is the appraisal." },
  "employee.transferred": { scope: "employees:read", description: "An employee moved to a new position, department or company. `data` is the employee." },
  "employee.promoted": { scope: "employees:read", description: "An employee moved into a new position with new pay. `data` is the employee; the new basic pay needs pay:read." },
  "employee.confirmed": { scope: "employees:read", description: "A probation review confirmed someone's employment. `data` is the employee." },
  "onboarding.completed": { scope: "employees:read", description: "A new joiner's onboarding checklist finished — every task done. `data` is the employee." },
  "letter.issued": { scope: "employees:read", description: "A letter was issued to an employee from a template. `data` names it; the PDF is at /letters/{id}/pdf." },
  "headcount_request.decided": {
    scope: "org:read",
    description: "A headcount request was approved or rejected. `data` says which, and the position it opened, if any; an approval also arrives as position.changed.",
  },
  "import.completed": { scope: "org:read", description: "A bulk import finished. `data` is its counts: written, already on record, and could not be read." },
  "leave_balance.changed": {
    scope: "time:read",
    description: "A leave balance moved — accrual, use, a carry-forward, a lapse, an encashment or a manual adjustment. `data` is the balance and what last moved it.",
  },
  "leave.encashed": { scope: "time:read", description: "Leave was encashed at the policy's daily rate, queued as a one-off payment. `data` is the payment; the amount needs pay:read." },
  "attendance.day_finalised": {
    scope: "time:read",
    description: "A rostered day's punches were turned into worked minutes, a late mark, and overtime if any. `data` is the attendance day.",
  },
  "regularisation.decided": { scope: "time:read", description: "An attendance correction was approved or rejected. `data` says which; an approval also arrives as attendance.day_finalised." },
  "loan.approved": { scope: "payroll:read", description: "A loan was approved and its EMI schedule generated. `data` is the loan from GET /loans, with its schedule — book the receivable from it. Amounts need pay:read." },
  "loan.closed": { scope: "payroll:read", description: "A loan recovered its last instalment, was prepaid in full, or was closed by hand. `data` is the loan; amounts need pay:read." },
  "claim.approved": { scope: "payroll:read", description: "A reimbursement claim was approved, on screen or sent in already approved by the ERP. `data` is the claim; the amount needs pay:read." },
  "claim.paid": { scope: "payroll:read", description: "An approved claim was queued to be paid, on the wage type its category's taxability picked — CLAIM if taxable, REIMB if not. `data` is the payment; the amount needs pay:read." },
} as const satisfies Record<string, { scope: Scope; description: string }>;

export type EventType = keyof typeof EVENT_TYPES;
export const ALL_EVENT_TYPES = Object.keys(EVENT_TYPES) as EventType[];

type ChangeRow = {
  id: number;
  at: string;
  actor_type: string;
  actor_id: number | null;
  entity: string;
  entity_id: string;
  subject_employee_id: number | null;
  action: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
};

type Derived = { type: EventType; subject: string; key: string };

const ORG_KINDS: Record<string, string> = {
  om_company: "company",
  om_personnel_area: "personnel_area",
  om_personnel_sub_area: "personnel_sub_area",
  om_job: "job",
  om_org_unit: "department",
};

/** Which event a change-log entry is, if any. */
export function eventFor(c: ChangeRow): Derived | null {
  const after = c.after ?? {};
  const emp = (type: EventType, id: number | string) => ({ type, subject: `employees/${id}`, key: `${type}:${id}` });
  if (c.entity === "pa_employee") {
    if (c.action === "create") return emp("employee.hired", c.entity_id);
    if ("employment_status" in after) return emp("employee.status_changed", c.entity_id);
    return emp("employee.updated", c.entity_id);
  }
  if (c.entity === "pa_it0000_action" && c.subject_employee_id) {
    const actionType = String(after.action_type ?? "");
    if (actionType === "Transfer") return emp("employee.transferred", c.subject_employee_id);
    if (actionType === "Promotion") return emp("employee.promoted", c.subject_employee_id);
  }
  if (c.entity === "pa_it0019_monitoring" && c.action === "update" && after.status === "Confirmed" && c.subject_employee_id) {
    return emp("employee.confirmed", c.subject_employee_id);
  }
  if (c.entity === "pa_checklist" && c.action === "update" && after.completed_at && c.subject_employee_id) {
    return emp("onboarding.completed", c.subject_employee_id);
  }
  if (c.entity === "pa_letter" && c.action === "create") {
    return { type: "letter.issued", subject: `letters/${c.entity_id}`, key: `letter:${c.entity_id}` };
  }
  if (c.entity === "om_headcount_request" && (after.status === "Approved" || after.status === "Rejected")) {
    return { type: "headcount_request.decided", subject: `headcount-requests/${c.entity_id}`, key: `hcr:${c.entity_id}` };
  }
  if (c.entity === "app_import" && after.status === "Completed") {
    return { type: "import.completed", subject: `imports/${c.entity_id}`, key: `import:${c.entity_id}` };
  }
  // A bulk import seeds an opening balance with a composite "employee:type:year"
  // id rather than the row's own — silent, like py_opening_balance, which has
  // no event either.
  if (c.entity === "pt_it2006_absence_quota" && /^\d+$/.test(c.entity_id)) {
    return { type: "leave_balance.changed", subject: `leave-balances/${c.entity_id}`, key: `bal:${c.entity_id}` };
  }
  if (c.entity === "py_it0015_additional_payment" && c.action === "create" && after.wage_type_code === "LENC") {
    return { type: "leave.encashed", subject: `payments/${c.entity_id}`, key: `lenc:${c.entity_id}` };
  }
  if (c.entity === "py_it0015_additional_payment" && c.action === "create" && (after.wage_type_code === "CLAIM" || after.wage_type_code === "REIMB")) {
    return { type: "claim.paid", subject: `payments/${c.entity_id}`, key: `claimpay:${c.entity_id}` };
  }
  // Closing reaches the log three ways — the last instalment queued, a full
  // prepayment, or HR closing it by hand — so either signal counts.
  if (c.entity === "py_loan" && c.action === "update" && (after.status === "Closed" || after.closed === true)) {
    return { type: "loan.closed", subject: `loans/${c.entity_id}`, key: `loanclosed:${c.entity_id}` };
  }
  if (c.entity === "py_loan" && c.action === "update" && after.status === "Active") {
    return { type: "loan.approved", subject: `loans/${c.entity_id}`, key: `loanappr:${c.entity_id}` };
  }
  if (c.entity === "py_claim" && (c.action === "create" || c.action === "update") && after.status === "Approved") {
    return { type: "claim.approved", subject: `claims/${c.entity_id}`, key: `claimappr:${c.entity_id}` };
  }
  if (c.entity === "pt_attendance_day") {
    return { type: "attendance.day_finalised", subject: `attendance-days/${c.entity_id}`, key: `attday:${c.entity_id}` };
  }
  if (c.entity === "pt_regularisation" && (after.status === "Approved" || after.status === "Rejected")) {
    return { type: "regularisation.decided", subject: `regularisations/${c.entity_id}`, key: `reg:${c.entity_id}` };
  }
  if (c.entity.startsWith("pa_it") && c.subject_employee_id) return emp("employee.updated", c.subject_employee_id);
  if (c.entity in ORG_KINDS) {
    return { type: "org.changed", subject: `org/${ORG_KINDS[c.entity]}/${c.entity_id}`, key: `org:${c.entity}:${c.entity_id}` };
  }
  if (c.entity === "om_position") return { type: "position.changed", subject: `positions/${c.entity_id}`, key: `pos:${c.entity_id}` };
  if (c.entity === "om_reporting_line") {
    const code = String((c.after ?? c.before ?? {}).position_code ?? "");
    return code ? { type: "position.changed", subject: `positions/${code}`, key: `pos:${code}` } : null;
  }
  if (c.entity === "om_cost_centre") return { type: "cost_centre.changed", subject: `cost-centres/${c.entity_id}`, key: `cc:${c.entity_id}` };
  if (c.entity === "pt_leave_request") {
    const status = String(after.status ?? "");
    const type: EventType | null =
      c.action === "create"
        ? "leave.requested"
        : status === "Approved"
          ? "leave.approved"
          : status === "Rejected"
            ? "leave.rejected"
            : status === "Cancelled"
              ? "leave.cancelled"
              : null;
    return type ? { type, subject: `leave-requests/${c.entity_id}`, key: `${type}:${c.entity_id}` } : null;
  }
  if (c.entity === "pt_it2001_absence") {
    if (c.action === "create") return { type: "absence.recorded", subject: `absences/${c.entity_id}`, key: `abs+:${c.entity_id}` };
    if (c.action === "delete") return { type: "absence.removed", subject: `absences/${c.entity_id}`, key: `abs-:${c.entity_id}` };
    return null;
  }
  if (c.entity === "py_payroll_run" && after.status === "Completed") {
    return { type: "payroll.run.completed", subject: `payroll/runs/${c.entity_id}`, key: `run:${c.entity_id}` };
  }
  if (c.entity === "py_payroll_period" && after.status === "Posted") {
    return { type: "payroll.period.posted", subject: `payroll/periods/${c.entity_id}`, key: `period:${c.entity_id}` };
  }
  if (c.entity === "py_gl_posting" && (c.action === "create" || after.resent === true)) {
    return { type: "gl.posting.created", subject: `gl-postings/${c.entity_id}`, key: `gl:${c.entity_id}` };
  }
  if (c.entity === "py_bank_transfer_file" && c.action === "create") {
    return { type: "payment_batch.created", subject: `payment-batches/${c.entity_id}`, key: `batch:${c.entity_id}` };
  }
  if (c.entity === "py_statutory_remittance" && c.action === "create") return { type: "remittance.due", subject: `remittances/${c.entity_id}`, key: `rem:${c.entity_id}` };
  if (c.entity === "py_statutory_remittance" && c.action === "update" && after.status === "Remitted") {
    return { type: "remittance.paid", subject: `remittances/${c.entity_id}`, key: `rem-paid:${c.entity_id}` };
  }
  if (c.entity === "py_payroll_result" && after.published_at) {
    return { type: "payslip.published", subject: `payslips/${c.entity_id}`, key: `payslip:${c.entity_id}` };
  }
  if (c.entity === "pa_change_request" && (after.status === "Approved" || after.status === "Rejected")) {
    return { type: "change_request.decided", subject: `change-requests/${c.entity_id}`, key: `cr:${c.entity_id}` };
  }
  if (c.entity === "rc_application" && after.stage === "Hired") return { type: "candidate.hired", subject: `applications/${c.entity_id}`, key: `hired:${c.entity_id}` };
  if (c.entity === "pm_calibration" && after.status === "Finalised") {
    return { type: "appraisal.finalised", subject: `appraisals/${c.entity_id}`, key: `final:${c.entity_id}` };
  }
  return null;
}

/* ---------------------------------------------------------------- data */

const one = async (sql: string, args: (string | number)[]) =>
  (await rawClient().execute({ sql, args })).rows[0] as Record<string, unknown> | undefined;

/** The record the event is about, in full; shaped per client when sent. */
async function dataFor(type: EventType, subject: string, change: ChangeRow): Promise<Record<string, unknown> | null> {
  const id = subject.split("/").pop()!;
  const [{ loadEmployees }, { absenceOf }, payroll] = await Promise.all([
    import("./resources/employees"),
    import("./resources/time"),
    import("./resources/payroll"),
  ]);
  switch (type) {
    case "employee.hired":
    case "employee.updated":
    case "employee.status_changed": {
      const [rep] = await loadEmployees([Number(id)], todayInIndia(), { pay: true, bank: true });
      return rep ?? null;
    }
    case "org.changed":
      return { kind: subject.split("/")[1], code: id, action: change.action };
    case "position.changed":
      return { code: id, action: change.entity === "om_position" ? change.action : "update" };
    case "cost_centre.changed": {
      const r = await one("SELECT * FROM om_cost_centre WHERE code = ?", [id]);
      return r ? { code: String(r.code), name: String(r.name), company: r.company_code ?? null, is_active: Number(r.is_active) === 1, updated_at: String(r.updated_at) } : null;
    }
    case "leave.requested":
    case "leave.approved":
    case "leave.rejected":
    case "leave.cancelled": {
      const r = await one("SELECT * FROM pt_leave_request WHERE id = ?", [Number(id)]);
      return r
        ? {
            id: Number(r.id),
            employee_id: Number(r.employee_id),
            absence_type: String(r.absence_type_code),
            from_date: String(r.from_date),
            to_date: String(r.to_date),
            working_days: Number(r.payroll_days),
            status: String(r.status),
          }
        : null;
    }
    case "absence.recorded": {
      const r = await one("SELECT * FROM pt_it2001_absence WHERE id = ?", [Number(id)]);
      return r ? absenceOf(r) : null;
    }
    case "absence.removed":
      return { id: Number(id), employee_id: change.subject_employee_id };
    case "payroll.run.completed": {
      const r = await one("SELECT * FROM py_payroll_run WHERE id = ?", [Number(id)]);
      if (!r) return null;
      const { money } = await import("./format");
      return {
        id: Number(r.id),
        period_id: Number(r.period_id),
        run_type: String(r.run_type),
        employee_count: Number(r.employee_count),
        error_count: Number(r.error_count),
        gross_total: money(Number(r.gross_total_paise)),
        net_total: money(Number(r.net_total_paise)),
        completed_at: r.completed_at ?? null,
      };
    }
    case "payroll.period.posted": {
      const r = await one("SELECT * FROM py_payroll_period WHERE id = ?", [Number(id)]);
      return r ? { id: Number(r.id), personnel_area: String(r.area_code), year: Number(r.year), month: Number(r.month), pay_date: r.pay_date ?? null, posted_at: r.posted_at ?? null } : null;
    }
    case "gl.posting.created": {
      const r = await one("SELECT * FROM py_gl_posting WHERE id = ?", [Number(id)]);
      return r ? ((await payroll.glPostingReps([r]))[0] as Record<string, unknown>) : null;
    }
    case "payment_batch.created": {
      const r = await one("SELECT * FROM py_bank_transfer_file WHERE id = ?", [Number(id)]);
      return r ? ((await payroll.paymentBatches({ has: () => true }, [r]))[0] as Record<string, unknown>) : null;
    }
    case "remittance.due":
    case "remittance.paid": {
      const r = await one("SELECT * FROM py_statutory_remittance WHERE id = ?", [Number(id)]);
      return r ? payroll.remittanceOf(r) : null;
    }
    case "payslip.published": {
      const r = await one(
        `SELECT r.id, r.employee_id, r.run_id, r.net_paise, r.published_at, p.year, p.month, run.run_type
         FROM py_payroll_result r JOIN py_payroll_run run ON run.id = r.run_id JOIN py_payroll_period p ON p.id = run.period_id
         WHERE r.id = ?`,
        [Number(id)],
      );
      if (!r) return null;
      const { money } = await import("./format");
      return {
        result_id: Number(r.id),
        employee_id: Number(r.employee_id),
        run_id: Number(r.run_id),
        run_type: String(r.run_type),
        year: Number(r.year),
        month: Number(r.month),
        net_pay: money(Number(r.net_paise)),
        published_at: r.published_at ?? null,
      };
    }
    case "change_request.decided": {
      const r = await one("SELECT * FROM pa_change_request WHERE id = ?", [Number(id)]);
      return r
        ? {
            id: Number(r.id),
            employee_id: Number(r.employee_id),
            section: String(r.section),
            subtype: r.subtype ?? null,
            effective_date: String(r.effective_date),
            status: String(r.status),
            decided_at: r.decided_at ?? null,
          }
        : null;
    }
    case "candidate.hired": {
      const r = await one("SELECT * FROM rc_hire_conversion WHERE application_id = ?", [Number(id)]);
      return { application_id: Number(id), employee_id: r ? Number(r.employee_id) : null, hire_date: r?.hire_date ?? null };
    }
    case "appraisal.finalised": {
      const r = await one(
        "SELECT a.id, a.cycle_id, a.employee_id, c.calibrated_rating, c.finalised_at FROM pm_calibration c JOIN pm_appraisal a ON a.id = c.appraisal_id WHERE c.id = ?",
        [Number(id)],
      );
      return r ? { id: Number(r.id), cycle_id: Number(r.cycle_id), employee_id: Number(r.employee_id), final_rating: Number(r.calibrated_rating), finalised_at: r.finalised_at ?? null } : null;
    }
    case "employee.transferred":
    case "employee.promoted":
    case "employee.confirmed":
    case "onboarding.completed": {
      const [rep] = await loadEmployees([Number(id)], todayInIndia(), { pay: true, bank: true });
      return rep ?? null;
    }
    case "letter.issued": {
      const r = await one("SELECT * FROM pa_letter WHERE id = ?", [Number(id)]);
      return r
        ? { id: Number(r.id), employee_id: Number(r.employee_id), kind: String(r.kind), issue_date: String(r.issue_date), issued_at: String(r.issued_at) }
        : null;
    }
    case "headcount_request.decided": {
      const r = await one("SELECT * FROM om_headcount_request WHERE id = ?", [Number(id)]);
      if (!r) return null;
      const { money } = await import("./format");
      return {
        id: Number(r.id),
        org_unit_code: String(r.org_unit_code),
        job_code: String(r.job_code),
        title: String(r.title),
        grade: r.grade ?? null,
        budget: money(Number(r.budget_paise)),
        status: String(r.status),
        position_code: r.position_code ?? null,
        decided_at: r.decided_at ?? null,
      };
    }
    case "import.completed": {
      const r = await one("SELECT * FROM app_import WHERE id = ?", [Number(id)]);
      return r
        ? {
            id: Number(r.id),
            kind: String(r.kind),
            total_rows: Number(r.total_rows),
            written_rows: Number(r.written_rows),
            skipped_rows: Number(r.skipped_rows),
            error_rows: Number(r.error_rows),
            finished_at: r.finished_at ?? null,
          }
        : null;
    }
    case "leave_balance.changed": {
      const r = await one("SELECT * FROM pt_it2006_absence_quota WHERE id = ?", [Number(id)]);
      if (!r) return null;
      const last = await one(
        "SELECT entry_type, half_days, note FROM pt_quota_ledger WHERE employee_id = ? AND quota_type_code = ? AND year = ? ORDER BY id DESC LIMIT 1",
        [Number(r.employee_id), String(r.quota_type_code), Number(r.year)],
      );
      return {
        employee_id: Number(r.employee_id),
        quota_type: String(r.quota_type_code),
        year: Number(r.year),
        entitled_days: Number(r.entitled_half_days) / 2,
        used_days: Number(r.used_half_days) / 2,
        remaining_days: (Number(r.entitled_half_days) - Number(r.used_half_days)) / 2,
        last_change: last ? { type: String(last.entry_type), days: Number(last.half_days) / 2, note: last.note ?? null } : null,
      };
    }
    case "leave.encashed": {
      const r = await one("SELECT * FROM py_it0015_additional_payment WHERE id = ?", [Number(id)]);
      if (!r) return null;
      const { money } = await import("./format");
      return {
        id: Number(r.id),
        employee_id: Number(r.employee_id),
        payment_date: String(r.payment_date),
        amount: money(Number(r.amount_paise)),
      };
    }
    case "claim.paid": {
      const r = await one(
        `SELECT p.id, p.employee_id, p.wage_type_code, p.amount_paise, p.payment_date, c.id AS claim_id, c.category_code
         FROM py_it0015_additional_payment p JOIN py_claim c ON c.additional_payment_id = p.id
         WHERE p.id = ?`,
        [Number(id)],
      );
      if (!r) return null;
      const { money } = await import("./format");
      return {
        id: Number(r.id),
        claim_id: Number(r.claim_id),
        employee_id: Number(r.employee_id),
        category: String(r.category_code),
        wage_type: String(r.wage_type_code),
        amount: money(Number(r.amount_paise)),
        payment_date: String(r.payment_date),
      };
    }
    case "claim.approved": {
      const r = await one("SELECT * FROM py_claim WHERE id = ?", [Number(id)]);
      if (!r) return null;
      const { money } = await import("./format");
      return {
        id: Number(r.id),
        employee_id: Number(r.employee_id),
        category: String(r.category_code),
        claim_date: String(r.claim_date),
        total_amount: money(Number(r.total_amount_paise)),
        status: String(r.status),
        decided_at: r.decided_at ?? null,
      };
    }
    case "loan.approved":
    case "loan.closed": {
      const r = await one("SELECT * FROM py_loan WHERE id = ?", [Number(id)]);
      if (!r) return null;
      const scheduleRows = (
        await rawClient().execute({ sql: "SELECT * FROM py_loan_schedule WHERE loan_id = ? ORDER BY installment_no", args: [Number(id)] })
      ).rows as unknown as Record<string, unknown>[];
      const { money } = await import("./format");
      return {
        id: Number(r.id),
        employee_id: Number(r.employee_id),
        loan_type: String(r.loan_type),
        principal: money(Number(r.principal_paise)),
        annual_rate_percent: Number(r.annual_rate_basis_points) / 100,
        tenure_months: Number(r.tenure_months),
        emi: money(Number(r.emi_paise)),
        start_date: String(r.start_date),
        status: String(r.status),
        decided_at: r.decided_at ?? null,
        schedule: scheduleRows.map((l) => ({
          installment_no: Number(l.installment_no),
          due_date: String(l.due_date),
          principal: money(Number(l.principal_paise)),
          interest: money(Number(l.interest_paise)),
          closing_balance: money(Number(l.closing_balance_paise)),
          perquisite_value: money(Number(l.perquisite_value_paise)),
        })),
      };
    }
    case "attendance.day_finalised": {
      const r = await one("SELECT * FROM pt_attendance_day WHERE id = ?", [Number(id)]);
      if (!r) return null;
      return {
        id: Number(r.id),
        employee_id: Number(r.employee_id),
        date: String(r.date),
        shift: r.shift_code === null ? null : String(r.shift_code),
        first_in: r.first_in === null ? null : String(r.first_in),
        last_out: r.last_out === null ? null : String(r.last_out),
        worked_minutes: Number(r.worked_minutes),
        late_minutes: Number(r.late_minutes),
        overtime_minutes: Number(r.overtime_minutes),
        status: String(r.status),
      };
    }
    case "regularisation.decided": {
      const r = await one("SELECT * FROM pt_regularisation WHERE id = ?", [Number(id)]);
      if (!r) return null;
      return {
        id: Number(r.id),
        employee_id: Number(r.employee_id),
        date: String(r.date),
        status: String(r.status),
        decided_at: r.decided_at ?? null,
      };
    }
  }
}

/** Removes what a client's scopes do not cover. */
export function shapeFor(type: EventType, data: Record<string, unknown>, scopes: ReadonlySet<Scope> | Scope[]): Record<string, unknown> {
  const has = (s: Scope) => (Array.isArray(scopes) ? scopes.includes(s) : (scopes as ReadonlySet<Scope>).has(s));
  const out: Record<string, unknown> = { ...data };
  if (type.startsWith("employee.")) {
    if (!has("pay:read")) delete out.basic_pay;
    if (!has("bank:read")) delete out.bank_account;
  }
  if (type === "payslip.published" && !has("pay:read")) delete out.net_pay;
  if (type === "leave.encashed" && !has("pay:read")) delete out.amount;
  if (type === "claim.paid" && !has("pay:read")) delete out.amount;
  if (type === "claim.approved" && !has("pay:read")) delete out.total_amount;
  if ((type === "loan.approved" || type === "loan.closed") && !has("pay:read")) {
    delete out.principal;
    delete out.emi;
    out.schedule = ((data.schedule as Record<string, unknown>[]) ?? []).map((l) => {
      const line = { ...l };
      delete line.principal;
      delete line.interest;
      delete line.closing_balance;
      delete line.perquisite_value;
      return line;
    });
  }
  if (type === "payroll.run.completed" && !has("pay:read")) {
    delete out.gross_total;
    delete out.net_total;
  }
  if (type === "payment_batch.created") {
    if (!has("pay:read")) delete out.total;
    out.lines = ((data.lines as Record<string, unknown>[]) ?? []).map((l) => {
      const line = { ...l };
      if (!has("pay:read")) delete line.amount;
      if (!has("bank:read")) delete line.account_number;
      return line;
    });
  }
  return out;
}

/**
 * Wakes the delivery job: queues it, or brings a queued one waiting on a
 * later retry forward to now, so new webhooks never wait behind old ones.
 */
export function wakeDeliveryStatement(): InStatement {
  const now = new Date().toISOString();
  return {
    sql: `INSERT INTO app_job (kind, payload, dedupe_key, status, attempts, max_attempts, run_after, created_at)
          VALUES ('webhooks.deliver', NULL, 'webhooks.deliver', 'queued', 0, 5, ?1, ?1)
          ON CONFLICT (dedupe_key) DO UPDATE
            SET status = 'queued', run_after = ?1, attempts = 0, last_error = NULL, finished_at = NULL,
                locked_at = NULL, lock_token = NULL
            WHERE app_job.status IN ('done', 'failed', 'queued')`,
    args: [now],
  };
}

/* ------------------------------------------------------------ envelopes */

export type StoredEvent = {
  seq: number;
  eventId: string;
  type: EventType;
  subject: string;
  time: string;
  data: Record<string, unknown>;
  causedByClientPk: number | null;
};

export function envelope(e: StoredEvent, scopes: ReadonlySet<Scope> | Scope[], originClientId: string | null) {
  return {
    specversion: "1.0",
    id: e.eventId,
    type: e.type,
    source: "urn:hrms",
    subject: e.subject,
    time: e.time,
    datacontenttype: "application/json",
    sequence: String(e.seq),
    ...(originClientId ? { originclient: originClientId } : {}),
    data: shapeFor(e.type, e.data, scopes),
  };
}

const toStored = (r: Record<string, unknown>): StoredEvent => ({
  seq: Number(r.id),
  eventId: String(r.event_id),
  type: String(r.type) as EventType,
  subject: String(r.subject),
  time: String(r.time),
  data: JSON.parse(String(r.data)) as Record<string, unknown>,
  causedByClientPk: r.caused_by_client_pk === null ? null : Number(r.caused_by_client_pk),
});

export async function eventsAfter(after: number, limit: number): Promise<StoredEvent[]> {
  const r = await rawClient().execute({ sql: "SELECT * FROM int_event WHERE id > ? ORDER BY id LIMIT ?", args: [after, limit] });
  return r.rows.map((row) => toStored(row as unknown as Record<string, unknown>));
}

/* ------------------------------------------------------------- deriving */

const parse = (v: unknown) => (typeof v === "string" && v ? (JSON.parse(v) as Record<string, unknown>) : null);

/**
 * Turns change-log entries after the cursor into events, and queues their
 * webhook deliveries — all in one write, with the cursor, so a crash midway
 * derives the same events again rather than losing them. Returns how many.
 */
export async function deriveEvents(limit = 500): Promise<number> {
  const cursor = Number((await one("SELECT value FROM app_cursor WHERE name = 'events'", []))?.value ?? 0);
  const r = await rawClient().execute({ sql: "SELECT * FROM app_change_log WHERE id > ? ORDER BY id LIMIT ?", args: [cursor, limit] });
  if (r.rows.length === 0) return 0;
  const changes: ChangeRow[] = r.rows.map((c) => ({
    id: Number(c.id),
    at: String(c.at),
    actor_type: String(c.actor_type),
    actor_id: c.actor_id === null ? null : Number(c.actor_id),
    entity: String(c.entity),
    entity_id: String(c.entity_id),
    subject_employee_id: c.subject_employee_id === null ? null : Number(c.subject_employee_id),
    action: String(c.action),
    before: parse(c.before),
    after: parse(c.after),
  }));

  // Several entries for one thing in one pass — a time slice closed and its
  // successor created — are one event. A hire is not also an update.
  const grouped = new Map<string, { derived: Derived; change: ChangeRow }>();
  for (const c of changes) {
    const d = eventFor(c);
    if (!d) continue;
    if (d.type === "employee.updated" && grouped.has(`employee.hired:${d.subject.split("/")[1]}`)) continue;
    grouped.set(d.key, { derived: d, change: c });
  }

  const statements: InStatement[] = [];
  for (const { derived, change } of grouped.values()) {
    const data = await dataFor(derived.type, derived.subject, change);
    if (!data) continue;
    statements.push({
      sql: `INSERT OR IGNORE INTO int_event (event_id, type, subject, time, data, caused_by_client_pk, change_id)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [
        `evt_${change.id}_${derived.type.replace(/\./g, "_")}`,
        derived.type,
        derived.subject,
        change.at,
        JSON.stringify(data),
        change.actor_type === "client" ? change.actor_id : null,
        change.id,
      ],
    });
  }
  const last = changes[changes.length - 1].id;
  statements.push({ sql: "UPDATE app_cursor SET value = MAX(value, ?) WHERE name = 'events'", args: [last] });
  statements.push({ sql: "INSERT OR IGNORE INTO app_cursor (name, value) VALUES ('events', ?)", args: [last] });
  await rawClient().batch(statements, "write");
  const queued = await queueDeliveries();
  if (queued > 0) await rawClient().execute(wakeDeliveryStatement());
  return grouped.size;
}

/* ------------------------------------------------------------ webhooks */

export const newWebhookSecret = () => `whsec_${randomBytes(24).toString("base64")}`;

/** Standard Webhooks: HMAC-SHA256 over "id.timestamp.body" with the secret's bytes. */
export function signWebhook(secret: string, id: string, timestamp: number, body: string): string {
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  return `v1,${createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64")}`;
}

type Subscription = { id: number; clientPk: number; clientId: string; url: string; types: string[] | null; includeOwn: boolean; scopes: Scope[] };

async function subscriptions(): Promise<Subscription[]> {
  const { parseScopes } = await import("./scopes");
  const r = await rawClient().execute(
    `SELECT w.*, c.client_id AS public_id, c.scopes FROM int_webhook w JOIN int_client c ON c.id = w.client_pk
     WHERE w.active = 1 AND c.status = 'active'`,
  );
  return r.rows.map((w) => ({
    id: Number(w.id),
    clientPk: Number(w.client_pk),
    clientId: String(w.public_id),
    url: String(w.url),
    types: w.event_types ? String(w.event_types).split(",") : null,
    includeOwn: Number(w.include_own) === 1,
    scopes: parseScopes(String(w.scopes)),
  }));
}

export function wants(sub: Subscription, e: StoredEvent): boolean {
  if (!sub.scopes.includes("events:read") || !sub.scopes.includes(EVENT_TYPES[e.type].scope)) return false;
  if (sub.types && !sub.types.includes(e.type)) return false;
  if (!sub.includeOwn && e.causedByClientPk === sub.clientPk) return false;
  return true;
}

/** One outbox row per event and subscription not yet queued. */
async function queueDeliveries(): Promise<number> {
  const cursor = Number((await one("SELECT value FROM app_cursor WHERE name = 'webhooks'", []))?.value ?? 0);
  const events = await eventsAfter(cursor, 1000);
  if (events.length === 0) return 0;
  const subs = await subscriptions();
  const clientIdOf = new Map<number, string>();
  if (events.some((e) => e.causedByClientPk)) {
    const r = await rawClient().execute("SELECT id, client_id FROM int_client");
    for (const c of r.rows) clientIdOf.set(Number(c.id), String(c.client_id));
  }
  const statements: InStatement[] = [];
  for (const e of events) {
    for (const sub of subs) {
      if (!wants(sub, e)) continue;
      statements.push({
        sql: `INSERT INTO app_outbox (channel, dedupe_key, recipient, subject, body_text, payload, status, attempts, created_at)
              VALUES ('webhook', ?, ?, ?, ?, ?, 'queued', 0, ?) ON CONFLICT (dedupe_key) DO NOTHING`,
        args: [
          `wh:${e.eventId}:${sub.id}`,
          sub.url,
          e.type,
          JSON.stringify(envelope(e, sub.scopes, e.causedByClientPk ? (clientIdOf.get(e.causedByClientPk) ?? null) : null)),
          JSON.stringify({ webhook_id: sub.id, client_pk: sub.clientPk, event_id: e.eventId, seq: e.seq }),
          new Date().toISOString(),
        ],
      });
    }
  }
  const last = events[events.length - 1].seq;
  statements.push({ sql: "INSERT OR IGNORE INTO app_cursor (name, value) VALUES ('webhooks', 0)", args: [] });
  statements.push({ sql: "UPDATE app_cursor SET value = MAX(value, ?) WHERE name = 'webhooks'", args: [last] });
  await rawClient().batch(statements, "write");
  return statements.length - 2;
}

export type WebhookRequest = { url: string; headers: Record<string, string>; body: string };
export type WebhookTransport = (req: WebhookRequest) => Promise<{ status: number }>;

const fetchTransport: WebhookTransport = async (req) => {
  const res = await fetch(req.url, { method: "POST", headers: req.headers, body: req.body, signal: AbortSignal.timeout(10_000) });
  return { status: res.status };
};

let transport: WebhookTransport = fetchTransport;

/** For tests and the local sandbox. */
export function setWebhookTransport(next: WebhookTransport | null): void {
  transport = next ?? fetchTransport;
}

export const MAX_WEBHOOK_ATTEMPTS = 10;

/**
 * Sends the webhooks that are due. Each is claimed first, so two workers
 * never send one twice; a failure is retried after 30 seconds, then 1, 2, 4
 * minutes and so on up to an hour, and parked after ten attempts for HR to
 * replay. Returns how many were handled.
 */
export async function deliverWebhooks(limit = 25): Promise<number> {
  const now = new Date().toISOString();
  const claimExpires = new Date(Date.now() + 5 * 60_000).toISOString();
  const claimed = await rawClient().execute({
    sql: `UPDATE app_outbox SET status = 'sending', attempts = attempts + 1, next_attempt_at = ?1
          WHERE id IN (
            SELECT id FROM app_outbox
            WHERE channel = 'webhook'
              AND ((status = 'queued' AND (next_attempt_at IS NULL OR next_attempt_at <= ?2))
                OR (status = 'sending' AND next_attempt_at <= ?2))
            ORDER BY id LIMIT ?3
          )
          RETURNING id, recipient, body_text, payload, attempts`,
    args: [claimExpires, now, limit],
  });
  for (const row of claimed.rows) {
    const payload = JSON.parse(String(row.payload)) as { webhook_id: number; event_id: string };
    const sub = await one("SELECT secret FROM int_webhook WHERE id = ?", [payload.webhook_id]);
    const attempts = Number(row.attempts);
    let status = 0;
    let error: string | null = null;
    if (!sub) {
      error = "The subscription no longer exists.";
    } else {
      const body = String(row.body_text);
      const timestamp = Math.floor(Date.now() / 1000);
      try {
        status = (
          await transport({
            url: String(row.recipient),
            body,
            headers: {
              "Content-Type": "application/cloudevents+json",
              "webhook-id": payload.event_id,
              "webhook-timestamp": String(timestamp),
              "webhook-signature": signWebhook(String(sub.secret), payload.event_id, timestamp, body),
              "User-Agent": "hrms-webhooks/1",
            },
          })
        ).status;
        if (status < 200 || status >= 300) error = `The endpoint answered ${status}.`;
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
      }
    }
    if (!error) {
      await rawClient().execute({
        sql: "UPDATE app_outbox SET status = 'sent', sent_at = ?, last_error = NULL WHERE id = ?",
        args: [new Date().toISOString(), Number(row.id)],
      });
    } else {
      const parked = !sub || attempts >= MAX_WEBHOOK_ATTEMPTS;
      const delay = Math.min(60 * 60_000, 30_000 * 2 ** (attempts - 1));
      await rawClient().execute({
        sql: "UPDATE app_outbox SET status = ?, last_error = ?, next_attempt_at = ? WHERE id = ?",
        args: [parked ? "failed" : "queued", error, new Date(Date.now() + delay).toISOString(), Number(row.id)],
      });
    }
  }
  return claimed.rows.length;
}

/** When the next retry is due, if any. */
export async function nextWebhookRetry(): Promise<number | null> {
  const r = await one("SELECT MIN(next_attempt_at) AS at FROM app_outbox WHERE channel = 'webhook' AND status = 'queued'", []);
  return r?.at ? new Date(String(r.at)).getTime() : null;
}

/** Puts parked or failed deliveries back in the queue. */
export async function replayDeliveries(ids: number[]): Promise<number> {
  if (ids.length === 0) return 0;
  const r = await rawClient().execute({
    sql: `UPDATE app_outbox SET status = 'queued', attempts = 0, next_attempt_at = NULL, last_error = NULL
          WHERE channel = 'webhook' AND status IN ('failed', 'queued') AND id IN (${ids.map(() => "?").join(", ")})`,
    args: ids,
  });
  await rawClient().execute(wakeDeliveryStatement());
  return r.rowsAffected;
}
