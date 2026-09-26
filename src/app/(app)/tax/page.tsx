import { redirect } from "next/navigation";
import { getSession, hasRole } from "@/lib/auth";

export default async function TaxIndex() {
  const session = await getSession();
  redirect(hasRole(session, "HR_ADMIN") ? "/tax/sections" : "/tax/declarations");
}
