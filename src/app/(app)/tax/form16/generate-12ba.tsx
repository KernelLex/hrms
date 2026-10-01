"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { generate12BA, type ActionState } from "@/app/actions/tax";
import { Button } from "@/components/ui";
import { useToast } from "@/components/toast";

export function Generate12BA({ employeeId, financialYear }: { employeeId: number; financialYear: string }) {
  const toast = useToast();
  const [state, action, pending] = useActionState(
    async (prev: ActionState, form: FormData): Promise<ActionState> => {
      const result = await generate12BA(prev, form);
      if (result.ok) toast("Form 12BA recomputed from the loan schedule");
      return result;
    },
    {},
  );

  return (
    <form action={action} className="inline">
      <input type="hidden" name="employeeId" value={employeeId} />
      <input type="hidden" name="financialYear" value={financialYear} />
      <Button type="submit" size="sm" variant="ghost" disabled={pending}>
        {pending ? <Loader2 className="animate-spin" /> : null}
        Recompute
      </Button>
      {state.error ? <div className="mt-1 text-[13px] text-danger">{state.error}</div> : null}
    </form>
  );
}
