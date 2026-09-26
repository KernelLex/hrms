import { redirect } from "next/navigation";
import { can, getAccess } from "@/lib/access";

export default async function TimeIndex() {
  const session = await getAccess();
  // Whoever keeps time records lands on them; everyone else on their own leave.
  redirect(can(session, "time.manage") ? "/time/absences" : "/time/my-leave");
}
