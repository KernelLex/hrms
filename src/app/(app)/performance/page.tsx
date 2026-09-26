import { redirect } from "next/navigation";
import { can, canAny, getAccess } from "@/lib/access";

export default async function PerformanceIndex() {
  const session = await getAccess();
  if (can(session, "performance.manage")) redirect("/performance/cycles");
  if (canAny(session, "performance.rate_any", "performance.rate_team")) redirect("/performance/ratings");
  redirect("/performance/mine");
}
