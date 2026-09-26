import { redirect } from "next/navigation";
import { can, getAccess } from "@/lib/access";

export default async function PayrollIndex() {
  const session = await getAccess();
  redirect(
    can(session, "payroll.view")
      ? "/payroll/periods"
      : can(session, "payroll.setup")
        ? "/payroll/wage-types"
        : "/payroll/my-payslips",
  );
}
