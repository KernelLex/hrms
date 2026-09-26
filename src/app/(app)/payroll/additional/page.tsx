import { redirect } from "next/navigation";
import { asc, eq, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { pyAdditionalPayment, pyWageType } from "@/db/schema";
import { getSession, hasRole } from "@/lib/auth";
import { listEmployees, fullName } from "@/lib/repositories/employees";
import { MasterScreen, type Column, type FieldDef } from "@/components/master-screen";
import { saveAdditionalPayment, deleteAdditionalPayment } from "@/app/actions/payroll";
import { formatINR, toRupees } from "@/lib/money";
import { TwoLine } from "@/components/ui";
import { PayrollTabs } from "../tabs";

const COLUMNS: Column[] = [
  { key: "employee", label: "Employee" },
  { key: "wageType", label: "Wage type" },
  { key: "amount", label: "Amount", numeric: true },
  { key: "date", label: "Payment date" },
];

/** PY-02 — IT0015 one-off payments, paid in a single period. */
export default async function AdditionalPage() {
  const session = await getSession();
  if (!hasRole(session, "HR_ADMIN")) redirect("/payroll/my-payslips");

  const [rows, wageTypes, employees] = await Promise.all([
    db
      .select({
        id: pyAdditionalPayment.id,
        employeeId: pyAdditionalPayment.employeeId,
        wageTypeCode: pyAdditionalPayment.wageTypeCode,
        wageTypeName: pyWageType.name,
        kind: pyWageType.kind,
        amountPaise: pyAdditionalPayment.amountPaise,
        paymentDate: pyAdditionalPayment.paymentDate,
      })
      .from(pyAdditionalPayment)
      .innerJoin(pyWageType, eq(pyWageType.code, pyAdditionalPayment.wageTypeCode))
      .orderBy(desc(pyAdditionalPayment.paymentDate)),
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
      options: wageTypes.map((w) => ({ value: w.code, label: `${w.code} — ${w.name}` })),
    },
    { kind: "text", name: "amount", label: "Amount", required: true, placeholder: "25000", hint: "In rupees." },
    {
      kind: "date",
      name: "paymentDate",
      label: "Payment date",
      required: true,
      hint: "The run that covers this date picks it up.",
    },
  ];

  return (
    <>
      <PayrollTabs />
      <MasterScreen
        title="One-off payments"
        subtitle="Bonuses, arrears and reimbursements, paid in the period their date falls in."
        entity="one-off payment"
        columns={COLUMNS}
        idField="id"
        fields={fields}
        allowEdit={false}
        saveAction={saveAdditionalPayment}
        deleteAction={deleteAdditionalPayment}
        wideDialog
        emptyHint="Add a bonus or reimbursement for a single period."
        rows={rows.map((r) => ({
          id: String(r.id),
          describe: `${name.get(r.employeeId) ?? "Employee"}, ${r.wageTypeName} on ${r.paymentDate}`,
          cells: {
            employee: (
              <TwoLine value={name.get(r.employeeId) ?? "—"} sub={numberOf.get(r.employeeId)} />
            ),
            wageType: <span className="text-secondary">{r.wageTypeName}</span>,
            amount: <span className="font-medium text-ink">{formatINR(r.amountPaise)}</span>,
            date: <span className="tabular text-secondary">{r.paymentDate}</span>,
          },
          values: {
            employeeId: String(r.employeeId),
            wageTypeCode: r.wageTypeCode,
            amount: String(toRupees(r.amountPaise)),
            paymentDate: r.paymentDate,
          },
        }))}
      />
    </>
  );
}
