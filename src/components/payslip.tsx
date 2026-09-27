import { formatINRExact } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import type { PayslipData, PayslipLine } from "@/lib/repositories/payslips";

/**
 * A payslip, built to HANDOVER.md §8.11 "Printed documents".
 *
 * Ink only, hairline tables, sized for A4, amounts right-aligned in tabular
 * figures with totals at weight 600. The letterhead is the one place a middle
 * dot is allowed as a separator. The PDF (`lib/documents/payslip-pdf.ts`)
 * draws the same content from the same data.
 */

type Row = { code: string; name: string; month: number | null; ytd: number };

/** This month's lines of a kind, then any earlier this year that are not on it. */
function rowsFor(p: PayslipData, kind: string): Row[] {
  const month = new Map(p.lines.filter((l) => l.kind === kind && l.amountPaise !== 0).map((l) => [l.wageTypeCode, l]));
  const ytd = new Map(p.ytd.lines.filter((l) => l.kind === kind && l.amountPaise !== 0).map((l) => [l.wageTypeCode, l]));
  const codes = [...month.keys(), ...[...ytd.keys()].filter((c) => !month.has(c))];
  return codes.map((c) => {
    const line = (month.get(c) ?? ytd.get(c)) as PayslipLine;
    return { code: c, name: line.wageTypeName, month: month.get(c)?.amountPaise ?? null, ytd: ytd.get(c)?.amountPaise ?? 0 };
  });
}

function Section({ title, rows, total, totalMonth, totalYtd }: { title: string; rows: Row[]; total: string; totalMonth: number; totalYtd: number }) {
  return (
    <section>
      <table className="w-full">
        <thead>
          <tr className="border-b border-line text-[13px] text-muted">
            <th className="pb-2 text-left font-normal">{title}</th>
            <th className="pb-2 text-right font-normal">This month</th>
            <th className="pb-2 pl-4 text-right font-normal">Year to date</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td className="py-2.5 text-sm text-muted">None</td>
              <td className="tabular py-2.5 text-right text-sm text-muted">{formatINRExact(0)}</td>
              <td className="tabular py-2.5 pl-4 text-right text-sm text-muted">{formatINRExact(0)}</td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr key={r.code} className="border-b border-soft last:border-0">
                <td className="py-2.5 text-sm">{r.name}</td>
                <td className="tabular py-2.5 text-right text-sm">
                  {r.month === null ? <span className="text-decor">&mdash;</span> : formatINRExact(r.month)}
                </td>
                <td className="tabular py-2.5 pl-4 text-right text-sm text-secondary">{formatINRExact(r.ytd)}</td>
              </tr>
            ))
          )}
        </tbody>
        <tfoot>
          <tr className="border-t border-line">
            <td className="pt-3 text-sm font-semibold">{total}</td>
            <td className="tabular pt-3 text-right text-sm font-semibold">{formatINRExact(totalMonth)}</td>
            <td className="tabular pt-3 pl-4 text-right text-sm font-semibold">{formatINRExact(totalYtd)}</td>
          </tr>
        </tfoot>
      </table>
    </section>
  );
}

export function Payslip({ p }: { p: PayslipData }) {
  const offCycleReason = p.offCycleReason;
  return (
    <div className="mx-auto max-w-[760px] bg-surface p-6 text-ink sm:p-10 print:max-w-none print:p-0">
      {/* Letterhead */}
      <div className="flex items-start justify-between gap-6 border-b border-line pb-5">
        <div className="flex items-center gap-2.5">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-ink text-[13px] font-semibold text-white">
            {p.employer.name.charAt(0)}
          </span>
          <div>
            <div className="text-[15px] font-semibold tracking-[-0.01em]">{p.employer.name}</div>
            {p.employer.address ? <div className="text-[13px] text-muted">{p.employer.address}</div> : null}
          </div>
        </div>
        <div className="text-right">
          <div className="text-[15px] font-semibold">{offCycleReason ? "Off-cycle payslip" : "Payslip"}</div>
          <div className="text-[13px] text-muted">{offCycleReason ? `${offCycleReason}, ${p.periodLabel}` : p.periodLabel}</div>
        </div>
      </div>

      {/* Who it is for */}
      <dl className="grid grid-cols-2 gap-x-8 gap-y-3 py-5 sm:grid-cols-4">
        {[
          ["Employee", p.employeeName],
          ["Employee number", p.employeeNumber],
          ["Position", p.position ?? "—"],
          ["Pay date", p.payDate ? formatDate(p.payDate) : "—"],
        ].map(([label, value]) => (
          <div key={label}>
            <dt className="text-[13px] text-muted">{label}</dt>
            <dd className="mt-0.5 text-sm text-ink">{value}</dd>
          </div>
        ))}
      </dl>

      {!offCycleReason && p.employedDays > 0 && p.employedDays < p.workingDays ? (
        <p className="mb-4 rounded-2xl bg-soft px-4 py-3 text-sm text-ink-hover">
          {p.joinedOn ? `Joined on ${formatDate(p.joinedOn)}` : `Left on ${formatDate(p.leftOn)}`}, so this period pays{" "}
          {p.employedDays} of its {p.workingDays} working days.
        </p>
      ) : null}

      {!offCycleReason && p.unpaidDays > 0 ? (
        <p className="mb-4 rounded-2xl bg-soft px-4 py-3 text-sm text-ink-hover">
          {p.unpaidDays} of {p.workingDays} working days were unpaid this period, so basic pay and the allowances derived from it
          are prorated.
        </p>
      ) : null}

      {/* Earnings and deductions, this month and so far this financial year */}
      <div className="flex flex-col gap-8">
        <Section title="Earnings" rows={rowsFor(p, "Earning")} total="Gross pay" totalMonth={p.grossPaise} totalYtd={p.ytd.grossPaise} />
        <Section
          title="Deductions"
          rows={rowsFor(p, "Deduction")}
          total="Total deductions"
          totalMonth={p.deductionsPaise}
          totalYtd={p.ytd.deductionsPaise}
        />
      </div>

      {/* Net */}
      <div className="mt-8 border-t-2 border-ink pt-4">
        <div className="flex items-baseline justify-between">
          <span className="text-[15px] font-semibold">Net pay</span>
          <span className="tabular text-[26px] leading-tight font-semibold tracking-[-0.02em]">{formatINRExact(p.netPaise)}</span>
        </div>
        <p className="tabular mt-1 text-right text-[13px] text-muted">
          Year to date, {p.financialYear}: {formatINRExact(p.ytd.netPaise)} over {p.ytd.payslips} payslip
          {p.ytd.payslips === 1 ? "" : "s"}
        </p>
      </div>

      <p className="mt-6 text-[13px] text-muted">Computer generated, valid without a signature.</p>
    </div>
  );
}
