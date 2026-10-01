"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { computeArrearsRelief, type ActionState } from "@/app/actions/tax";
import { Button } from "@/components/ui";
import { Input } from "@/components/inputs";
import { useToast } from "@/components/toast";

export function ArrearsReliefForm({ employeeId, financialYear }: { employeeId: number; financialYear: string }) {
  const toast = useToast();
  const [state, action, pending] = useActionState(
    async (prev: ActionState, form: FormData): Promise<ActionState> => {
      const result = await computeArrearsRelief(prev, form);
      if (result.ok) toast("Section 89 relief computed");
      return result;
    },
    {},
  );

  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="employeeId" value={employeeId} />
      <input type="hidden" name="financialYear" value={financialYear} />
      <label className="text-[13px] text-secondary">
        Arrears relate to
        <Input name="relatesToYear" placeholder="2025-26" className="mt-1 w-28" />
      </label>
      <Button type="submit" size="sm" variant="ghost" disabled={pending}>
        {pending ? <Loader2 className="animate-spin" /> : null}
        Compute relief
      </Button>
      {state.error ? <div className="w-full text-[13px] text-danger">{state.error}</div> : null}
    </form>
  );
}
