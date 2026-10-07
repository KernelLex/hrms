"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { setOptionalHoliday, type ActionState } from "@/app/actions/time";
import { Button } from "@/components/ui";
import { FormError } from "@/components/inputs";
import { useToast } from "@/components/toast";

/** Taking one of the company's optional holidays, or giving it back. */
export function OptionalHolidayButton({ holidayId, taken, past }: { holidayId: number; taken: boolean; past: boolean }) {
  const toast = useToast();
  const router = useRouter();
  const [state, action, pending] = useActionState(async (prev: ActionState, form: FormData): Promise<ActionState> => {
    const r = await setOptionalHoliday(prev, form);
    if (r.ok) {
      toast(form.get("take") === "0" ? "Given back" : "Booked — it is a paid day off for you");
      router.refresh();
    }
    return r;
  }, {});

  if (past && !taken) return <span className="text-[13px] text-muted">Passed</span>;

  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <input type="hidden" name="holidayId" value={holidayId} />
      <input type="hidden" name="take" value={taken ? "0" : "1"} />
      <Button type="submit" size="sm" variant={taken ? "ghost" : "secondary"} disabled={pending || (past && taken)}>
        {pending ? <Loader2 className="animate-spin" /> : null}
        {taken ? (past ? "Taken" : "Give it back") : "Take this day"}
      </Button>
      {state.error ? <FormError>{state.error}</FormError> : null}
    </form>
  );
}
