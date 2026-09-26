"use client";

import { usePathname } from "next/navigation";
import { Tabs, Tab } from "@/components/ui";

export function AdminTabs() {
  const pathname = usePathname();
  return (
    <Tabs>
      <Tab href="/admin/roles" active={pathname.startsWith("/admin/roles")}>
        Roles and permissions
      </Tab>
      <Tab href="/admin/approval-flows" active={pathname.startsWith("/admin/approval-flows")}>
        Approval flows
      </Tab>
    </Tabs>
  );
}
