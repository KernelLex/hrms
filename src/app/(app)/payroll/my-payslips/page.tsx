import { ModulePlaceholder } from "@/components/placeholder";

export default function Page() {
  return (
    <ModulePlaceholder
      title="My payslips"
      subtitle="Your monthly remuneration statements."
      phase={5}
      screens="One payslip per period, itemised gross to net."
    />
  );
}
