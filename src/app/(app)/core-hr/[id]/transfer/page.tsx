import { notFound, redirect } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { inScope, requirePage } from "@/lib/access";
import { omCompany, omOrgUnit, omPersonnelArea, omPosition } from "@/db/schema";
import { getEmployee, fullName } from "@/lib/repositories/employees";
import { PageHeader, Card, EmptyState, ButtonLink } from "@/components/ui";
import { ArrowRightLeft } from "lucide-react";
import { TransferForm } from "./form";

export default async function TransferPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePage(["employee.edit"]);
  const { id } = await params;
  const employeeId = Number(id);
  if (!Number.isInteger(employeeId)) notFound();
  const employee = await getEmployee(employeeId);
  if (!employee) notFound();
  if (!(await inScope(session, employeeId))) notFound();
  if (employee.employment_status === "Terminated") redirect(`/core-hr/${employeeId}`);

  const [companies, areas, units, vacantPositions] = await Promise.all([
    db.select().from(omCompany).where(eq(omCompany.isActive, true)).orderBy(asc(omCompany.code)),
    db.select().from(omPersonnelArea).orderBy(asc(omPersonnelArea.code)),
    db.select().from(omOrgUnit).orderBy(asc(omOrgUnit.code)),
    db
      .select()
      .from(omPosition)
      .where(and(eq(omPosition.isVacant, true), eq(omPosition.isActive, true)))
      .orderBy(asc(omPosition.code)),
  ]);

  const back = { href: `/core-hr/${employeeId}`, label: fullName(employee) };

  if (vacantPositions.length === 0) {
    return (
      <>
        <PageHeader back={back} title="Transfer" subtitle="Moves them to another vacant position, department or company. Pay does not change." />
        <Card>
          <EmptyState
            icon={<ArrowRightLeft />}
            title="No vacant positions"
            action={
              <ButtonLink href="/org/positions" variant="primary">
                Open a position
              </ButtonLink>
            }
          >
            Every position is filled. Free one, or create a new one, before transferring.
          </EmptyState>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader back={back} title={`Transfer ${fullName(employee)}`} subtitle="Moves them to another vacant position, department or company. Pay does not change." />
      <TransferForm
        employeeId={employeeId}
        companies={companies.map((c) => ({ value: c.code, label: `${c.code} — ${c.name}` }))}
        areas={areas.map((a) => ({ value: a.code, label: `${a.code} — ${a.name}` }))}
        units={units.map((u) => ({ value: u.code, label: `${u.code} — ${u.name}` }))}
        positions={vacantPositions.map((p) => ({ value: p.code, label: `${p.code} — ${p.title}`, orgUnitCode: p.orgUnitCode }))}
      />
    </>
  );
}
