import { redirect } from "next/navigation";
import { desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { pmGoal, pmAppraisalCycle } from "@/db/schema";
import { getSession, hasRole } from "@/lib/auth";
import { listEmployees, fullName } from "@/lib/repositories/employees";
import { MasterScreen, type Column, type FieldDef } from "@/components/master-screen";
import { saveGoal, deleteGoal } from "@/app/actions/performance";
import { TwoLine, Notice } from "@/components/ui";
import { PerformanceTabs } from "../tabs";
import { formatDate } from "@/lib/dates";

const COLUMNS: Column[] = [
  { key: "employee", label: "Employee" },
  { key: "category", label: "Category" },
  { key: "goal", label: "Goal" },
  { key: "weight", label: "Weightage", numeric: true },
  { key: "target", label: "Target date" },
];

const CATEGORIES = ["Business goal", "Development goal", "Behavioural competency"];

/** PM-02 — goal setting for the cycle. */
export default async function GoalsPage() {
  const session = await getSession();
  if (!hasRole(session, "HR_ADMIN", "MANAGER")) redirect("/performance/mine");

  const [rows, cycles, employees] = await Promise.all([
    db.select().from(pmGoal).orderBy(desc(pmGoal.id)),
    db.select().from(pmAppraisalCycle).orderBy(desc(pmAppraisalCycle.startDate)),
    listEmployees(),
  ]);

  const name = new Map(employees.map((e) => [e.id, fullName(e)]));
  const numberOf = new Map(employees.map((e) => [e.id, e.employee_number]));

  // Weightings should reach 100 per person; flag anyone short or over.
  const totals = new Map<string, number>();
  for (const g of rows) {
    const key = `${g.cycleId}:${g.employeeId}`;
    totals.set(key, (totals.get(key) ?? 0) + g.weightagePercent);
  }
  const incomplete = [...totals.entries()].filter(([, total]) => total !== 100);

  const fields: FieldDef[] = [
    {
      kind: "select",
      name: "cycleId",
      label: "Cycle",
      required: true,
      options: cycles.map((c) => ({ value: String(c.id), label: c.name })),
      emptyLabel: cycles.length === 0 ? "No cycles yet" : undefined,
    },
    {
      kind: "select",
      name: "employeeId",
      label: "Employee",
      required: true,
      options: employees.map((e) => ({
        value: String(e.id),
        label: `${e.employee_number} — ${fullName(e)}`,
      })),
    },
    {
      kind: "select",
      name: "category",
      label: "Category",
      required: true,
      options: CATEGORIES.map((c) => ({ value: c, label: c })),
    },
    {
      kind: "text",
      name: "description",
      label: "Goal",
      required: true,
      full: true,
      placeholder: "Deliver the billing module on schedule",
    },
    {
      kind: "text",
      name: "weightagePercent",
      label: "Weightage %",
      required: true,
      placeholder: "30",
      hint: "An employee's goals should total 100% for the cycle.",
    },
    { kind: "date", name: "targetDate", label: "Target date" },
  ];

  return (
    <>
      <PerformanceTabs />
      {incomplete.length > 0 ? (
        <div className="mb-6">
          <Notice>
            {incomplete.length} employee{incomplete.length === 1 ? "" : "s"} have
            goals that do not total 100% for their cycle.
          </Notice>
        </div>
      ) : null}
      <MasterScreen
        title="Goals"
        subtitle="What each person is being measured on this cycle, and how much each goal counts."
        entity="goal"
        columns={COLUMNS}
        idField="id"
        fields={fields}
        saveAction={saveGoal}
        deleteAction={deleteGoal}
        wideDialog
        emptyHint="Set goals for the people in an open cycle."
        rows={rows.map((r) => {
          const total = totals.get(`${r.cycleId}:${r.employeeId}`) ?? 0;
          return {
            id: String(r.id),
            describe: r.description,
            cells: {
              employee: (
                <TwoLine
                  value={name.get(r.employeeId) ?? "—"}
                  sub={`${numberOf.get(r.employeeId) ?? ""} · ${total}% set`}
                />
              ),
              category: <span className="text-secondary">{r.category}</span>,
              goal: r.description,
              weight: <span className="tabular">{r.weightagePercent}%</span>,
              target: r.targetDate ? (
                <span className="tabular text-secondary">{formatDate(r.targetDate)}</span>
              ) : (
                <span className="text-decor">&mdash;</span>
              ),
            },
            values: {
              cycleId: String(r.cycleId),
              employeeId: String(r.employeeId),
              category: r.category,
              description: r.description,
              weightagePercent: String(r.weightagePercent),
              targetDate: r.targetDate ?? "",
            },
          };
        })}
      />
    </>
  );
}
