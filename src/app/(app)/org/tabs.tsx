"use client";

import { usePathname } from "next/navigation";
import { Tabs, Tab } from "@/components/ui";

export type TabCounts = Record<string, number | undefined>;

const ITEMS: { href: string; label: string; countKey?: string }[] = [
  { href: "/org/companies", label: "Companies", countKey: "companies" },
  { href: "/org/personnel-areas", label: "Personnel areas", countKey: "areas" },
  { href: "/org/sub-areas", label: "Sub-areas", countKey: "subAreas" },
  { href: "/org/jobs", label: "Jobs", countKey: "jobs" },
  { href: "/org/departments", label: "Departments", countKey: "orgUnits" },
  { href: "/org/positions", label: "Positions", countKey: "positions" },
  { href: "/org/reporting-lines", label: "Reporting lines", countKey: "lines" },
  { href: "/org/chart", label: "Org chart" },
];

export function OrgTabs({ counts }: { counts: TabCounts }) {
  const pathname = usePathname();
  return (
    <Tabs>
      {ITEMS.map((i) => (
        <Tab
          key={i.href}
          href={i.href}
          active={pathname === i.href}
          count={i.countKey ? counts[i.countKey] : undefined}
        >
          {i.label}
        </Tab>
      ))}
    </Tabs>
  );
}
