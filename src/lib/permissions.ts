/**
 * What a person can do, one permission at a time.
 *
 * Every Server Function, route and page checks a permission, never a role.
 * Roles are rows HR edits on the Roles and permissions screen: a set of these
 * permissions, and optionally a limit to some companies or personnel areas.
 * The three built-in roles hold exactly the rights they had before
 * permissions existed, so nothing changed until HR changes it.
 *
 * Each permission reads as one plain sentence finishing "Can …", because that
 * is how the roles screen shows it. Sensitive fields — salary, bank accounts —
 * have permissions of their own, so a role can see a person without seeing
 * what they are paid. In phase 12 each permission is also an API scope.
 *
 * Plain module: the roles screen, the seed and the tests read it too.
 */

export const PERMISSION_GROUPS = [
  "Organisation",
  "People",
  "Time and leave",
  "Payroll",
  "Tax",
  "Recruitment",
  "Performance",
  "Reports and records",
  "Administration",
  "Self-service",
] as const;

export type PermissionGroup = (typeof PERMISSION_GROUPS)[number];

type Def = {
  group: PermissionGroup;
  /** Finishes the sentence "Can …". */
  can: string;
  /** Salary, bank, tax identifiers: shown with a marker on the roles screen. */
  sensitive?: boolean;
};

export const PERMISSIONS = {
  "org.view": { group: "Organisation", can: "see the org structure: companies, locations, departments, positions and the chart" },
  "org.edit": { group: "Organisation", can: "change the org structure" },

  "employee.view_all": { group: "People", can: "see every employee's record" },
  "employee.view_team": { group: "People", can: "see the people who report to them, without pay" },
  "employee.edit": { group: "People", can: "hire people and change employee records, including mass updates" },
  "employee.documents": { group: "People", can: "file and remove employee documents" },
  "pay.view": { group: "People", can: "see salaries and pay", sensitive: true },
  "bank.view": { group: "People", can: "see bank account details", sensitive: true },

  "time.manage": { group: "Time and leave", can: "record absences and attendance, generate quotas, run time evaluation, and keep schedules, holidays, shifts, rosters and devices" },
  "time.team_calendar": { group: "Time and leave", can: "see who is away across their team" },
  "leave.decide_any": { group: "Time and leave", can: "decide any leave request, whoever it is waiting for" },

  "payroll.view": { group: "Payroll", can: "see payroll periods, runs and results", sensitive: true },
  "payroll.setup": { group: "Payroll", can: "keep wage types, recurring payments, one-off payments, salary structures, CTC, statutory rates, cost splits, GL mapping, loans and claim categories" },
  "payroll.run": { group: "Payroll", can: "run payroll, including off-cycle runs" },
  "payroll.post": { group: "Payroll", can: "release and post periods, and make bank files, ledger postings and remittances" },

  "tax.manage": { group: "Tax", can: "keep tax sections and slabs, everyone's declarations, the TDS register and Form 16" },

  "recruitment.manage": { group: "Recruitment", can: "manage requisitions, candidates, the pipeline and interviews" },
  "recruitment.hire": { group: "Recruitment", can: "turn an offered candidate into an employee, with their starting pay", sensitive: true },
  "recruitment.interview": { group: "Recruitment", can: "take the interviews assigned to them: see the candidate and the role, and record notes and a recommendation" },

  "performance.manage": { group: "Performance", can: "run appraisal cycles, calibration and increments", sensitive: true },
  "performance.rate_team": { group: "Performance", can: "set goals for and rate the people who report to them" },
  "performance.rate_any": { group: "Performance", can: "set goals for and rate anyone" },

  "reports.view": { group: "Reports and records", can: "see HR reports and download exports", sensitive: true },
  "audit.view": { group: "Reports and records", can: "read the change log, access logs and outbox" },

  "access.manage": { group: "Administration", can: "manage roles, permissions, who holds them, and approval flows" },
  "integrations.manage": { group: "Administration", can: "connect other systems: API clients and their secrets, webhooks, record ownership, sync issues and the reconciliation report", sensitive: true },

  "self.profile": { group: "Self-service", can: "see their own profile, documents and who has viewed them" },
  "self.leave": { group: "Self-service", can: "ask for leave and see their own balances" },
  "self.pay": { group: "Self-service", can: "read their own payslips and CTC breakdown" },
  "self.tax": { group: "Self-service", can: "make their own tax declaration and download their Form 16" },
  "self.appraisal": { group: "Self-service", can: "write their own self review" },
  "self.attendance": { group: "Self-service", can: "see their own roster and attendance, and ask for a day to be corrected" },
  "self.loans": { group: "Self-service", can: "ask for a loan and see their own schedule and balance" },
  "self.claims": { group: "Self-service", can: "submit reimbursement claims with bills and see their own" },
  "self.exit": { group: "Self-service", can: "resign, and see their own exit, clearance and settlement" },
} as const satisfies Record<string, Def>;

export type Permission = keyof typeof PERMISSIONS;

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

const SELF: Permission[] = ["self.profile", "self.leave", "self.pay", "self.tax", "self.appraisal", "self.attendance", "self.loans", "self.claims", "self.exit"];

/**
 * The built-in roles, exactly as they behaved before permissions existed:
 * HR every right except the team-only ones it holds organisation-wide, a
 * manager their team's, an employee their own. Deciding leave is not a
 * permission: it follows the approval flow, which sends a request to the
 * employee's reporting manager.
 */
export const BUILT_IN_ROLES: Record<"HR_ADMIN" | "MANAGER" | "EMPLOYEE", { name: string; description: string; permissions: Permission[] }> = {
  HR_ADMIN: {
    name: "HR administrator",
    description: "Runs the back office: the org structure, employee records, time, payroll, tax, recruitment and performance.",
    permissions: ALL_PERMISSIONS.filter((p) => p !== "employee.view_team" && p !== "performance.rate_team"),
  },
  MANAGER: {
    name: "Manager",
    description: "Approves their team's requests, rates their team, and sees who is away.",
    permissions: ["employee.view_team", "time.team_calendar", "performance.rate_team", "recruitment.interview", ...SELF],
  },
  EMPLOYEE: {
    name: "Employee",
    description: "Acts on their own record: leave, payslips, tax and appraisal.",
    permissions: [...SELF, "recruitment.interview"],
  },
};
