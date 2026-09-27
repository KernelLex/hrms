import { redirect } from "next/navigation";
import { can, requirePage } from "@/lib/access";

export default async function AdminIndex() {
  const session = await requirePage(["access.manage", "integrations.manage"]);
  redirect(can(session, "access.manage") ? "/admin/roles" : "/admin/integrations");
}
