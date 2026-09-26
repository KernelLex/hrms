import { redirect } from "next/navigation";
import { can, getAccess } from "@/lib/access";

export default async function TaxIndex() {
  const session = await getAccess();
  redirect(can(session, "tax.manage") ? "/tax/sections" : "/tax/declarations");
}
