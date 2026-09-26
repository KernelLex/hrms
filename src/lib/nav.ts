import type { RoleCode } from "@/db/schema";

/**
 * Sidebar navigation (DESIGN_LANGUAGE.md §9).
 *
 * Group labels are sentence case, as are item labels. Each item declares which
 * roles may see it — the three personas get genuinely different products, not
 * one product with things greyed out.
 */

export type NavItem = {
  label: string;
  href: string;
  /** lucide-react icon name, resolved in the shell. */
  icon: string;
  roles: RoleCode[];
};

export type NavGroup = {
  label: string;
  items: NavItem[];
};

const ALL: RoleCode[] = ["HR_ADMIN", "MANAGER", "EMPLOYEE"];
const HR: RoleCode[] = ["HR_ADMIN"];
const HR_MGR: RoleCode[] = ["HR_ADMIN", "MANAGER"];

export const NAV: NavGroup[] = [
  {
    label: "Organisation",
    items: [
      { label: "My profile", href: "/me", icon: "CircleUser", roles: ["MANAGER", "EMPLOYEE"] },
      { label: "Org structure", href: "/org", icon: "Network", roles: HR },
      { label: "Employees", href: "/core-hr", icon: "Users", roles: HR },
      { label: "Reports", href: "/reports", icon: "ChartBar", roles: HR },
      { label: "My team", href: "/core-hr", icon: "Users", roles: ["MANAGER"] },
    ],
  },
  {
    label: "Time",
    items: [
      { label: "Time and absence", href: "/time", icon: "CalendarDays", roles: HR },
      { label: "Approvals", href: "/time/approvals", icon: "Inbox", roles: HR_MGR },
      { label: "Team calendar", href: "/time/calendar", icon: "CalendarRange", roles: ["MANAGER"] },
      { label: "My leave", href: "/time/my-leave", icon: "CalendarCheck", roles: ALL },
    ],
  },
  {
    label: "Money",
    items: [
      { label: "Payroll", href: "/payroll", icon: "Banknote", roles: HR },
      { label: "Tax and Form 16", href: "/tax", icon: "ReceiptText", roles: HR },
      { label: "My payslips", href: "/payroll/my-payslips", icon: "FileText", roles: ALL },
      { label: "My tax declaration", href: "/tax/declarations", icon: "ReceiptText", roles: ALL },
      { label: "My Form 16", href: "/tax/form16", icon: "FileBadge", roles: ALL },
    ],
  },
  {
    label: "Talent",
    items: [
      { label: "Recruitment", href: "/recruitment", icon: "UserPlus", roles: HR },
      { label: "Performance", href: "/performance", icon: "Target", roles: HR_MGR },
      { label: "My appraisal", href: "/performance/mine", icon: "ClipboardCheck", roles: ALL },
    ],
  },
  {
    label: "Admin",
    items: [
      { label: "Change log", href: "/change-log", icon: "History", roles: HR },
      { label: "Outbox", href: "/outbox", icon: "Mail", roles: HR },
    ],
  },
];

export function navForRoles(roles: RoleCode[]): NavGroup[] {
  // One entry per address: someone who is both HR and a manager sees
  // "Employees", not that and "My team" pointing at the same screen.
  const seen = new Set<string>();
  return NAV.map((g) => ({
    ...g,
    items: g.items.filter((i) => {
      if (!i.roles.some((r) => roles.includes(r)) || seen.has(i.href)) return false;
      seen.add(i.href);
      return true;
    }),
  })).filter((g) => g.items.length > 0);
}

/** The label shown under a person's name in the sidebar footer. */
export function roleLabel(roles: RoleCode[]): string {
  if (roles.includes("HR_ADMIN")) return "HR administrator";
  if (roles.includes("MANAGER")) return "Manager";
  return "Employee";
}
