import { redirect } from "next/navigation";
import { asc, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { tdsDeductionRegister, tdsTaxSlab } from "@/db/schema";
import { getSession, hasRole } from "@/lib/auth";
import { listEmployees, fullName } from "@/lib/repositories/employees";
import { formatINR } from "@/lib/money";
import {
  Card,
  PageHeader,
  Table,
  Th,
  Tr,
  Td,
  TwoLine,
  Status,
  FigureRow,
  Figure,
  EmptyState,
} from "@/components/ui";
import { ReceiptText } from "lucide-react";
import { TaxTabs } from "../tabs";
import { BuildRegisterForm, ChallanButton } from "./actions";

const QUARTERS = ["Q1 (Apr-Jun)", "Q2 (Jul-Sep)", "Q3 (Oct-Dec)", "Q4 (Jan-Mar)"];

/** TDS-03 — the quarterly deduction register, source for Form 24Q and Part A. */
export default async function RegisterPage(props: {
  searchParams: Promise<{ fy?: string }>;
}) {
  const session = await getSession();
  if (!hasRole(session, "HR_ADMIN")) redirect("/tax/declarations");

  const params = await props.searchParams;
  const slabYears = await db.select({ fy: tdsTaxSlab.financialYear }).from(tdsTaxSlab);
  const years = [...new Set(slabYears.map((s) => s.fy))].sort().reverse();
  const financialYear = params.fy && years.includes(params.fy) ? params.fy : years[0];

  const rows = financialYear
    ? await db
        .select()
        .from(tdsDeductionRegister)
        .where(eq(tdsDeductionRegister.financialYear, financialYear))
        .orderBy(asc(tdsDeductionRegister.employeeId), asc(tdsDeductionRegister.quarter))
    : [];

  const employees = await listEmployees();
  const name = new Map(employees.map((e) => [e.id, fullName(e)]));
  const numberOf = new Map(employees.map((e) => [e.id, e.employee_number]));

  const totalGross = rows.reduce((s, r) => s + r.grossPaidPaise, 0);
  const totalTds = rows.reduce((s, r) => s + r.tdsDeductedPaise, 0);
  const undeposited = rows.filter((r) => r.tdsDeductedPaise > 0 && !r.depositDate);

  return (
    <>
      <TaxTabs />
      <PageHeader
        title="Deduction register"
        subtitle="What payroll actually deducted each quarter, and the challan it was deposited against. Form 16 Part A is built from this."
      />

      <BuildRegisterForm
        years={years.map((y) => ({ value: y, label: y }))}
        selected={financialYear ?? ""}
      />

      {rows.length > 0 ? (
        <div className="mt-6">
          <FigureRow>
            <Figure label="Gross paid" value={formatINR(totalGross)} hint={`across ${financialYear}`} />
            <Figure label="Tax deducted" value={formatINR(totalTds)} hint="from salaries" />
            <Figure label="Quarters recorded" value={rows.length} hint="employee quarters" />
            <Figure
              label="Not yet deposited"
              value={undeposited.length}
              hint={undeposited.length === 0 ? "all deposited" : "need a challan"}
              problem={undeposited.length > 0}
            />
          </FigureRow>
        </div>
      ) : null}

      <div className="mt-6">
        <Card>
          {rows.length === 0 ? (
            <EmptyState icon={<ReceiptText />} title={`Nothing recorded for ${financialYear ?? "this year"}`}>
              Build the register from payroll above. It reads what was actually
              deducted, so the register and the payslips agree.
            </EmptyState>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Employee</Th>
                  <Th>Quarter</Th>
                  <Th numeric>Gross paid</Th>
                  <Th numeric>Tax deducted</Th>
                  <Th>Challan / BSR</Th>
                  <Th>Deposited</Th>
                  <Th>
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <Tr key={r.id}>
                    <Td>
                      <TwoLine
                        value={name.get(r.employeeId) ?? "—"}
                        sub={numberOf.get(r.employeeId)}
                      />
                    </Td>
                    <Td>
                      <span className="text-secondary">{QUARTERS[r.quarter - 1]}</span>
                    </Td>
                    <Td numeric>{formatINR(r.grossPaidPaise)}</Td>
                    <Td numeric>
                      <span className="font-medium text-ink">
                        {formatINR(r.tdsDeductedPaise)}
                      </span>
                    </Td>
                    <Td>
                      {r.challanBsr ? (
                        <span className="tabular text-secondary">{r.challanBsr}</span>
                      ) : (
                        <span className="text-decor">&mdash;</span>
                      )}
                    </Td>
                    <Td>
                      {r.depositDate ? (
                        <Status tone="done">{r.depositDate}</Status>
                      ) : r.tdsDeductedPaise > 0 ? (
                        /* Tax deducted but not deposited is money owed to the
                           government — a genuine problem. */
                        <Status tone="problem">Not deposited</Status>
                      ) : (
                        <Status tone="neutral">Nothing due</Status>
                      )}
                    </Td>
                    <Td className="text-right">
                      <ChallanButton
                        id={r.id}
                        describe={`${name.get(r.employeeId) ?? "Employee"}, ${QUARTERS[r.quarter - 1]}`}
                        challanBsr={r.challanBsr}
                        depositDate={r.depositDate}
                        receipt24q={r.receipt24q}
                      />
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
