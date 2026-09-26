import { requirePage } from "@/lib/access";
import { PageHeader } from "@/components/ui";
import { AdminTabs } from "./tabs";

/** Who can do what, and who approves what. Only for whoever manages access. */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requirePage(["access.manage"]);
  return (
    <>
      <PageHeader
        title="Access and approvals"
        subtitle="Who can do what, and who approves what. Changes apply at once, without anyone signing out."
      />
      <AdminTabs />
      {children}
    </>
  );
}
