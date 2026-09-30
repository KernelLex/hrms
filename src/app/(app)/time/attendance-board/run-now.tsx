"use client";

import { useActionState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { runDailyAttendanceAction, type ActionState } from "@/app/actions/attendance";
import { Button } from "@/components/ui";
import { useToast } from "@/components/toast";

export function RunNowButton({ date }: { date: string }) {
  const toast = useToast();
  const [, action, pending] = useActionState(
    async (prev: ActionState): Promise<ActionState> => {
      const form = new FormData();
      form.set("date", date);
      const result = await runDailyAttendanceAction(prev, form);
      toast(result.ok ? "Attendance finalised" : (result.error ?? "Nothing to finalise"));
      return result;
    },
    {},
  );

  return (
    <form action={action}>
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? <Loader2 className="animate-spin" /> : <RefreshCw />}
        Run for this day
      </Button>
    </form>
  );
}
