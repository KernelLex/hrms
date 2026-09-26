import { asc } from "drizzle-orm";
import { db } from "@/lib/db";
import { ptWorkScheduleRule } from "@/db/schema";
import { listEmployees, fullName } from "@/lib/repositories/employees";
import { PageHeader } from "@/components/ui";
import { MassUpdateForm } from "./form";
import { formatINR } from "@/lib/money";

/** CH-05 — mass data maintenance, equivalent to SAP's PA70/PA71. */
export default async function MassUpdatePage() {
  const [employees, schedules] = await Promise.all([
    listEmployees(),
    db.select().from(ptWorkScheduleRule).orderBy(asc(ptWorkScheduleRule.code)),
  ]);

  return (
    <>
      <PageHeader
        back={{ href: "/core-hr", label: "Employees" }}
        title="Mass update"
        subtitle="Applies one change to many employees. Each one is written through the time-slice engine, so a bulk change leaves the same clean history a single edit does."
      />
      <MassUpdateForm
        schedules={schedules.map((s) => ({ value: s.code, label: s.name }))}
        employees={employees.map((e) => ({
          id: e.id,
          name: fullName(e),
          number: e.employee_number,
          unit: e.org_unit_name ?? "—",
          payGroup: e.pay_scale_group ?? "—",
          pay: e.amount_paise !== null ? formatINR(e.amount_paise) : "—",
        }))}
      />
    </>
  );
}
