import type { RoleCode } from "@/db/schema";
import { NAV } from "@/lib/nav";

/**
 * What the command menu offers (DESIGN_LANGUAGE.md §9 Command menu): actions
 * first, then pages, then people once two characters are typed.
 *
 * Every entry names the roles that may see it, the same way the sidebar does,
 * so the menu never offers a page that would only redirect.
 */

export type Command = {
  label: string;
  href: string;
  /** lucide-react icon name, resolved in the menu. */
  icon: string;
  roles: RoleCode[];
  /** Other words someone might type for this. */
  keywords?: string;
};

const ALL: RoleCode[] = ["HR_ADMIN", "MANAGER", "EMPLOYEE"];
const HR: RoleCode[] = ["HR_ADMIN"];
const HR_MGR: RoleCode[] = ["HR_ADMIN", "MANAGER"];

export const ACTIONS: Command[] = [
  { label: "See who changed what", href: "/change-log", icon: "History", roles: HR, keywords: "audit history trail" },
  { label: "Hire an employee", href: "/core-hr/hire", icon: "UserPlus", roles: HR, keywords: "new joiner onboard" },
  { label: "Run payroll", href: "/payroll/run", icon: "Banknote", roles: HR, keywords: "salary pay" },
  { label: "Record an absence", href: "/time/absences", icon: "CalendarDays", roles: HR, keywords: "leave sick" },
  { label: "Open a requisition", href: "/recruitment/requisitions", icon: "Briefcase", roles: HR, keywords: "vacancy job opening" },
  { label: "Convert an offered candidate", href: "/recruitment/hire", icon: "UserCheck", roles: HR, keywords: "hire offer" },
  { label: "Build the tax register", href: "/tax/register", icon: "ReceiptText", roles: HR, keywords: "tds challan quarter" },
  { label: "Generate Form 16", href: "/tax/form16", icon: "FileBadge", roles: HR, keywords: "certificate tax" },
  { label: "Review leave requests", href: "/time/approvals", icon: "Inbox", roles: HR_MGR, keywords: "approve reject" },
  { label: "Rate my team", href: "/performance/ratings", icon: "Target", roles: ["MANAGER"], keywords: "appraisal review" },
  { label: "Apply for leave", href: "/time/my-leave", icon: "CalendarCheck", roles: ["MANAGER", "EMPLOYEE"], keywords: "holiday time off" },
  { label: "Declare tax investments", href: "/tax/declarations", icon: "ReceiptText", roles: ["MANAGER", "EMPLOYEE"], keywords: "80c 80d regime" },
  { label: "Write my self review", href: "/performance/mine", icon: "ClipboardCheck", roles: ["MANAGER", "EMPLOYEE"], keywords: "appraisal" },
];

/** Pages below the sidebar's top level, so the menu reaches every screen. */
const SUBPAGES: Command[] = [
  { label: "Companies", href: "/org/companies", icon: "Network", roles: HR },
  { label: "Personnel areas", href: "/org/personnel-areas", icon: "Network", roles: HR, keywords: "location" },
  { label: "Sub-areas", href: "/org/sub-areas", icon: "Network", roles: HR },
  { label: "Jobs", href: "/org/jobs", icon: "Network", roles: HR },
  { label: "Departments", href: "/org/departments", icon: "Network", roles: HR, keywords: "org unit" },
  { label: "Positions", href: "/org/positions", icon: "Network", roles: HR, keywords: "vacancy" },
  { label: "Reporting lines", href: "/org/reporting-lines", icon: "Network", roles: HR, keywords: "manager" },
  { label: "Org chart", href: "/org/chart", icon: "Network", roles: HR, keywords: "tree hierarchy" },
  { label: "Mass update", href: "/core-hr/mass-update", icon: "Users", roles: HR, keywords: "bulk" },
  { label: "Absences", href: "/time/absences", icon: "CalendarDays", roles: HR },
  { label: "Team calendar", href: "/time/calendar", icon: "CalendarRange", roles: HR_MGR, keywords: "away leave who" },
  { label: "Attendance", href: "/time/attendances", icon: "CalendarDays", roles: HR, keywords: "overtime" },
  { label: "Leave quotas", href: "/time/quotas", icon: "CalendarDays", roles: HR, keywords: "entitlement balance" },
  { label: "Time evaluation", href: "/time/evaluation", icon: "CalendarDays", roles: HR },
  { label: "Work schedules", href: "/time/schedules", icon: "CalendarDays", roles: HR, keywords: "shift" },
  { label: "Public holidays", href: "/time/holidays", icon: "CalendarDays", roles: HR },
  { label: "Payroll periods", href: "/payroll/periods", icon: "Banknote", roles: HR, keywords: "lock post" },
  { label: "Wage types", href: "/payroll/wage-types", icon: "Banknote", roles: HR, keywords: "allowance deduction" },
  { label: "Recurring payments", href: "/payroll/recurring", icon: "Banknote", roles: HR },
  { label: "One-off payments", href: "/payroll/additional", icon: "Banknote", roles: HR, keywords: "bonus additional" },
  { label: "Bank file, ledger and remittances", href: "/payroll/posting", icon: "Banknote", roles: HR, keywords: "neft gl posting epfo" },
  { label: "Requisitions", href: "/recruitment/requisitions", icon: "UserPlus", roles: HR },
  { label: "Candidates", href: "/recruitment/candidates", icon: "UserPlus", roles: HR, keywords: "resume" },
  { label: "Pipeline", href: "/recruitment/pipeline", icon: "UserPlus", roles: HR, keywords: "stage" },
  { label: "Interviews", href: "/recruitment/interviews", icon: "UserPlus", roles: HR },
  { label: "Appraisal cycles", href: "/performance/cycles", icon: "Target", roles: HR },
  { label: "Goals", href: "/performance/goals", icon: "Target", roles: HR_MGR, keywords: "kra objective" },
  { label: "Ratings", href: "/performance/ratings", icon: "Target", roles: HR_MGR },
  { label: "Calibration", href: "/performance/calibration", icon: "Target", roles: HR },
  { label: "Increments", href: "/performance/increments", icon: "Target", roles: HR, keywords: "raise salary" },
  { label: "Tax sections and slabs", href: "/tax/sections", icon: "ReceiptText", roles: HR },
  { label: "Tax declarations", href: "/tax/declarations", icon: "ReceiptText", roles: HR },
  { label: "Deduction register", href: "/tax/register", icon: "ReceiptText", roles: HR, keywords: "tds 24q" },
  { label: "Notifications", href: "/inbox", icon: "Bell", roles: ALL, keywords: "inbox alerts unread" },
  { label: "Notification preferences", href: "/inbox/preferences", icon: "Bell", roles: ALL, keywords: "email settings" },
];

export const PAGES: Command[] = [
  { label: "Home", href: "/", icon: "House", roles: ALL, keywords: "dashboard" },
  ...NAV.flatMap((g) => g.items.map((i) => ({ ...i }))),
  ...SUBPAGES,
];

export function commandsFor(roles: RoleCode[]): { actions: Command[]; pages: Command[] } {
  const allowed = (c: Command) => c.roles.some((r) => roles.includes(r));
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
