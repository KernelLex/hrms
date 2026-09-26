import { readEnv } from "@/lib/env";

/**
 * The seeded demo accounts: one per built-in role, and a recruiter to show a
 * role HR created. The sign-in page lists them
 * and signs straight in on a click; see demoSignInAction.
 */
export const DEMO_ACCOUNTS = [
  {
    username: "hr.admin",
    name: "Priya Sharma",
    role: "HR administrator",
    sees: "The whole back office",
  },
  {
    username: "ravi.kumar",
    name: "Ravi Kumar",
    role: "Manager",
    sees: "Their team's approvals and ratings, and their own records",
  },
  {
    username: "arjun.mehta",
    name: "Arjun Mehta",
    role: "Employee",
    sees: "Their own leave, payslips, tax and appraisal",
  },
  {
    username: "neha.iyer",
    name: "Neha Iyer",
    role: "Recruiter",
    sees: "Requisitions, candidates and interviews, and no pay",
  },
] as const;

export const DEMO_PASSWORD = "demo1234";

/** On unless DEMO_SIGN_IN is set to "off", "false" or "0". */
export function demoSignInEnabled(): boolean {
  const v = readEnv("DEMO_SIGN_IN")?.toLowerCase();
  return !(v === "off" || v === "false" || v === "0");
}
