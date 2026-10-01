"use client";

import { usePathname } from "next/navigation";
import { Tabs, Tab } from "@/components/ui";

const ITEMS = [
  { href: "/loans-claims", label: "Loans" },
  { href: "/loans-claims/claims", label: "Claims" },
  { href: "/loans-claims/categories", label: "Claim categories" },
  { href: "/loans-claims/benchmark-rate", label: "Benchmark rate" },
];

export function LoansClaimsTabs() {
  const pathname = usePathname();
  return (
    <Tabs>
      {ITEMS.map((i) => (
        <Tab key={i.href} href={i.href} active={i.href === "/loans-claims" ? pathname === i.href : pathname.startsWith(i.href)}>
          {i.label}
        </Tab>
      ))}
    </Tabs>
  );
}
