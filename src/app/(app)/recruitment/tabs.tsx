"use client";

import { usePathname } from "next/navigation";
import { Tabs, Tab } from "@/components/ui";

const ITEMS = [
  { href: "/recruitment/requisitions", label: "Requisitions" },
  { href: "/recruitment/candidates", label: "Candidates" },
  { href: "/recruitment/pipeline", label: "Pipeline" },
  { href: "/recruitment/interviews", label: "Interviews" },
  { href: "/recruitment/hire", label: "Hire conversion" },
];

export function RecruitmentTabs({ counts }: { counts?: Record<string, number> }) {
  const pathname = usePathname();
  return (
    <Tabs>
      {ITEMS.map((i) => (
        <Tab key={i.href} href={i.href} active={pathname.startsWith(i.href)} count={counts?.[i.href]}>
          {i.label}
        </Tab>
      ))}
    </Tabs>
  );
}
