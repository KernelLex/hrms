import { notFound, redirect } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { can, inScope, requirePage } from "@/lib/access";
import { omPosition } from "@/db/schema";
import { getEmployee, fullName } from "@/lib/repositories/employees";
import { PageHeader, Card, EmptyState, ButtonLink } from "@/components/ui";
import { TrendingUp } from "lucide-react";
import { PromoteForm } from "./form";

export default async function PromotePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePage(["employee.edit"]);
  if (!can(session, "pay.view")) redirect("/core-hr");
  const { id } = await params;
  const employeeId = Number(id);
  if (!Number.isInteger(employeeId)) notFound();
  const employee = await getEmployee(employeeId);
  if (!employee) notFound();
  if (!(await inScope(session, employeeId))) notFound();
  if (employee.employment_status === "Terminated") redirect(`/core-hr/${employeeId}`);

  const vacantPositions = await db
    .select()
    .from(omPosition)
    .where(and(eq(omPosition.isVacant, true), eq(omPosition.isActive, true)))
    .orderBy(asc(omPosition.code));

  const back = { href: `/core-hr/${employeeId}`, label: fullName(employee) };

  if (vacantPositions.length === 0) {
    return (
      <>
        <PageHeader back={back} title="Promote" subtitle="Moves them into a new, higher position with new pay." />
        <Card>
          <EmptyState
            icon={<TrendingUp />}
            title="No vacant positions"
            action={
              <ButtonLink href="/org/positions" variant="primary">
                Open a position
              </ButtonLink>
            }
          >
            Every position is filled. Free one, or create a new one, before promoting.
          </EmptyState>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader back={back} title={`Promote ${fullName(employee)}`} subtitle="Moves them into a new, higher position with new pay, from an effective date." />
      <PromoteForm
        employeeId={employeeId}
        positions={vacantPositions.map((p) => ({ value: p.code, label: `${p.code} — ${p.title}` }))}
      />
    </>
  );
}
