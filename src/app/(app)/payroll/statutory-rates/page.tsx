import { requirePage } from "@/lib/access";
import { desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { pyPfRate, pyEsiRate, pyProfessionalTaxSlab, pyLwfRate, pyTaxConstant } from "@/db/schema";
import { RateSection } from "@/components/rate-section";
import { PageHeader } from "@/components/ui";
import { formatINR } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import {
  savePfRate,
  deletePfRate,
  saveEsiRate,
  deleteEsiRate,
  savePtSlab,
  deletePtSlab,
  saveLwfRate,
  deleteLwfRate,
  saveTaxConstant,
  deleteTaxConstant,
} from "@/app/actions/statutory";
import { PayrollTabs } from "../tabs";

const openOrDate = (d: string) => (d === "9999-12-31" ? "Open" : formatDate(d));
const bp = (n: number) => (n / 100).toFixed(2).replace(/\.00$/, "");

/** Dated statutory rates: a rate change is a new row, never a deploy. */
export default async function StatutoryRatesPage() {
  await requirePage(["payroll.setup"], "/payroll/my-payslips");

  const [pf, esi, pt, lwf, tax] = await Promise.all([
    db.select().from(pyPfRate).orderBy(desc(pyPfRate.validFrom)),
    db.select().from(pyEsiRate).orderBy(desc(pyEsiRate.validFrom)),
    db.select().from(pyProfessionalTaxSlab).orderBy(desc(pyProfessionalTaxSlab.validFrom)),
    db.select().from(pyLwfRate).orderBy(desc(pyLwfRate.validFrom)),
    db.select().from(pyTaxConstant).orderBy(desc(pyTaxConstant.financialYear)),
  ]);

  return (
    <>
      <PayrollTabs />
      <PageHeader title="Statutory rates" subtitle="PF, ESI, professional tax, the labour welfare fund and the income-tax constants — each a dated row, so a rate change is an edit here, not a deploy." />

      <RateSection
        title="Provident fund"
        description="Employee and employer PF, EPS, EDLI and the admin charge, all capped at the wage ceiling."
        entity="PF rate"
        idField="id"
        saveAction={savePfRate}
        deleteAction={deletePfRate}
        emptyHint="Add the rate currently in force."
        columns={[
          { key: "from", label: "Valid from" },
          { key: "to", label: "Valid to" },
          { key: "ee", label: "Employee %", numeric: true },
          { key: "er", label: "Employer %", numeric: true },
          { key: "ceiling", label: "Wage ceiling", numeric: true },
        ]}
        rows={pf.map((r) => ({
          id: String(r.id),
          describe: `PF rate from ${formatDate(r.validFrom)}`,
          cells: {
            from: formatDate(r.validFrom),
            to: openOrDate(r.validTo),
            ee: `${bp(r.employeeRateBasisPoints)}%`,
            er: `${bp(r.employerRateBasisPoints)}%`,
            ceiling: formatINR(r.wageCeilingPaise),
          },
          values: {
            validFrom: r.validFrom,
            validTo: r.validTo === "9999-12-31" ? "" : r.validTo,
            employeeRate: bp(r.employeeRateBasisPoints),
            employerRate: bp(r.employerRateBasisPoints),
            epsRate: bp(r.epsRateBasisPoints),
            edliRate: bp(r.edliRateBasisPoints),
            adminChargeRate: bp(r.adminChargeBasisPoints),
            wageCeiling: String(r.wageCeilingPaise / 100),
          },
        }))}
        fields={[
          { kind: "date", name: "validFrom", label: "Valid from", required: true },
          { kind: "date", name: "validTo", label: "Valid to", hint: "Leave blank for open-ended." },
          { kind: "text", name: "employeeRate", label: "Employee %", required: true, placeholder: "12" },
          { kind: "text", name: "employerRate", label: "Employer %", required: true, placeholder: "12" },
          { kind: "text", name: "epsRate", label: "EPS % (of the employer share)", required: true, placeholder: "8.33" },
          { kind: "text", name: "edliRate", label: "EDLI %", required: true, placeholder: "0.5" },
          { kind: "text", name: "adminChargeRate", label: "Admin charge %", required: true, placeholder: "0.5" },
          { kind: "text", name: "wageCeiling", label: "Wage ceiling, per month", required: true, placeholder: "15000" },
        ]}
      />

      <RateSection
        title="Employee state insurance"
        description="Applies for a whole contribution period (April–September, October–March) once someone is in it, even past a mid-period raise."
        entity="ESI rate"
        idField="id"
        saveAction={saveEsiRate}
        deleteAction={deleteEsiRate}
        emptyHint="Add the rate currently in force."
        columns={[
          { key: "from", label: "Valid from" },
          { key: "to", label: "Valid to" },
          { key: "ee", label: "Employee %", numeric: true },
          { key: "er", label: "Employer %", numeric: true },
          { key: "ceiling", label: "Wage ceiling", numeric: true },
        ]}
        rows={esi.map((r) => ({
          id: String(r.id),
          describe: `ESI rate from ${formatDate(r.validFrom)}`,
          cells: {
            from: formatDate(r.validFrom),
            to: openOrDate(r.validTo),
            ee: `${bp(r.employeeRateBasisPoints)}%`,
            er: `${bp(r.employerRateBasisPoints)}%`,
            ceiling: formatINR(r.wageCeilingPaise),
          },
          values: {
            validFrom: r.validFrom,
            validTo: r.validTo === "9999-12-31" ? "" : r.validTo,
            employeeRate: bp(r.employeeRateBasisPoints),
            employerRate: bp(r.employerRateBasisPoints),
            wageCeiling: String(r.wageCeilingPaise / 100),
          },
        }))}
        fields={[
          { kind: "date", name: "validFrom", label: "Valid from", required: true },
          { kind: "date", name: "validTo", label: "Valid to", hint: "Leave blank for open-ended." },
          { kind: "text", name: "employeeRate", label: "Employee %", required: true, placeholder: "0.75" },
          { kind: "text", name: "employerRate", label: "Employer %", required: true, placeholder: "3.25" },
          { kind: "text", name: "wageCeiling", label: "Wage ceiling, per month", required: true, placeholder: "21000" },
        ]}
      />

      <RateSection
        title="Professional tax"
        description="Monthly slabs, per state. A February-specific row, where a state has one, charges more to reach its annual cap."
        entity="professional tax slab"
        idField="id"
        saveAction={savePtSlab}
        deleteAction={deletePtSlab}
        emptyHint="Add a state's slabs."
        columns={[
          { key: "state", label: "State" },
          { key: "band", label: "Gross band", numeric: true },
          { key: "amount", label: "Amount", numeric: true },
          { key: "feb", label: "February" },
        ]}
        rows={pt.map((r) => ({
          id: String(r.id),
          describe: `${r.state} slab from ${formatDate(r.validFrom)}`,
          cells: {
            state: <span className="font-medium text-ink">{r.state}</span>,
            band: `${formatINR(r.fromPaise)}${r.toPaise ? ` – ${formatINR(r.toPaise)}` : "+"}`,
            amount: formatINR(r.amountPaise),
            feb: r.isFebruary ? "Yes" : "—",
          },
          values: {
            state: r.state,
            validFrom: r.validFrom,
            validTo: r.validTo === "9999-12-31" ? "" : r.validTo,
            fromAmount: String(r.fromPaise / 100),
            toAmount: r.toPaise ? String(r.toPaise / 100) : "",
            amount: String(r.amountPaise / 100),
            isFebruary: r.isFebruary,
          },
        }))}
        fields={[
          { kind: "text", name: "state", label: "State", required: true, placeholder: "KARNATAKA" },
          { kind: "date", name: "validFrom", label: "Valid from", required: true },
          { kind: "date", name: "validTo", label: "Valid to", hint: "Leave blank for open-ended." },
          { kind: "text", name: "fromAmount", label: "Gross from", required: true, placeholder: "25000" },
          { kind: "text", name: "toAmount", label: "Gross to", hint: "Leave blank for no upper bound." },
          { kind: "text", name: "amount", label: "Monthly amount", required: true, placeholder: "200" },
          { kind: "checkbox", name: "isFebruary", label: "Applies in February only" },
        ]}
      />

      <RateSection
        title="Labour welfare fund"
        description="Small, state-specific amounts, due only in the month each cycle falls in."
        entity="LWF rate"
        idField="id"
        saveAction={saveLwfRate}
        deleteAction={deleteLwfRate}
        emptyHint="Add a state's rate."
        columns={[
          { key: "state", label: "State" },
          { key: "freq", label: "Frequency" },
          { key: "due", label: "Due month", numeric: true },
          { key: "ee", label: "Employee", numeric: true },
          { key: "er", label: "Employer", numeric: true },
        ]}
        rows={lwf.map((r) => ({
          id: String(r.id),
          describe: `${r.state} LWF from ${formatDate(r.validFrom)}`,
          cells: {
            state: <span className="font-medium text-ink">{r.state}</span>,
            freq: r.frequency,
            due: r.dueMonth,
            ee: formatINR(r.employeeAmountPaise),
            er: formatINR(r.employerAmountPaise),
          },
          values: {
            state: r.state,
            validFrom: r.validFrom,
            validTo: r.validTo === "9999-12-31" ? "" : r.validTo,
            frequency: r.frequency,
            dueMonth: String(r.dueMonth),
            employeeAmount: String(r.employeeAmountPaise / 100),
            employerAmount: String(r.employerAmountPaise / 100),
          },
        }))}
        fields={[
          { kind: "text", name: "state", label: "State", required: true, placeholder: "KARNATAKA" },
          { kind: "date", name: "validFrom", label: "Valid from", required: true },
          { kind: "date", name: "validTo", label: "Valid to", hint: "Leave blank for open-ended." },
          {
            kind: "select",
            name: "frequency",
            label: "Frequency",
            required: true,
            options: [
              { value: "Monthly", label: "Monthly" },
              { value: "HalfYearly", label: "Half-yearly" },
              { value: "Annual", label: "Annual" },
            ],
          },
          { kind: "text", name: "dueMonth", label: "Due month (1–12)", required: true, placeholder: "12" },
          { kind: "text", name: "employeeAmount", label: "Employee amount", required: true, placeholder: "20" },
          { kind: "text", name: "employerAmount", label: "Employer amount", required: true, placeholder: "40" },
        ]}
      />

      <RateSection
        title="Income tax constants"
        description="The standard deduction and the Section 87A rebate, by financial year and regime — what engines/tax.ts used to hold as literals."
        entity="tax constant"
        idField="id"
        saveAction={saveTaxConstant}
        deleteAction={deleteTaxConstant}
        emptyHint="Add a financial year's constants for each regime."
        columns={[
          { key: "year", label: "Financial year" },
          { key: "regime", label: "Regime" },
          { key: "std", label: "Standard deduction", numeric: true },
          { key: "rebate", label: "87A rebate up to", numeric: true },
          { key: "cess", label: "Cess %", numeric: true },
        ]}
        rows={tax.map((r) => ({
          id: String(r.id),
          describe: `${r.financialYear} ${r.regime} regime`,
          cells: {
            year: <span className="font-medium text-ink">{r.financialYear}</span>,
            regime: r.regime,
            std: formatINR(r.standardDeductionPaise),
            rebate: formatINR(r.rebate87aMaxPaise),
            cess: `${bp(r.cessBasisPoints)}%`,
          },
          values: {
            financialYear: r.financialYear,
            regime: r.regime,
            standardDeduction: String(r.standardDeductionPaise / 100),
            rebate87aLimit: String(r.rebate87aLimitPaise / 100),
            rebate87aMax: String(r.rebate87aMaxPaise / 100),
            cessPercent: bp(r.cessBasisPoints),
          },
        }))}
        fields={[
          { kind: "text", name: "financialYear", label: "Financial year", required: true, placeholder: "2026-27" },
          {
            kind: "select",
            name: "regime",
            label: "Regime",
            required: true,
            options: [
              { value: "New", label: "New" },
              { value: "Old", label: "Old" },
            ],
          },
          { kind: "text", name: "standardDeduction", label: "Standard deduction", required: true, placeholder: "75000" },
          { kind: "text", name: "rebate87aLimit", label: "87A rebate: taxable income limit", required: true, placeholder: "1200000" },
          { kind: "text", name: "rebate87aMax", label: "87A rebate: maximum relief", required: true, placeholder: "60000" },
          { kind: "text", name: "cessPercent", label: "Cess %", required: true, placeholder: "4" },
        ]}
      />
    </>
  );
}
