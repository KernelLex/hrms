import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { requirePage } from "@/lib/access";
import { db } from "@/lib/db";
import { pySalaryStructure, pySalaryStructureComponent, pyWageType } from "@/db/schema";
import { PageHeader } from "@/components/ui";
import { PayrollTabs } from "../../tabs";
import { StructureComponentsForm } from "./form";

export default async function SalaryStructureDetailPage(props: { params: Promise<{ code: string }> }) {
  await requirePage(["payroll.setup"], "/payroll/my-payslips");
  const { code } = await props.params;

  const [structure, components, wageTypes] = await Promise.all([
    db.query.pySalaryStructure.findFirst({ where: eq(pySalaryStructure.code, code) }),
    db.select().from(pySalaryStructureComponent).where(eq(pySalaryStructureComponent.structureCode, code)).orderBy(asc(pySalaryStructureComponent.sortOrder)),
    db.select().from(pyWageType).where(eq(pyWageType.kind, "Earning")).orderBy(asc(pyWageType.sortOrder)),
  ]);
  if (!structure) notFound();

  return (
    <>
      <PayrollTabs />
      <PageHeader title={structure.name} subtitle={`Structure ${structure.code}.`} back={{ href: "/payroll/salary-structures", label: "Salary structures" }} />
      <StructureComponentsForm
        structureCode={structure.code}
        wageTypes={wageTypes.map((w) => ({ value: w.code, label: `${w.name} (${w.code})` }))}
        initial={components.map((c, i) => ({
          key: i,
          wageTypeCode: c.wageTypeCode,
          componentType: c.componentType as "PercentOfCTC" | "PercentOfBasic" | "Fixed" | "Balancing",
          percent: c.percentBasisPoints ? String(c.percentBasisPoints / 100) : "",
          fixedAmount: c.fixedAmountPaise ? String(c.fixedAmountPaise / 100) : "",
        }))}
      />
    </>
  );
}
