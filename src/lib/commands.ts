import type { Permission } from "@/lib/permissions";
import { NAV } from "@/lib/nav";

/**
 * What the command menu offers (HANDOVER.md §8.9 Command menu): actions
 * first, then pages, then people once two characters are typed.
 *
 * Every entry names the permissions that show it, the same way the sidebar
 * does, so the menu never offers a page that would only redirect.
 */

export type Command = {
  label: string;
  href: string;
  /** lucide-react icon name, resolved in the menu. */
  icon: string;
  /** Shown to anyone holding at least one of these. */
  anyOf: Permission[];
  /** Other words someone might type for this. */
  keywords?: string;
};


/** Pages everyone signed in has: an empty list means no permission is needed. */
const ALL_SIGNED_IN: Permission[] = [];

export const ACTIONS: Command[] = [
  { label: "See who changed what", href: "/change-log", icon: "History", anyOf: ["audit.view"], keywords: "audit history trail" },
  { label: "Hire an employee", href: "/core-hr/hire", icon: "UserPlus", anyOf: ["employee.edit"], keywords: "new joiner onboard" },
  { label: "Run payroll", href: "/payroll/run", icon: "Banknote", anyOf: ["payroll.run"], keywords: "salary pay" },
  { label: "Record an absence", href: "/time/absences", icon: "CalendarDays", anyOf: ["time.manage"], keywords: "leave sick" },
  { label: "Open a requisition", href: "/recruitment/requisitions/new", icon: "Briefcase", anyOf: ["recruitment.manage"], keywords: "vacancy job opening post role" },
  { label: "Screen new applications", href: "/recruitment/pipeline?stage=Applied", icon: "UserPlus", anyOf: ["recruitment.manage"], keywords: "applicants candidates review shortlist" },
  { label: "Record interview notes", href: "/recruitment/my-interviews", icon: "CalendarClock", anyOf: ["recruitment.interview"], keywords: "feedback candidate rating" },
  { label: "Convert an offered candidate", href: "/recruitment/hire", icon: "UserCheck", anyOf: ["recruitment.hire"], keywords: "hire offer" },
  { label: "Connect the ERP", href: "/admin/integrations/new", icon: "Plug", anyOf: ["integrations.manage"], keywords: "api client secret integration" },
  { label: "Build the tax register", href: "/tax/register", icon: "ReceiptText", anyOf: ["tax.manage"], keywords: "tds challan quarter" },
  { label: "Generate Form 16", href: "/tax/form16", icon: "FileBadge", anyOf: ["tax.manage"], keywords: "certificate tax" },
  { label: "Review requests waiting for me", href: "/approvals", icon: "Inbox", anyOf: ["employee.view_team", "leave.decide_any"], keywords: "approve reject" },
  { label: "Rate my team", href: "/performance/ratings", icon: "Target", anyOf: ["performance.rate_team"], keywords: "appraisal review" },
  { label: "Apply for leave", href: "/time/my-leave", icon: "CalendarCheck", anyOf: ["self.leave"], keywords: "holiday time off" },
  { label: "Declare tax investments", href: "/tax/declarations", icon: "ReceiptText", anyOf: ["self.tax"], keywords: "80c 80d regime" },
  { label: "Write my self review", href: "/performance/mine", icon: "ClipboardCheck", anyOf: ["self.appraisal"], keywords: "appraisal" },
];

/** Pages below the sidebar's top level, so the menu reaches every screen. */
const SUBPAGES: Command[] = [
  { label: "Companies", href: "/org/companies", icon: "Network", anyOf: ["org.view"] },
  { label: "Personnel areas", href: "/org/personnel-areas", icon: "Network", anyOf: ["org.view"], keywords: "location" },
  { label: "Sub-areas", href: "/org/sub-areas", icon: "Network", anyOf: ["org.view"] },
  { label: "Jobs", href: "/org/jobs", icon: "Network", anyOf: ["org.view"] },
  { label: "Departments", href: "/org/departments", icon: "Network", anyOf: ["org.view"], keywords: "org unit" },
  { label: "Positions", href: "/org/positions", icon: "Network", anyOf: ["org.view"], keywords: "vacancy" },
  { label: "Reporting lines", href: "/org/reporting-lines", icon: "Network", anyOf: ["org.view"], keywords: "manager" },
  { label: "Org chart", href: "/org/chart", icon: "Network", anyOf: ["org.view"], keywords: "tree hierarchy" },
  { label: "Mass update", href: "/core-hr/mass-update", icon: "Users", anyOf: ["employee.edit"], keywords: "bulk" },
  { label: "Absences", href: "/time/absences", icon: "CalendarDays", anyOf: ["time.manage"] },
  { label: "Team calendar", href: "/time/calendar", icon: "CalendarRange", anyOf: ["time.team_calendar"], keywords: "away leave who" },
  { label: "Attendance", href: "/time/attendances", icon: "CalendarDays", anyOf: ["time.manage"], keywords: "overtime" },
  { label: "Leave quotas", href: "/time/quotas", icon: "CalendarDays", anyOf: ["time.manage"], keywords: "entitlement balance" },
  { label: "Time evaluation", href: "/time/evaluation", icon: "CalendarDays", anyOf: ["time.manage"] },
  { label: "Work schedules", href: "/time/schedules", icon: "CalendarDays", anyOf: ["time.manage"], keywords: "shift" },
  { label: "Public holidays", href: "/time/holidays", icon: "CalendarDays", anyOf: ["time.manage"] },
  { label: "Holiday calendars", href: "/time/holiday-calendars", icon: "CalendarDays", anyOf: ["time.manage"], keywords: "region state" },
  { label: "Leave policies", href: "/time/leave-policies", icon: "CalendarDays", anyOf: ["time.manage"], keywords: "accrual entitlement" },
  { label: "Shifts", href: "/time/shifts", icon: "CalendarDays", anyOf: ["time.manage"] },
  { label: "Roster patterns", href: "/time/roster-patterns", icon: "CalendarDays", anyOf: ["time.manage"], keywords: "rotation cycle" },
  { label: "Roster", href: "/time/roster", icon: "CalendarDays", anyOf: ["time.manage"], keywords: "planner assign team" },
  { label: "Today's board", href: "/time/attendance-board", icon: "CalendarDays", anyOf: ["time.manage"], keywords: "punch late absent" },
  { label: "Devices", href: "/time/devices", icon: "CalendarDays", anyOf: ["time.manage"], keywords: "punch clock" },
  { label: "My attendance", href: "/time/my-attendance", icon: "Fingerprint", anyOf: ["self.attendance"], keywords: "regularise punch roster" },
  { label: "Payroll periods", href: "/payroll/periods", icon: "Banknote", anyOf: ["payroll.view"], keywords: "lock post" },
  { label: "Wage types", href: "/payroll/wage-types", icon: "Banknote", anyOf: ["payroll.setup"], keywords: "allowance deduction" },
  { label: "Salary structures", href: "/payroll/salary-structures", icon: "Banknote", anyOf: ["payroll.setup"], keywords: "ctc components" },
  { label: "Statutory rates", href: "/payroll/statutory-rates", icon: "Banknote", anyOf: ["payroll.setup"], keywords: "pf esi professional tax lwf" },
  { label: "GL mapping", href: "/payroll/gl-mapping", icon: "Banknote", anyOf: ["payroll.setup"], keywords: "account ledger" },
  { label: "Recurring payments", href: "/payroll/recurring", icon: "Banknote", anyOf: ["payroll.setup"] },
  { label: "One-off payments", href: "/payroll/additional", icon: "Banknote", anyOf: ["payroll.setup"], keywords: "bonus additional" },
  { label: "Bank file, ledger and remittances", href: "/payroll/posting", icon: "Banknote", anyOf: ["payroll.view"], keywords: "neft gl posting epfo ecr" },
  { label: "Claims", href: "/loans-claims/claims", icon: "ReceiptIndianRupee", anyOf: ["payroll.setup"], keywords: "reimbursement bill" },
  { label: "Claim categories", href: "/loans-claims/categories", icon: "ReceiptIndianRupee", anyOf: ["payroll.setup"], keywords: "fuel phone medical lta limit" },
  { label: "Loan benchmark rate", href: "/loans-claims/benchmark-rate", icon: "Landmark", anyOf: ["payroll.setup"], keywords: "perquisite concessional sbi" },
  { label: "Requisitions", href: "/recruitment/requisitions", icon: "UserPlus", anyOf: ["recruitment.manage"] },
  { label: "Candidates", href: "/recruitment/candidates", icon: "UserPlus", anyOf: ["recruitment.manage"], keywords: "resume" },
  { label: "Applications", href: "/recruitment/pipeline", icon: "UserPlus", anyOf: ["recruitment.manage"], keywords: "pipeline stage applicants" },
  { label: "Interviews", href: "/recruitment/interviews", icon: "CalendarClock", anyOf: ["recruitment.manage"], keywords: "rounds schedule" },
  { label: "Careers page", href: "/careers", icon: "Globe", anyOf: ["recruitment.manage"], keywords: "jobs public apply openings" },
  { label: "Appraisal cycles", href: "/performance/cycles", icon: "Target", anyOf: ["performance.manage"] },
  { label: "Goals", href: "/performance/goals", icon: "Target", anyOf: ["performance.rate_any", "performance.rate_team"], keywords: "kra objective" },
  { label: "Ratings", href: "/performance/ratings", icon: "Target", anyOf: ["performance.rate_any", "performance.rate_team"] },
  { label: "Calibration", href: "/performance/calibration", icon: "Target", anyOf: ["performance.manage"] },
  { label: "Increments", href: "/performance/increments", icon: "Target", anyOf: ["performance.manage"], keywords: "raise salary" },
  { label: "Tax sections and slabs", href: "/tax/sections", icon: "ReceiptText", anyOf: ["tax.manage"] },
  { label: "Tax declarations", href: "/tax/declarations", icon: "ReceiptText", anyOf: ["tax.manage"] },
  { label: "Deduction register", href: "/tax/register", icon: "ReceiptText", anyOf: ["tax.manage"], keywords: "tds 24q" },
  { label: "Record ownership", href: "/admin/integrations/ownership", icon: "Plug", anyOf: ["integrations.manage"], keywords: "erp owner master" },
  { label: "Sync issues", href: "/admin/integrations/sync-issues", icon: "Plug", anyOf: ["integrations.manage"], keywords: "erp failed error" },
  { label: "Reconciliation", href: "/admin/integrations/reconciliation", icon: "Plug", anyOf: ["integrations.manage"], keywords: "erp journal ledger booked" },
  { label: "Notifications", href: "/inbox", icon: "Bell", anyOf: ALL_SIGNED_IN, keywords: "inbox alerts unread" },
  { label: "Notification preferences", href: "/inbox/preferences", icon: "Bell", anyOf: ALL_SIGNED_IN, keywords: "email settings" },
  { label: "Hand my approvals to someone while I am away", href: "/me#away", icon: "CircleUser", anyOf: ["self.profile"], keywords: "delegate holiday leave" },
];

export const PAGES: Command[] = [
  { label: "Home", href: "/", icon: "House", anyOf: ALL_SIGNED_IN, keywords: "dashboard" },
  ...NAV.flatMap((g) => g.items.map(({ label, href, icon, anyOf }) => ({ label, href, icon, anyOf }))),
  ...SUBPAGES,
];

export function commandsFor(permissions: ReadonlySet<Permission>): { actions: Command[]; pages: Command[] } {
  const allowed = (c: Command) => c.anyOf.length === 0 || c.anyOf.some((p) => permissions.has(p));
  const seen = new Set<string>();
  const pages = PAGES.filter(allowed).filter((p) => {
    if (seen.has(p.href)) return false;
    seen.add(p.href);
    return true;
  });
  return { actions: ACTIONS.filter(allowed), pages };
}

/** Case-insensitive match on the label and keywords, every word present. */
export function matches(c: Command, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = `${c.label} ${c.keywords ?? ""}`.toLowerCase();
  return q.split(/\s+/).every((word) => hay.includes(word));
}
