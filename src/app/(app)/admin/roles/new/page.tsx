import { scopeOptions } from "@/lib/repositories/access";
import { RoleForm } from "../role-form";

/** A new role: name it, tick what it can do, and say where it applies. */
export default async function NewRolePage() {
  const scope = await scopeOptions();
  return <RoleForm role={null} companies={scope.companies} areas={scope.areas} />;
}
