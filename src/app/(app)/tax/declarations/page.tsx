import { redirect } from "next/navigation";
import { desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { tdsEmployeeDeclaration, tdsTaxSlab } from "@/db/schema";
import { getSession, hasRole } from "@/lib/auth";
import { listEmployees, fullName } from "@/lib/repositories/employees";
import { formatINR, toRupees } from "@/lib/money";
import { MasterScreen, type Column, type FieldDef } from "@/components/master-screen";
import { saveDeclaration, deleteDeclaration } from "@/app/actions/tax";
import { Status, TwoLine, Notice } from "@/components/ui";
import { TaxTabs } from "../tabs";

const COLUMNS: Column[] = [
  { key: "employee", label: "Employee" },
  { key: "year", label: "Year" },
  { key: "regime", label: "Regime" },
  { key: "s80c", label: "80C", numeric: true },
  { key: "s80d", label: "80D", numeric: true },
  { key: "hra", label: "HRA exemption", numeric: true },
  { key: "status", label: "Status" },
];

/** TDS-02 — investment declarations, which Form 16 Part B computes from. */
export default async function DeclarationsPage() {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  const isHr = hasRole(session, "HR_ADMIN");

  const [all, employees, slabs] = await Promise.all([
    db
      .select()
      .from(tdsEmployeeDeclaration)
      .orderBy(desc(tdsEmployeeDeclaration.financialYear)),
    listEmployees(),
    db.select({ fy: tdsTaxSlab.financialYear }).from(tdsTaxSlab),
  ]);

  // An employee sees only their own.
  const rows = isHr ? all : all.filter((d) => d.employeeId === session.employeeId);

  const years = [...new Set(slabs.map((s) => s.fy))].sort().reverse();
  const name = new Map(employees.map((e) => [e.id, fullName(e)]));
  const numberOf = new Map(employees.map((e) => [e.id, e.employee_number]));
  const dash = <span className="text-decor">&mdash;</span>;

  const fields: FieldDef[] = [
    ...(isHr
      ? ([
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
        ] as FieldDef[])
      : []),
    {
      kind: "select",
      name: "financialYear",
      label: "Financial year",
      required: true,
      options: years.map((y) => ({ value: y, label: y })),
    },
    {
      kind: "select",
      name: "regime",
      label: "Tax regime",
      required: true,
      options: [
        { value: "New", label: "New — larger standard deduction, no exemptions" },
        { value: "Old", label: "Old — exemptions and Chapter VI-A allowed" },
      ],
      hint: "Under the new regime the amounts below are stored but not applied.",
    },
    { kind: "text", name: "section80C", label: "Section 80C", placeholder: "150000", hint: "PF, LIC, ELSS. Capped at ₹1,50,000." },
    { kind: "text", name: "section80D", label: "Section 80D", placeholder: "25000", hint: "Medical insurance. Capped at ₹25,000." },
    { kind: "text", name: "hraExemption", label: "HRA exemption", placeholder: "144000" },
    { kind: "text", name: "otherIncome", label: "Other income", placeholder: "0" },
    ...(isHr
      ? ([
          {
            kind: "select",
            name: "status",
            label: "Status",
            required: true,
            options: ["Declared", "Verified", "Pending"].map((s) => ({ value: s, label: s })),
          },
        ] as FieldDef[])
      : []),
  ];

  return (
    <>
      {isHr ? <TaxTabs /> : null}
      {!isHr ? (
        <div className="mb-6">
          <Notice>
            What you declare here changes the tax deducted from your salary each
            month, and the computation on your Form 16. A verified declaration
            can only be changed by HR.
          </Notice>
        </div>
      ) : null}
      <MasterScreen
        title={isHr ? "Tax declarations" : "My tax declaration"}
        subtitle={
          isHr
            ? "What each employee has declared. Payroll reads this when it computes monthly TDS, and Form 16 Part B computes from it."
            : "Your investments and exemptions for the year."
        }
        entity="declaration"
        columns={isHr ? COLUMNS : COLUMNS.filter((c) => c.key !== "employee")}
        idField="id"
        fields={fields}
        allowEdit={false}
        saveAction={saveDeclaration}
        deleteAction={deleteDeclaration}
        wideDialog
        emptyHint={
          isHr
            ? "Record what an employee has declared for the year."
            : "Declare your investments so the right tax is deducted."
        }
        rows={rows.map((r) => ({
          id: String(r.id),
          describe: `${name.get(r.employeeId) ?? "Employee"}, ${r.financialYear}`,
          cells: {
            employee: (
              <TwoLine value={name.get(r.employeeId) ?? "—"} sub={numberOf.get(r.employeeId)} />
            ),
            year: <span className="tabular">{r.financialYear}</span>,
            regime: <span className="text-secondary">{r.regime}</span>,
            // Under the new regime these are stored but not applied.
            s80c:
              r.regime === "Old"
                ? r.section80CPaise > 0
                  ? formatINR(r.section80CPaise)
                  : dash
                : <span className="text-muted">n/a</span>,
            s80d:
              r.regime === "Old"
                ? r.section80DPaise > 0
                  ? formatINR(r.section80DPaise)
                  : dash
                : <span className="text-muted">n/a</span>,
            hra:
              r.regime === "Old"
                ? r.hraExemptionPaise > 0
                  ? formatINR(r.hraExemptionPaise)
                  : dash
                : <span className="text-muted">n/a</span>,
            status: (
              <Status
                tone={
                  r.status === "Verified" ? "done" : r.status === "Declared" ? "action" : "waiting"
                }
              >
                {r.status}
              </Status>
            ),
          },
          values: {
            employeeId: String(r.employeeId),
            financialYear: r.financialYear,
            regime: r.regime,
            section80C: r.section80CPaise ? String(toRupees(r.section80CPaise)) : "",
            section80D: r.section80DPaise ? String(toRupees(r.section80DPaise)) : "",
            hraExemption: r.hraExemptionPaise ? String(toRupees(r.hraExemptionPaise)) : "",
            otherIncome: r.otherIncomePaise ? String(toRupees(r.otherIncomePaise)) : "",
            status: r.status,
          },
        }))}
      />
    </>
  );
}
