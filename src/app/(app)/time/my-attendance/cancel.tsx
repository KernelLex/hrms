"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { cancelRegularisation, type ActionState } from "@/app/actions/attendance";
import { Button } from "@/components/ui";
import { useToast } from "@/components/toast";

export function CancelRegularisation({ id }: { id: number }) {
  const toast = useToast();
  const [state, action, pending] = useActionState(
    async (prev: ActionState, form: FormData): Promise<ActionState> => {
      const result = await cancelRegularisation(prev, form);
      if (result.ok) toast("Request cancelled");
      return result;
    },
    {},
  );

  return (
    <form action={action} className="inline">
      <input type="hidden" name="id" value={id} />
      <Button type="submit" size="sm" variant="ghost" disabled={pending}>
        {pending ? <Loader2 className="animate-spin" /> : null}
        Cancel
      </Button>
      {state.error ? <div className="mt-1 text-[13px] text-danger">{state.error}</div> : null}
    </form>
  );
}
