import { requirePage } from "@/lib/access";
import { desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { pyLoanBenchmarkRate } from "@/db/schema";
import { RateSection } from "@/components/rate-section";
import { PageHeader } from "@/components/ui";
import { saveLoanBenchmarkRate, deleteLoanBenchmarkRate } from "@/app/actions/loans-claims";
import { formatDate } from "@/lib/dates";
import { LoansClaimsTabs } from "../tabs";

const openOrDate = (d: string) => (d === "9999-12-31" ? "Open" : formatDate(d));
const bp = (n: number) => (n / 100).toFixed(2).replace(/\.00$/, "");

/** What rule 3(7)(i) compares a concessional or interest-free loan's own rate against. */
export default async function LoanBenchmarkRatePage() {
  await requirePage(["payroll.setup"], "/loans-claims/my-loans");

  const rates = await db.select().from(pyLoanBenchmarkRate).orderBy(desc(pyLoanBenchmarkRate.validFrom));

  return (
    <>
      <LoansClaimsTabs />
      <PageHeader title="Loan benchmark rate" subtitle="The SBI-style lending rate a concessional or interest-free loan's perquisite value is worked out against — dated, so a rate change is a row edit." />
      <RateSection
        title="Benchmark rate"
        description="Rule 3(7)(i): the gap between this rate and what a loan actually charges, on its outstanding balance, is added to taxable income each month."
        entity="rate"
        idField="id"
        saveAction={saveLoanBenchmarkRate}
        deleteAction={deleteLoanBenchmarkRate}
        emptyHint="Add the rate currently in force."
        columns={[
          { key: "from", label: "Valid from" },
          { key: "to", label: "Valid to" },
          { key: "rate", label: "Rate", numeric: true },
        ]}
        rows={rates.map((r) => ({
          id: String(r.id),
          describe: `Benchmark rate from ${formatDate(r.validFrom)}`,
          cells: { from: formatDate(r.validFrom), to: openOrDate(r.validTo), rate: `${bp(r.rateBasisPoints)}%` },
          values: { validFrom: r.validFrom, validTo: r.validTo === "9999-12-31" ? "" : r.validTo, rate: bp(r.rateBasisPoints) },
        }))}
        fields={[
          { kind: "date", name: "validFrom", label: "Valid from", required: true },
          { kind: "date", name: "validTo", label: "Valid to", hint: "Leave blank for open-ended." },
          { kind: "text", name: "rate", label: "Rate %", required: true, placeholder: "8.5" },
        ]}
      />
    </>
  );
}
