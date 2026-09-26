import { formatINRExact } from "@/lib/money";
import { formatDate } from "@/lib/dates";

/**
 * Form 16, Parts A and B — DESIGN_LANGUAGE.md §11 "Printed documents".
 *
 * Part A summarises what was deducted and deposited each quarter. Part B shows
 * the computation that arrives at the year's liability. The two reconcile: the
 * balance at the bottom is the difference between the tax owed and the tax
 * taken, and a negative balance is a refund.
 *
 * The reference mockup hardcoded the tax figure. A certificate an employee
 * files a return with has to add up, so every line here is computed.
 */

export type QuarterRow = {
  quarter: number;
  grossPaidPaise: number;
  tdsDeductedPaise: number;
  challanBsr: string | null;
  depositDate: string | null;
  receipt24q: string | null;
};

export type Form16Data = {
  certificateNo: string;
  financialYear: string;
  regime: string;
  employerName: string;
  employerTan: string;
  employerPan: string;
  employeeName: string;
  employeeNumber: string;
  employeePan: string | null;
  grossSalaryPaise: number;
  section10ExemptPaise: number;
  standardDeductionPaise: number;
  chapterViaPaise: number;
  taxableIncomePaise: number;
  taxOnIncomePaise: number;
  rebate87aPaise: number;
  cessPaise: number;
  totalTaxPaise: number;
  tdsDeductedPaise: number;
  balancePaise: number;
  generatedAt: string;
};

const QUARTERS = ["Q1 (Apr-Jun)", "Q2 (Jul-Sep)", "Q3 (Oct-Dec)", "Q4 (Jan-Mar)"];

function assessmentYear(fy: string): string {
  const start = Number(fy.slice(0, 4)) + 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

function Line({
  label,
  value,
  strong,
  indent,
  negative,
}: {
  label: string;
  value: number;
  strong?: boolean;
  indent?: boolean;
  negative?: boolean;
}) {
  return (
    <tr className="border-b border-soft last:border-0">
      <td
        className={`py-2.5 text-sm ${indent ? "pl-5 text-secondary" : ""} ${strong ? "font-semibold text-ink" : ""}`}
      >
        {label}
      </td>
      <td
        className={`tabular py-2.5 text-right text-sm ${strong ? "font-semibold text-ink" : ""}`}
      >
        {negative ? "(" : ""}
        {formatINRExact(Math.abs(value))}
        {negative ? ")" : ""}
      </td>
    </tr>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h4 className="mt-6 border-b border-line pb-2 text-[13px] text-muted">{children}</h4>
  );
}

export function Form16({ data, quarters }: { data: Form16Data; quarters: QuarterRow[] }) {
  const refund = data.balancePaise < 0;
  const totalDeposited = quarters.reduce(
    (s, q) => s + (q.depositDate ? q.tdsDeductedPaise : 0),
    0,
  );

  return (
    <div className="mx-auto max-w-[820px] bg-surface p-10 text-ink print:max-w-none print:p-0">
      {/* Letterhead */}
      <div className="flex items-start justify-between gap-6 border-b border-line pb-5">
        <div className="flex items-center gap-2.5">
          <span className="flex size-7 items-center justify-center rounded-lg bg-ink text-[13px] font-semibold text-white">
            {data.employerName.charAt(0)}
          </span>
          <div>
            <div className="text-[15px] font-semibold tracking-[-0.01em]">
              {data.employerName}
            </div>
            <div className="text-[13px] text-muted">
              TAN {data.employerTan} · PAN {data.employerPan}
            </div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-[15px] font-semibold">Form 16</div>
          <div className="text-[13px] text-muted">{data.certificateNo}</div>
        </div>
      </div>

      <p className="mt-4 max-w-[600px] text-[13px] text-muted">
        Certificate under section 203 of the Income-tax Act, 1961 for tax
        deducted at source on salary. Financial year {data.financialYear},
        assessment year {assessmentYear(data.financialYear)}, {data.regime.toLowerCase()} regime.
      </p>

      <dl className="grid grid-cols-2 gap-x-8 gap-y-3 py-5 sm:grid-cols-4">
        {[
          ["Employee", data.employeeName],
          ["Employee number", data.employeeNumber],
          ["Employee PAN", data.employeePan ?? "Not recorded"],
          ["Issued", formatDate(data.generatedAt.slice(0, 10))],
        ].map(([label, value]) => (
          <div key={label}>
            <dt className="text-[13px] text-muted">{label}</dt>
            <dd className="mt-0.5 truncate text-sm text-ink">{value}</dd>
          </div>
        ))}
      </dl>

      {/* ------------------------------------------------------------ Part A */}
      <h3 className="mt-4 border-t-2 border-ink pt-4 text-[15px] font-semibold">
        Part A — tax deducted and deposited
      </h3>
      <table className="mt-3 w-full">
        <thead>
          <tr className="border-b border-line">
            <th className="py-2 text-left text-[13px] font-normal text-muted">Quarter</th>
            <th className="py-2 text-left text-[13px] font-normal text-muted">Receipt</th>
            <th className="py-2 text-right text-[13px] font-normal text-muted">Amount paid</th>
            <th className="py-2 text-right text-[13px] font-normal text-muted">Tax deducted</th>
            <th className="py-2 text-right text-[13px] font-normal text-muted">Deposited</th>
          </tr>
        </thead>
        <tbody>
          {quarters.length === 0 ? (
            <tr>
              <td colSpan={5} className="py-3 text-sm text-muted">
                No deductions recorded for this year.
              </td>
            </tr>
          ) : (
            quarters.map((q) => (
              <tr key={q.quarter} className="border-b border-soft">
                <td className="py-2.5 text-sm">{QUARTERS[q.quarter - 1]}</td>
                <td className="tabular py-2.5 text-sm text-secondary">
                  {q.receipt24q ?? "—"}
                </td>
                <td className="tabular py-2.5 text-right text-sm">
                  {formatINRExact(q.grossPaidPaise)}
                </td>
                <td className="tabular py-2.5 text-right text-sm">
                  {formatINRExact(q.tdsDeductedPaise)}
                </td>
                <td className="tabular py-2.5 text-right text-sm">
                  {q.depositDate ? formatINRExact(q.tdsDeductedPaise) : "—"}
                </td>
              </tr>
            ))
          )}
        </tbody>
        <tfoot>
          <tr className="border-t border-line">
            <td colSpan={2} className="pt-3 text-sm font-semibold">
              Total
            </td>
            <td className="tabular pt-3 text-right text-sm font-semibold">
              {formatINRExact(quarters.reduce((s, q) => s + q.grossPaidPaise, 0))}
            </td>
            <td className="tabular pt-3 text-right text-sm font-semibold">
              {formatINRExact(data.tdsDeductedPaise)}
            </td>
            <td className="tabular pt-3 text-right text-sm font-semibold">
              {formatINRExact(totalDeposited)}
            </td>
          </tr>
        </tfoot>
      </table>

      {totalDeposited < data.tdsDeductedPaise ? (
        <p className="mt-3 rounded-2xl bg-danger-soft px-4 py-3 text-[13px] text-danger-strong">
          {formatINRExact(data.tdsDeductedPaise - totalDeposited)} was deducted but
          has not been recorded as deposited. Record the challan before issuing
          this certificate.
        </p>
      ) : null}

      {/* ------------------------------------------------------------ Part B */}
      <h3 className="mt-8 border-t-2 border-ink pt-4 text-[15px] font-semibold print:mt-0 print:break-before-page">
        Part B — computation of income and tax
      </h3>

      <SectionLabel>Gross salary</SectionLabel>
      <table className="w-full">
        <tbody>
          <Line label="Salary under section 17(1)" value={data.grossSalaryPaise} />
          <Line label="Gross salary" value={data.grossSalaryPaise} strong />
        </tbody>
      </table>

      <SectionLabel>Exemptions under section 10</SectionLabel>
      <table className="w-full">
        <tbody>
          <Line
            label="House rent allowance"
            value={data.section10ExemptPaise}
            indent
          />
          <Line
            label="Balance"
            value={data.grossSalaryPaise - data.section10ExemptPaise}
            strong
          />
        </tbody>
      </table>

      <SectionLabel>Deductions from salary</SectionLabel>
      <table className="w-full">
        <tbody>
          <Line label="Standard deduction" value={data.standardDeductionPaise} indent />
          <Line
            label="Income chargeable under the head salaries"
            value={Math.max(
              0,
              data.grossSalaryPaise -
                data.section10ExemptPaise -
                data.standardDeductionPaise,
            )}
            strong
          />
        </tbody>
      </table>

      <SectionLabel>Deductions under Chapter VI-A</SectionLabel>
      <table className="w-full">
        <tbody>
          <Line label="Sections 80C and 80D" value={data.chapterViaPaise} indent />
          <Line label="Total taxable income" value={data.taxableIncomePaise} strong />
        </tbody>
      </table>

      <SectionLabel>Tax</SectionLabel>
      <table className="w-full">
        <tbody>
          <Line label="Tax on total income" value={data.taxOnIncomePaise} />
          {data.rebate87aPaise > 0 ? (
            <Line
              label="Less: rebate under section 87A"
              value={data.rebate87aPaise}
              indent
              negative
            />
          ) : null}
          <Line label="Health and education cess at 4%" value={data.cessPaise} indent />
          <Line label="Total tax payable" value={data.totalTaxPaise} strong />
          <Line
            label="Less: tax deducted at source"
            value={data.tdsDeductedPaise}
            indent
            negative
          />
        </tbody>
      </table>

      <div className="mt-6 flex items-baseline justify-between border-t-2 border-ink pt-4">
        <span className="text-[15px] font-semibold">
          {refund ? "Net tax refundable" : data.balancePaise === 0 ? "Fully settled" : "Net tax payable"}
        </span>
        <span className="tabular text-[26px] leading-tight font-semibold tracking-[-0.02em]">
          {formatINRExact(Math.abs(data.balancePaise))}
        </span>
      </div>

      <p className="mt-6 text-[13px] text-muted">
        Computer generated, valid without a signature. Figures are taken from
        payroll results for the year and the employee&rsquo;s declaration.
      </p>
    </div>
  );
}
