import { redirect } from "next/navigation";
import { getSession, hasRole } from "@/lib/auth";

export default async function PayrollIndex() {
  const session = await getSession();
  redirect(hasRole(session, "HR_ADMIN") ? "/payroll/periods" : "/payroll/my-payslips");
}
