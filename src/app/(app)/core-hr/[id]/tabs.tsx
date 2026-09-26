"use client";

import { usePathname } from "next/navigation";
import { Tabs, Tab } from "@/components/ui";
import { INFOTYPES } from "@/lib/infotypes";

export function InfotypeTabs({ employeeId }: { employeeId: number }) {
  const pathname = usePathname();
  const base = `/core-hr/${employeeId}`;

  return (
    <Tabs>
      {INFOTYPES.map((i) => (
        <Tab key={i.code} href={`${base}/${i.code}`} active={pathname === `${base}/${i.code}`}>
          {i.name}
        </Tab>
      ))}
      <Tab href={`${base}/as-of`} active={pathname === `${base}/as-of`}>
        As of date
      </Tab>
      <Tab href={`${base}/documents`} active={pathname === `${base}/documents`}>
        Documents
      </Tab>
      <Tab href={`${base}/access`} active={pathname === `${base}/access`}>
        Access log
      </Tab>
    </Tabs>
  );
}
