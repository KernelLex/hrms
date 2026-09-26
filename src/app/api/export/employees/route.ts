import { getSession, hasRole } from "@/lib/auth";
import { logAccess } from "@/lib/access-log";
import { searchEmployees, fullName } from "@/lib/repositories/employees";
import { csvResponse, rupees, toCsv } from "@/lib/csv";
import { todayInIndia } from "@/lib/dates";

/** The employee list as CSV, with the same filters as the screen. HR only. */
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return new Response("Sign in first.", { status: 401 });
  if (!hasRole(session, "HR_ADMIN")) return new Response("Not allowed.", { status: 403 });

  const url = new URL(req.url);
  const filter = {
    q: url.searchParams.get("q") ?? undefined,
    status: url.searchParams.get("status") ?? undefined,
    unit: url.searchParams.get("unit") ?? undefined,
  };
  const { rows } = await searchEmployees(filter, { limit: 100_000, offset: 0 });

  logAccess(session, { subjectEmployeeId: null, resource: "employee list export" });

  return csvResponse(
    toCsv([
      ["Employee number", "Name", "Status", "Joined", "Position", "Department", "Company", "Cost centre", "Pay group", "Monthly basic pay (INR)"],
      ...rows.map((e) => [
        e.employee_number,
        fullName(e),
        e.employment_status,
        e.hire_date,
        e.position_title,
        e.org_unit_name,
        e.company_code,
        e.cost_center,
        e.pay_scale_group,
        e.amount_paise === null ? null : rupees(e.amount_paise),
      ]),
    ]),
    `employees-${todayInIndia()}.csv`,
  );
}
