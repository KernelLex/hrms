import { can, getAccess } from "@/lib/access";
import { logAccess } from "@/lib/access-log";
import { searchEmployees, fullName } from "@/lib/repositories/employees";
import { csvResponse, rupees, toCsv } from "@/lib/csv";
import { todayInIndia } from "@/lib/dates";

/** The employee list as CSV, with the same filters as the screen. HR only. */
export async function GET(req: Request) {
  const session = await getAccess();
  if (!session) return new Response("Sign in first.", { status: 401 });
  if (!can(session, "reports.view") || !can(session, "employee.view_all")) return new Response("Not allowed.", { status: 403 });

  const url = new URL(req.url);
  const filter = {
    q: url.searchParams.get("q") ?? undefined,
    status: url.searchParams.get("status") ?? undefined,
    unit: url.searchParams.get("unit") ?? undefined,
    scope: session.scope,
  };
  const seesPay = can(session, "pay.view");
  const { rows } = await searchEmployees(filter, { limit: 100_000, offset: 0 });

  logAccess(session, { subjectEmployeeId: null, resource: "employee list export" });

  return csvResponse(
    toCsv([
      [
        "Employee number", "Name", "Status", "Joined", "Position", "Department", "Company", "Cost centre",
        ...(seesPay ? ["Pay group", "Monthly basic pay (INR)"] : []),
      ],
      ...rows.map((e) => [
        e.employee_number,
        fullName(e),
        e.employment_status,
        e.hire_date,
        e.position_title,
        e.org_unit_name,
        e.company_code,
        e.cost_center,
        ...(seesPay ? [e.pay_scale_group, e.amount_paise === null ? null : rupees(e.amount_paise)] : []),
      ]),
    ]),
    `employees-${todayInIndia()}.csv`,
  );
}
