"use client";

import { usePathname } from "next/navigation";
import { Tabs, Tab } from "@/components/ui";
import { INFOTYPES } from "@/lib/infotypes";

export function InfotypeTabs({
  employeeId,
  seesPay,
  seesBank,
  seesChanges,
}: {
  employeeId: number;
  seesPay: boolean;
  seesBank: boolean;
  seesChanges: boolean;
}) {
  const pathname = usePathname();
  const base = `/core-hr/${employeeId}`;
  const shown = INFOTYPES.filter(
    (i) => (i.code !== "0008" || seesPay) && (i.code !== "0009" || seesBank),
  );

  return (
    <Tabs>
      {shown.map((i) => (
        <Tab key={i.code} href={`${base}/${i.code}`} active={pathname === `${base}/${i.code}`}>
          {i.name}
        </Tab>
      ))}
      <Tab href={`${base}/career`} active={pathname === `${base}/career`}>
        Career
      </Tab>
      <Tab href={`${base}/as-of`} active={pathname === `${base}/as-of`}>
        As of date
      </Tab>
      <Tab href={`${base}/documents`} active={pathname === `${base}/documents`}>
        Documents
      </Tab>
      {seesChanges ? (
        <>
          <Tab href={`${base}/changes`} active={pathname === `${base}/changes`}>
            Change log
          </Tab>
          <Tab href={`${base}/access`} active={pathname === `${base}/access`}>
            Access log
          </Tab>
        </>
      ) : null}
    </Tabs>
  );
}
