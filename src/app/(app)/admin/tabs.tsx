"use client";

import { usePathname } from "next/navigation";
import { Tabs, Tab } from "@/components/ui";

const ACCESS = [
  { href: "/admin/roles", label: "Roles and permissions" },
  { href: "/admin/approval-flows", label: "Approval flows" },
];

const INTEGRATIONS = [
  { href: "/admin/integrations", label: "Connected systems", exact: true },
  { href: "/admin/integrations/ownership", label: "Ownership" },
  { href: "/admin/integrations/sync-issues", label: "Sync issues" },
  { href: "/admin/integrations/reconciliation", label: "Reconciliation" },
];

export function AdminTabs({ access, integrations, openIssues }: { access: boolean; integrations: boolean; openIssues: number }) {
  const pathname = usePathname();
  const isActive = (href: string, exact?: boolean) =>
    exact
      ? pathname === href || (/^\/admin\/integrations\/(new|\d+)/.test(pathname) && href === "/admin/integrations")
      : pathname.startsWith(href);
  return (
    <Tabs>
      {access
        ? ACCESS.map((t) => (
            <Tab key={t.href} href={t.href} active={isActive(t.href)}>
              {t.label}
            </Tab>
          ))
        : null}
      {integrations
        ? INTEGRATIONS.map((t) => (
            <Tab
              key={t.href}
              href={t.href}
              active={isActive(t.href, t.exact)}
              count={t.href.endsWith("sync-issues") && openIssues > 0 ? openIssues : undefined}
            >
              {t.label}
            </Tab>
          ))
        : null}
    </Tabs>
  );
}
