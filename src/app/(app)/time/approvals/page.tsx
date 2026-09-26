import { redirect } from "next/navigation";

/** Leave approvals now live in the one approvals inbox, on its leave tab. */
export default function LeaveApprovalsPage() {
  redirect("/approvals?process=leave");
}
