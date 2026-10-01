import { requirePage } from "@/lib/access";
import { listDepartmentBudgets } from "@/lib/repositories/training";
import { db } from "@/lib/db";
import { omOrgUnit } from "@/db/schema";
import { formatINR } from "@/lib/money";
import { Card, CardHeader, PageHeader, Table, Th, Tr, Td, EmptyState } from "@/components/ui";
import { TrainingTabs } from "../tabs";
import { BudgetForm } from "./form";

/** What each department may spend on training in a year, and what is already committed. */
export default async function BudgetsPage() {
  await requirePage(["training.manage"], "/training/my-training");
  const [budgets, units] = await Promise.all([listDepartmentBudgets(), db.select().from(omOrgUnit)]);

  return (
    <>
      <TrainingTabs />
      <PageHeader title="Training budgets" subtitle="A nomination that would take a department over its allocation for the year is refused when it is approved." />

      <Card>
        <CardHeader title="Set a budget" />
        <div className="px-6 pb-6">
          <BudgetForm units={units.map((u) => ({ code: u.code, name: u.name }))} />
        </div>
      </Card>

      <div className="mt-6">
        <Card>
          {budgets.length === 0 ? (
            <EmptyState title="No budgets set yet" />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Department</Th>
                  <Th numeric>Year</Th>
                  <Th numeric>Allocated</Th>
                  <Th numeric>Committed</Th>
                </tr>
              </thead>
              <tbody>
                {budgets.map((b) => (
                  <Tr key={b.id}>
                    <Td>
                      <span className="font-medium text-ink">{b.departmentName}</span>
                    </Td>
                    <Td numeric>{b.year}</Td>
                    <Td numeric>{formatINR(b.allocatedPaise)}</Td>
                    <Td numeric>
                      <span className={b.spentPaise > b.allocatedPaise ? "text-danger" : undefined}>{formatINR(b.spentPaise)}</span>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
