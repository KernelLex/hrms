import { requirePage } from "@/lib/access";
import { rawClient } from "@/lib/db";
import { ERP_SCOPES } from "@/lib/api/scopes";
import { NewClientForm } from "../forms";

/** Registering the ERP, or another system. */
export default async function NewIntegrationPage() {
  await requirePage(["integrations.manage"], "/admin");
  const companies = (await rawClient().execute("SELECT code, name FROM om_company ORDER BY code")).rows.map((c) => ({
    code: String(c.code),
    name: String(c.name),
  }));
  return <NewClientForm companies={companies} defaultScopes={ERP_SCOPES} />;
}
