"use client";

import { usePathname } from "next/navigation";
import { Tabs, Tab } from "@/components/ui";

const ITEMS = [
  { href: "/training/catalogue", label: "Catalogue" },
  { href: "/training/nominations", label: "Nominations" },
  { href: "/training/budgets", label: "Budgets" },
  { href: "/training/compliance", label: "Compliance" },
  { href: "/training/my-training", label: "My training" },
];

export function TrainingTabs() {
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
