import { notFound } from "next/navigation";
import { can, inScope, requirePage } from "@/lib/access";
import { getEmployee, fullName } from "@/lib/repositories/employees";
import { PageHeader, Badge } from "@/components/ui";
import { InfotypeTabs } from "./tabs";

export default async function EmployeeLayout(props: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const session = await requirePage(["employee.view_all"]);

  const { id } = await props.params;
  const employeeId = Number(id);
  if (!Number.isInteger(employeeId)) notFound();

  const employee = await getEmployee(employeeId);
  if (!employee) notFound();
  // A role limited to some companies or areas cannot open anyone else.
  if (!(await inScope(session, employeeId))) notFound();

  const status = employee.employment_status;

  return (
    <>
      <PageHeader
        back={{ href: "/core-hr", label: "Employees" }}
        title={fullName(employee)}
        subtitle={[
          employee.employee_number,
          employee.position_title,
          employee.org_unit_name,
        ]
          .filter(Boolean)
          .join(", ")}
        badge={
          <Badge
            tone={status === "Active" ? "done" : status === "On leave" ? "waiting" : "neutral"}
            dot
          >
            {status}
          </Badge>
        }
      />
      <InfotypeTabs
        employeeId={employeeId}
        seesPay={can(session, "pay.view")}
        seesBank={can(session, "bank.view")}
        seesChanges={can(session, "audit.view")}
      />
      {props.children}
    </>
  );
}
