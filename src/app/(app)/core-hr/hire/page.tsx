import { asc, eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  omCompany,
  omPersonnelArea,
  omOrgUnit,
  omPosition,
  ptWorkScheduleRule,
} from "@/db/schema";
import { PageHeader, Card, EmptyState, ButtonLink } from "@/components/ui";
import { UserPlus } from "lucide-react";
import { HireForm } from "./form";

/** CH-01 — the hire action, equivalent to SAP's PA40. */
export default async function HirePage() {
  const [companies, areas, units, vacantPositions, schedules] = await Promise.all([
    db.select().from(omCompany).where(eq(omCompany.isActive, true)).orderBy(asc(omCompany.code)),
    db.select().from(omPersonnelArea).orderBy(asc(omPersonnelArea.code)),
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
          title="Hire employee"
          subtitle="A hire fills a vacant position and creates the records payroll needs."
        />
        <Card>
          <EmptyState
            icon={<UserPlus />}
            title="No vacant positions"
            action={
              <ButtonLink href="/org/positions" variant="primary">
                Open a position
              </ButtonLink>
            }
          >
            Every position is filled. Mark one vacant, or create a new one, before hiring.
          </EmptyState>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        back={{ href: "/core-hr", label: "Employees" }}
        title="Hire employee"
        subtitle="Creates the employee, their org assignment, personal data, working time and basic pay together — or not at all."
      />
      <HireForm
        companies={companies.map((c) => ({ value: c.code, label: `${c.code} — ${c.name}` }))}
        areas={areas.map((a) => ({ value: a.code, label: `${a.code} — ${a.name}` }))}
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
