import Link from "next/link";
import { can, requirePage } from "@/lib/access";
import { desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { tdsForm16, tdsTaxSlab, tdsDeductionRegister } from "@/db/schema";
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
  EmptyState,
} from "@/components/ui";
import { FileBadge } from "lucide-react";
import { TaxTabs } from "../tabs";
import { GenerateForm16Form } from "./actions";

/** TDS-04 and TDS-05 — generating and listing Form 16 certificates. */
export default async function Form16Page() {
  const session = await requirePage(["self.tax", "tax.manage"]);
  const isHr = can(session, "tax.manage");

  const [all, employees, slabYears, register] = await Promise.all([
    db.select().from(tdsForm16).orderBy(desc(tdsForm16.financialYear)),
    listEmployees(),
    db.select({ fy: tdsTaxSlab.financialYear }).from(tdsTaxSlab),
    db.select().from(tdsDeductionRegister),
  ]);

  const rows = isHr ? all : all.filter((f) => f.employeeId === session.employeeId);
  const years = [...new Set(slabYears.map((s) => s.fy))].sort().reverse();
  const name = new Map(employees.map((e) => [e.id, fullName(e)]));
  const numberOf = new Map(employees.map((e) => [e.id, e.employee_number]));

  // Who has register entries but no certificate yet.
  const withRegister = new Set(register.map((r) => `${r.employeeId}:${r.financialYear}`));
  const withCertificate = new Set(all.map((f) => `${f.employeeId}:${f.financialYear}`));
  const pending = [...withRegister].filter((k) => !withCertificate.has(k)).length;

  return (
    <>
      {isHr ? <TaxTabs /> : null}
      <PageHeader
        title={isHr ? "Form 16" : "My Form 16"}
        subtitle={
          isHr
            ? "The annual certificate. Part A comes from the deduction register, Part B recomputes the year's liability from the same gross, so the two reconcile."
            : "Your annual tax certificate, for filing your return."
        }
      />

      {isHr ? (
        <GenerateForm16Form
          employees={employees.map((e) => ({
            value: String(e.id),
            label: `${e.employee_number} — ${fullName(e)}`,
          }))}
          years={years.map((y) => ({ value: y, label: y }))}
          pendingCount={pending}
        />
      ) : null}

      <div className={isHr ? "mt-6" : ""}>
        <Card>
          {rows.length === 0 ? (
            <EmptyState icon={<FileBadge />} title="No certificates yet">
              {isHr
                ? "Form 16 is built from what payroll actually deducted: post at least one month, build the quarterly deduction register on the Register tab, then generate a certificate here. Both parts are produced from the same figures, so they always reconcile."
                : "Your certificate appears here once HR has issued it, after the year's tax has been deducted and the register filed."}
            </EmptyState>
          ) : (
            <Table>
              <thead>
                <tr>
                  {isHr ? <Th>Employee</Th> : null}
                  <Th>Certificate</Th>
                  <Th>Year</Th>
                  <Th>Regime</Th>
                  <Th numeric>Gross salary</Th>
                  <Th numeric>Tax deducted</Th>
                  <Th>Outcome</Th>
                  <Th>
                    <span className="sr-only">Open</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((f) => {
                  const refund = f.balancePaise < 0;
                  const settled = f.balancePaise === 0;
                  return (
                    <Tr key={f.id}>
                      {isHr ? (
                        <Td>
                          <TwoLine
                            value={name.get(f.employeeId) ?? "—"}
                            sub={numberOf.get(f.employeeId)}
                          />
                        </Td>
                      ) : null}
                      <Td>
                        <span className="tabular font-medium text-ink">
                          {f.certificateNo}
                        </span>
                      </Td>
                      <Td>
                        <span className="tabular text-secondary">{f.financialYear}</span>
                      </Td>
                      <Td>
                        <span className="text-secondary">{f.regime}</span>
                      </Td>
                      <Td numeric>{formatINR(f.grossSalaryPaise)}</Td>
                      <Td numeric>{formatINR(f.tdsDeductedPaise)}</Td>
                      <Td>
                        {settled ? (
                          <Status tone="done">Settled</Status>
                        ) : refund ? (
                          <Status tone="done">
                            Refund {formatINR(Math.abs(f.balancePaise))}
                          </Status>
                        ) : (
                          /* Still owing is the employee's problem to settle. */
                          <Status tone="problem">
                            Payable {formatINR(f.balancePaise)}
                          </Status>
                        )}
                      </Td>
                      <Td className="text-right">
                        <Link
                          href={`/tax/form16/${f.id}`}
                          className="text-[13px] font-medium text-ink hover:underline"
                        >
                          Open
                        </Link>
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
