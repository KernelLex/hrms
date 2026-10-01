"use client";

import { usePathname } from "next/navigation";
import { Tabs, Tab } from "@/components/ui";

const ITEMS = [
  { href: "/payroll/periods", label: "Periods" },
  { href: "/payroll/wage-types", label: "Wage types" },
  { href: "/payroll/salary-structures", label: "Salary structures" },
  { href: "/payroll/statutory-rates", label: "Statutory rates" },
  { href: "/payroll/gl-mapping", label: "GL mapping" },
  { href: "/payroll/recurring", label: "Recurring" },
  { href: "/payroll/additional", label: "One-off" },
  { href: "/payroll/run", label: "Run payroll" },
  { href: "/payroll/posting", label: "Bank and posting" },
];

export function PayrollTabs() {
  const pathname = usePathname();
  return (
    <Tabs>
      {ITEMS.map((i) => (
        <Tab key={i.href} href={i.href} active={pathname.startsWith(i.href)}>
          {i.label}
        </Tab>
      ))}
    </Tabs>
  );
}
