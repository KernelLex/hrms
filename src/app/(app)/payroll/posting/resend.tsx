"use client";

import { useActionState } from "react";
import { Loader2, RotateCw } from "lucide-react";
import { resendJournal, type ActionState } from "@/app/actions/integrations";
import { Button } from "@/components/ui";
import { useToast } from "@/components/toast";

/** After fixing what the ERP refused, the journal goes to it again. */
export function ResendJournal({ id }: { id: number }) {
  const toast = useToast();
  const [state, action, pending] = useActionState(
    async (prev: ActionState, form: FormData): Promise<ActionState> => {
      const result = await resendJournal(prev, form);
      if (result.ok) toast("Journal sent to the ERP again");
      return result;
    },
    {},
  );
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? <Loader2 className="animate-spin" /> : <RotateCw />}
        Send again
      </Button>
      {state.error ? <span className="text-[13px] text-danger">{state.error}</span> : null}
    </form>
  );
}
