import { requirePage } from "@/lib/access";
import { asc, eq, desc, count } from "drizzle-orm";
import { db } from "@/lib/db";
import { pyRecurringPayment, pyWageType, OPEN_ENDED } from "@/db/schema";
import { listEmployees, fullName } from "@/lib/repositories/employees";
import { MasterScreen, type Column, type FieldDef } from "@/components/master-screen";
import { saveRecurringPayment, deleteRecurringPayment } from "@/app/actions/payroll";
import { formatINR, toRupees } from "@/lib/money";
import { TwoLine } from "@/components/ui";
import { PayrollTabs } from "../tabs";
import { formatDateRange } from "@/lib/dates";
import { Pagination, pageFrom } from "@/components/pagination";

const COLUMNS: Column[] = [
  { key: "employee", label: "Employee" },
  { key: "wageType", label: "Wage type" },
  { key: "amount", label: "Amount", numeric: true },
  { key: "period", label: "Runs" },
];

/** PY-02 — IT0014 recurring payments and deductions. */
export default async function RecurringPage(props: { searchParams: Promise<{ page?: string }> }) {
  const { page, limit, offset } = pageFrom((await props.searchParams).page);
  await requirePage(["payroll.setup"], "/payroll/my-payslips");

  const [{ n: total }] = await db.select({ n: count() }).from(pyRecurringPayment);
  const [rows, wageTypes, employees] = await Promise.all([
    db
      .select({
        id: pyRecurringPayment.id,
        employeeId: pyRecurringPayment.employeeId,
        wageTypeCode: pyRecurringPayment.wageTypeCode,
        wageTypeName: pyWageType.name,
        kind: pyWageType.kind,
        amountPaise: pyRecurringPayment.amountPaise,
        startDate: pyRecurringPayment.startDate,
        endDate: pyRecurringPayment.endDate,
      })
      .from(pyRecurringPayment)
      .innerJoin(pyWageType, eq(pyWageType.code, pyRecurringPayment.wageTypeCode))
      .orderBy(desc(pyRecurringPayment.startDate))
      .limit(limit)
      .offset(offset),
    db
      .select()
      .from(pyWageType)
      .where(eq(pyWageType.isAutomatic, false))
      .orderBy(asc(pyWageType.sortOrder)),
    listEmployees(),
  ]);

  const name = new Map(employees.map((e) => [e.id, fullName(e)]));
  const numberOf = new Map(employees.map((e) => [e.id, e.employee_number]));

  const fields: FieldDef[] = [
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
      name: "wageTypeCode",
      label: "Wage type",
      required: true,
      options: wageTypes.map((w) => ({
        value: w.code,
        label: `${w.code} — ${w.name} (${w.kind.toLowerCase()})`,
      })),
    },
    { kind: "text", name: "amount", label: "Amount", required: true, placeholder: "12000", hint: "Per month, in rupees." },
    { kind: "date", name: "startDate", label: "Start date", required: true },
    { kind: "date", name: "endDate", label: "End date", hint: `Leave empty for ${OPEN_ENDED}.` },
  ];

  return (
    <>
      <PayrollTabs />
      <MasterScreen
        total={total}
        footer={<Pagination page={page} total={total} path="/payroll/recurring" noun="payments" />}
        title="Recurring payments"
        subtitle="Amounts that repeat every period until an end date — a fixed allowance, or a loan repayment."
        entity="recurring payment"
        columns={COLUMNS}
        idField="id"
        fields={fields}
        allowEdit={false}
        saveAction={saveRecurringPayment}
        deleteAction={deleteRecurringPayment}
        wideDialog
        emptyHint="Add an allowance or a deduction that repeats each month."
        rows={rows.map((r) => ({
          id: String(r.id),
          describe: `${name.get(r.employeeId) ?? "Employee"}, ${r.wageTypeName}`,
          cells: {
            employee: (
              <TwoLine value={name.get(r.employeeId) ?? "—"} sub={numberOf.get(r.employeeId)} />
            ),
            wageType: (
              <span className="text-secondary">
                {r.wageTypeName} ({r.kind.toLowerCase()})
              </span>
            ),
            amount: (
              <span className="font-medium text-ink">{formatINR(r.amountPaise)}</span>
            ),
            period: (
              <span className="tabular text-secondary">
                {formatDateRange(r.startDate, r.endDate)}
              </span>
            ),
          },
          values: {
            employeeId: String(r.employeeId),
            wageTypeCode: r.wageTypeCode,
            amount: String(toRupees(r.amountPaise)),
            startDate: r.startDate,
            endDate: r.endDate === OPEN_ENDED ? "" : r.endDate,
          },
        }))}
      />
    </>
  );
}
