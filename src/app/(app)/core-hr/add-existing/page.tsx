import { redirect } from "next/navigation";
import { can, requirePage } from "@/lib/access";
import { asc, eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { omCompany, omOrgUnit, omPosition, ptWorkScheduleRule } from "@/db/schema";
import { PageHeader, Card, EmptyState, ButtonLink } from "@/components/ui";
import { UserPlus } from "lucide-react";
import { ExistingEmployeeForm } from "./form";

/**
 * CH-01b — someone who already works here.
 *
 * The same records a hire writes, without the induction: this system arrived
 * after they did. Their own employee number and joining date are kept, and the
 * bank and statutory details are filed at the same time so the first payroll
 * run can pay them.
 */
export default async function AddExistingEmployeePage() {
  const session = await requirePage(["employee.edit"]);
  if (!can(session, "pay.view")) redirect("/core-hr");

  const [companies, units, vacantPositions, schedules] = await Promise.all([
    db.select().from(omCompany).where(eq(omCompany.isActive, true)).orderBy(asc(omCompany.code)),
    db.select().from(omOrgUnit).orderBy(asc(omOrgUnit.code)),
    db
      .select()
      .from(omPosition)
      .where(and(eq(omPosition.isVacant, true), eq(omPosition.isActive, true)))
      .orderBy(asc(omPosition.code)),
    db.select().from(ptWorkScheduleRule).orderBy(asc(ptWorkScheduleRule.code)),
  ]);

  if (vacantPositions.length === 0) {
    return (
      <>
        <PageHeader
          back={{ href: "/core-hr", label: "Employees" }}
          title="Add an existing employee"
          subtitle="Everyone needs a seat of their own, and every seat is taken."
        />
        <Card>
          <EmptyState
            icon={<UserPlus />}
            title="No vacant positions"
            action={
              <ButtonLink href="/org/imports" variant="primary">
                Import the org structure
              </ButtonLink>
            }
          >
            One position holds one person. Load the structure first — positions, then people — or open a
            position by hand on the Positions tab.
          </EmptyState>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        back={{ href: "/core-hr", label: "Employees" }}
        title="Add an existing employee"
        subtitle="For someone already on the payroll when this system arrived. Keeps their own number and joining date, and files no onboarding checklist or probation review — they were inducted long ago. Loading a whole company at once? Use the import instead."
      />
      <ExistingEmployeeForm
        companies={companies.map((c) => ({ value: c.code, label: `${c.code} — ${c.name}` }))}
        units={units.map((u) => ({ value: u.code, label: `${u.code} — ${u.name}` }))}
        positions={vacantPositions.map((p) => ({
          value: p.code,
          label: `${p.code} — ${p.title}`,
          orgUnitCode: p.orgUnitCode,
        }))}
        schedules={schedules.map((w) => ({ value: w.code, label: w.name }))}
      />
    </>
  );
}
