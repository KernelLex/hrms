"use client";

import { usePathname } from "next/navigation";
import { Tabs, Tab } from "@/components/ui";

const ITEMS = [
  { href: "/recruitment/requisitions", label: "Requisitions", also: [] as string[] },
  { href: "/recruitment/pipeline", label: "Applications", also: ["/recruitment/applications"] },
  { href: "/recruitment/interviews", label: "Interviews", also: [] },
  { href: "/recruitment/candidates", label: "Candidates", also: [] },
  { href: "/recruitment/hire", label: "Hire conversion", also: [] },
  { href: "/recruitment/analytics", label: "Analytics", also: [] },
];

export function RecruitmentTabs({ counts }: { counts?: Record<string, number> }) {
  const pathname = usePathname();
  return (
    <Tabs>
      {ITEMS.map((i) => (
        <Tab
          key={i.href}
          href={i.href}
          active={[i.href, ...i.also].some((p) => pathname.startsWith(p))}
          count={counts?.[i.href]}
        >
          {i.label}
        </Tab>
      ))}
    </Tabs>
  );
}
