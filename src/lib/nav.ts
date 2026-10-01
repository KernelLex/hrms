import type { Permission } from "@/lib/permissions";

/**
 * Sidebar navigation (HANDOVER.md §8.9).
 *
 * Group labels are sentence case, as are item labels. Each item names the
 * permissions that show it — any one of them — so what someone sees follows
 * what their roles let them do, and a role HR creates gets a sidebar that
 * fits it without code.
 */

export type NavItem = {
  label: string;
  href: string;
  /** lucide-react icon name, resolved in the shell. */
  icon: string;
  /** Shown to anyone holding at least one of these. */
  anyOf: Permission[];
  /** Hidden from anyone holding this: they reach the page another way. */
  hideWith?: Permission;
};

export type NavGroup = {
  label: string;
  items: NavItem[];
};

export const NAV: NavGroup[] = [
  {
    label: "Organisation",
    items: [
      { label: "My profile", href: "/me", icon: "CircleUser", anyOf: ["self.profile"] },
      { label: "Org structure", href: "/org", icon: "Network", anyOf: ["org.view"] },
      { label: "Employees", href: "/core-hr", icon: "Users", anyOf: ["employee.view_all"] },
      { label: "Probation due", href: "/core-hr/probation", icon: "UserCheck", anyOf: ["employee.edit"] },
      { label: "Reports", href: "/reports", icon: "ChartBar", anyOf: ["reports.view"] },
      { label: "My team", href: "/core-hr", icon: "Users", anyOf: ["employee.view_team"] },
      { label: "My tasks", href: "/tasks", icon: "ListChecks", anyOf: ["self.profile"] },
      { label: "Headcount requests", href: "/headcount-requests", icon: "Users2", anyOf: ["employee.view_team", "org.edit"] },
      { label: "Exits", href: "/exits", icon: "LogOut", anyOf: ["employee.edit"] },
      { label: "Resign", href: "/exit", icon: "DoorOpen", anyOf: ["self.exit"] },
    ],
  },
  {
    label: "Time",
    items: [
      { label: "Time and absence", href: "/time", icon: "CalendarDays", anyOf: ["time.manage"] },
      { label: "Approvals", href: "/approvals", icon: "Inbox", anyOf: ["employee.view_team", "leave.decide_any"] },
      { label: "Team calendar", href: "/time/calendar", icon: "CalendarRange", anyOf: ["time.team_calendar"], hideWith: "time.manage" },
      { label: "My leave", href: "/time/my-leave", icon: "CalendarCheck", anyOf: ["self.leave"] },
      { label: "My attendance", href: "/time/my-attendance", icon: "Fingerprint", anyOf: ["self.attendance"] },
    ],
  },
  {
    label: "Money",
    items: [
      { label: "Payroll", href: "/payroll", icon: "Banknote", anyOf: ["payroll.view", "payroll.setup"] },
      { label: "Tax and Form 16", href: "/tax", icon: "ReceiptText", anyOf: ["tax.manage"] },
      { label: "Loans and claims", href: "/loans-claims", icon: "HandCoins", anyOf: ["payroll.setup"] },
      { label: "My payslips", href: "/payroll/my-payslips", icon: "FileText", anyOf: ["self.pay"] },
      { label: "My tax declaration", href: "/tax/declarations", icon: "ReceiptText", anyOf: ["self.tax"] },
      { label: "My Form 16", href: "/tax/form16", icon: "FileBadge", anyOf: ["self.tax"] },
      { label: "My loans", href: "/loans-claims/my-loans", icon: "Landmark", anyOf: ["self.loans"] },
      { label: "My claims", href: "/loans-claims/my-claims", icon: "ReceiptIndianRupee", anyOf: ["self.claims"] },
    ],
  },
  {
    label: "Talent",
    items: [
      { label: "Recruitment", href: "/recruitment", icon: "UserPlus", anyOf: ["recruitment.manage"] },
      { label: "Recruitment analytics", href: "/recruitment/analytics", icon: "ChartBar", anyOf: ["recruitment.manage"] },
      { label: "My interviews", href: "/recruitment/my-interviews", icon: "CalendarClock", anyOf: ["recruitment.interview"] },
      { label: "Refer someone", href: "/refer", icon: "UserPlus", anyOf: ["self.profile"] },
      { label: "Performance", href: "/performance", icon: "Target", anyOf: ["performance.manage", "performance.rate_any", "performance.rate_team"] },
      { label: "My appraisal", href: "/performance/mine", icon: "ClipboardCheck", anyOf: ["self.appraisal"] },
      { label: "Training", href: "/training", icon: "FileBadge", anyOf: ["training.manage"] },
      { label: "My training", href: "/training/my-training", icon: "FileBadge", anyOf: ["self.training"] },
    ],
  },
  {
    label: "Admin",
    items: [
      { label: "Roles and permissions", href: "/admin/roles", icon: "ShieldCheck", anyOf: ["access.manage"] },
      { label: "Approval flows", href: "/admin/approval-flows", icon: "Workflow", anyOf: ["access.manage"] },
      { label: "Letter templates", href: "/core-hr/letter-templates", icon: "FileText", anyOf: ["employee.edit"] },
      { label: "Integrations", href: "/admin/integrations", icon: "Plug", anyOf: ["integrations.manage"] },
      { label: "Change log", href: "/change-log", icon: "History", anyOf: ["audit.view"] },
      { label: "Outbox", href: "/outbox", icon: "Mail", anyOf: ["audit.view"] },
    ],
  },
];

export function navFor(permissions: ReadonlySet<Permission>): NavGroup[] {
  // One entry per address: someone who may see everyone and their team sees
  // "Employees", not that and "My team" pointing at the same screen.
  const seen = new Set<string>();
  return NAV.map((g) => ({
    ...g,
    items: g.items.filter((i) => {
      if (!i.anyOf.some((p) => permissions.has(p)) || seen.has(i.href)) return false;
      if (i.hideWith && permissions.has(i.hideWith)) return false;
      seen.add(i.href);
      return true;
    }),
  })).filter((g) => g.items.length > 0);
}
