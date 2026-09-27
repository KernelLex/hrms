import { notFound } from "next/navigation";
import { requirePage } from "@/lib/access";
import { getRole, listUsers, scopeOptions } from "@/lib/repositories/access";
import { RoleForm, RoleMembers, DeleteRole } from "../role-form";

/** One role: what it can do, where, and who holds it. */
export default async function RolePage(props: { params: Promise<{ code: string }> }) {
  await requirePage(["access.manage"], "/admin");
  const { code } = await props.params;
  const [role, users, scope] = await Promise.all([getRole(code), listUsers(), scopeOptions()]);
  if (!role) notFound();

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <RoleForm role={role} companies={scope.companies} areas={scope.areas} />
      <div className="flex flex-col gap-6">
        <RoleMembers roleCode={role.code} members={role.members} users={users} />
        {role.isBuiltIn ? null : <DeleteRole code={role.code} name={role.name} />}
      </div>
    </div>
  );
}
