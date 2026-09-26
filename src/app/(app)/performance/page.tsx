import { redirect } from "next/navigation";
import { getSession, hasRole } from "@/lib/auth";

export default async function PerformanceIndex() {
  const session = await getSession();
  if (hasRole(session, "HR_ADMIN")) redirect("/performance/cycles");
  if (hasRole(session, "MANAGER")) redirect("/performance/ratings");
  redirect("/performance/mine");
}
