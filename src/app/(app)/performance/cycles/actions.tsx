"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { openCycle, type ActionState } from "@/app/actions/performance";
import { Button } from "@/components/ui";
import { useToast } from "@/components/toast";

export function OpenCycleButton({ id }: { id: number }) {
  const toast = useToast();
  const [state, action, pending] = useActionState(
    async (prev: ActionState, form: FormData): Promise<ActionState> => {
      const result = await openCycle(prev, form);
      if (result.ok) toast("Cycle opened, appraisals created");
      return result;
    },
    {},
  );

  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <Button type="submit" size="sm" variant="secondary" disabled={pending}>
        {pending ? <Loader2 className="animate-spin" /> : null}
        Open cycle
      </Button>
      {state.error ? (
        <div className="mt-1 text-[13px] text-danger">{state.error}</div>
      ) : null}
    </form>
  );
}
