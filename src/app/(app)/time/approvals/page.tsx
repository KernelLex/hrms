import { ModulePlaceholder } from "@/components/placeholder";

export default function Page() {
  return (
    <ModulePlaceholder
      title="Approvals"
      subtitle="Leave waiting on your decision."
      phase={4}
      screens="Your team's pending leave requests, with approve and reject."
    />
  );
}
