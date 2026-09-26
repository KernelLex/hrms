import { notFound, redirect } from "next/navigation";
import { getSession, hasRole } from "@/lib/auth";
import { getEmployee, fullName } from "@/lib/repositories/employees";
import { PageHeader, Badge } from "@/components/ui";
import { InfotypeTabs } from "./tabs";

export default async function EmployeeLayout(props: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const session = await getSession();
  if (!hasRole(session, "HR_ADMIN")) redirect("/");

  const { id } = await props.params;
  const employeeId = Number(id);
  if (!Number.isInteger(employeeId)) notFound();

  const employee = await getEmployee(employeeId);
  if (!employee) notFound();

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
      <InfotypeTabs employeeId={employeeId} />
      {props.children}
    </>
  );
}
