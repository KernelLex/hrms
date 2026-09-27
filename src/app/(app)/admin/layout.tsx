import { can, requirePage } from "@/lib/access";
import { issueCounts } from "@/lib/repositories/integrations";
import { PageHeader } from "@/components/ui";
import { AdminTabs } from "./tabs";

/**
 * Administration: who can do what and who approves what, for whoever manages
 * access; and the systems connected through the API, for whoever manages
 * integrations. Each page checks its own permission.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await requirePage(["access.manage", "integrations.manage"]);
  const access = can(session, "access.manage");
  const integrations = can(session, "integrations.manage");
  const openIssues = integrations ? ((await issueCounts()).open ?? 0) : 0;
  return (
    <>
      <PageHeader
        title="Administration"
        subtitle="Who can do what, who approves what, and the systems connected to this one. Changes apply at once."
      />
      <AdminTabs access={access} integrations={integrations} openIssues={openIssues} />
      {children}
    </>
  );
}
