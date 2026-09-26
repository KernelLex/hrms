"use client";

import { usePathname } from "next/navigation";
import { Tabs, Tab } from "@/components/ui";

const ITEMS = [
  { href: "/tax/sections", label: "Sections and rates" },
  { href: "/tax/declarations", label: "Declarations" },
  { href: "/tax/register", label: "Deduction register" },
  { href: "/tax/form16", label: "Form 16" },
];

export function TaxTabs() {
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
