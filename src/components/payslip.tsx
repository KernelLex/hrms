import { formatINRExact } from "@/lib/money";
import { formatDate } from "@/lib/dates";

/**
 * A payslip, built to HANDOVER.md §8.11 "Printed documents".
 *
 * Ink only, hairline tables, sized for A4, amounts right-aligned in tabular
 * figures with totals at weight 600. The letterhead is the one place a middle
 * dot is allowed as a separator.
 */

export type PayslipLine = {
  wageTypeCode: string;
  wageTypeName: string;
  kind: string;
  amountPaise: number;
};

export function Payslip({
  employer,
  employerAddress,
  employeeName,
  employeeNumber,
  position,
  period,
  payDate,
  lines,
  grossPaise,
  deductionsPaise,
  netPaise,
  unpaidDays,
  workingDays,
  employedDays,
  joinedOn,
  leftOn,
  offCycleReason,
}: {
  employer: string;
  employerAddress?: string;
  employeeName: string;
  employeeNumber: string;
  position?: string;
  period: string;
  payDate?: string | null;
  lines: PayslipLine[];
  grossPaise: number;
  deductionsPaise: number;
  netPaise: number;
  unpaidDays: number;
  workingDays: number;
  /** Working days employed; fewer than workingDays for a joiner or leaver. */
  employedDays: number;
  joinedOn?: string | null;
  leftOn?: string | null;
  /** Set for an off-cycle payslip: what it pays. */
  offCycleReason?: string | null;
}) {
  const earnings = lines.filter((l) => l.kind === "Earning" && l.amountPaise !== 0);
  const deductions = lines.filter((l) => l.kind === "Deduction" && l.amountPaise !== 0);

  return (
    <div className="mx-auto max-w-[760px] bg-surface p-10 text-ink print:max-w-none print:p-0">
      {/* Letterhead */}
      <div className="flex items-start justify-between gap-6 border-b border-line pb-5">
        <div className="flex items-center gap-2.5">
          <span className="flex size-7 items-center justify-center rounded-lg bg-ink text-[13px] font-semibold text-white">
            {employer.charAt(0)}
          </span>
          <div>
            <div className="text-[15px] font-semibold tracking-[-0.01em]">{employer}</div>
            {employerAddress ? (
              <div className="text-[13px] text-muted">{employerAddress}</div>
            ) : null}
          </div>
        </div>
        <div className="text-right">
          <div className="text-[15px] font-semibold">
            {offCycleReason ? "Off-cycle payslip" : "Payslip"}
          </div>
          <div className="text-[13px] text-muted">
            {offCycleReason ? `${offCycleReason}, ${period}` : period}
          </div>
        </div>
      </div>

      {/* Who it is for */}
      <dl className="grid grid-cols-2 gap-x-8 gap-y-3 py-5 sm:grid-cols-4">
        {[
          ["Employee", employeeName],
          ["Employee number", employeeNumber],
          ["Position", position ?? "—"],
          ["Pay date", payDate ? formatDate(payDate) : "—"],
        ].map(([label, value]) => (
          <div key={label}>
            <dt className="text-[13px] text-muted">{label}</dt>
            <dd className="mt-0.5 text-sm text-ink">{value}</dd>
          </div>
        ))}
      </dl>

      {!offCycleReason && employedDays > 0 && employedDays < workingDays ? (
        <p className="mb-4 rounded-2xl bg-soft px-4 py-3 text-sm text-ink-hover">
          {joinedOn ? `Joined on ${formatDate(joinedOn)}` : `Left on ${formatDate(leftOn)}`}, so
          this period pays {employedDays} of its {workingDays} working days.
        </p>
      ) : null}

      {!offCycleReason && unpaidDays > 0 ? (
        <p className="mb-4 rounded-2xl bg-soft px-4 py-3 text-sm text-ink-hover">
          {unpaidDays} of {workingDays} working days were unpaid this period, so
          basic pay and the allowances derived from it are prorated.
        </p>
      ) : null}

      {/* Earnings and deductions */}
      <div className="grid gap-8 sm:grid-cols-2">
        <section>
          <h3 className="border-b border-line pb-2 text-[13px] text-muted">Earnings</h3>
          <table className="w-full">
            <tbody>
              {earnings.map((l) => (
                <tr key={l.wageTypeCode} className="border-b border-soft last:border-0">
                  <td className="py-2.5 text-sm">{l.wageTypeName}</td>
                  <td className="tabular py-2.5 text-right text-sm">
                    {formatINRExact(l.amountPaise)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-line">
                <td className="pt-3 text-sm font-semibold">Gross pay</td>
                <td className="tabular pt-3 text-right text-sm font-semibold">
                  {formatINRExact(grossPaise)}
                </td>
              </tr>
            </tfoot>
          </table>
        </section>

        <section>
          <h3 className="border-b border-line pb-2 text-[13px] text-muted">Deductions</h3>
          <table className="w-full">
            <tbody>
              {deductions.length === 0 ? (
                <tr>
                  <td className="py-2.5 text-sm text-muted">None</td>
                  <td className="tabular py-2.5 text-right text-sm text-muted">
                    {formatINRExact(0)}
                  </td>
                </tr>
              ) : (
                deductions.map((l) => (
                  <tr key={l.wageTypeCode} className="border-b border-soft last:border-0">
                    <td className="py-2.5 text-sm">{l.wageTypeName}</td>
                    <td className="tabular py-2.5 text-right text-sm">
                      {formatINRExact(l.amountPaise)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            <tfoot>
              <tr className="border-t border-line">
                <td className="pt-3 text-sm font-semibold">Total deductions</td>
                <td className="tabular pt-3 text-right text-sm font-semibold">
                  {formatINRExact(deductionsPaise)}
                </td>
              </tr>
            </tfoot>
          </table>
        </section>
      </div>

      {/* Net */}
      <div className="mt-8 flex items-baseline justify-between border-t-2 border-ink pt-4">
        <span className="text-[15px] font-semibold">Net pay</span>
        <span className="tabular text-[26px] leading-tight font-semibold tracking-[-0.02em]">
          {formatINRExact(netPaise)}
        </span>
      </div>

      <p className="mt-6 text-[13px] text-muted">
        Computer generated, valid without a signature.
      </p>
    </div>
  );
}
