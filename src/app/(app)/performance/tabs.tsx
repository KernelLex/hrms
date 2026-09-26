"use client";

import { usePathname } from "next/navigation";
import { Tabs, Tab } from "@/components/ui";

const ITEMS = [
  { href: "/performance/cycles", label: "Cycles" },
  { href: "/performance/goals", label: "Goals" },
  { href: "/performance/ratings", label: "Ratings" },
  { href: "/performance/calibration", label: "Calibration" },
  { href: "/performance/increments", label: "Increments" },
];

export function PerformanceTabs() {
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
