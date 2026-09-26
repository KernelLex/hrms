import { redirect } from "next/navigation";
import { getSession, hasRole } from "@/lib/auth";

export default async function TimeIndex() {
  const session = await getSession();
  // HR runs the back office; everyone else lands on their own leave.
  redirect(hasRole(session, "HR_ADMIN") ? "/time/absences" : "/time/my-leave");
}
