import { ModulePlaceholder } from "@/components/placeholder";

export default function Page() {
  return (
    <ModulePlaceholder
      title="Payroll"
      subtitle="Periods, wage types, the payroll run, payslips and posting."
      phase={5}
      screens="Five screens: control record, wage types and payments, the run, payslips, bank transfer and posting."
    />
  );
}
