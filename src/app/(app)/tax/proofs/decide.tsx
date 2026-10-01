"use client";

import * as React from "react";
import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { decideProof, type ActionState } from "@/app/actions/tax";
import { Button } from "@/components/ui";
import { useToast } from "@/components/toast";

export function ProofDecision({ id, describe }: { id: number; describe: string }) {
  const toast = useToast();
  const [pendingDecision, setPendingDecision] = React.useState<"Verified" | "Rejected" | null>(null);
  const [state, action, pending] = useActionState(
    async (prev: ActionState, form: FormData): Promise<ActionState> => {
      const result = await decideProof(prev, form);
      if (result.ok) toast(`${describe}: ${pendingDecision === "Verified" ? "verified" : "rejected"}`);
      return result;
    },
    {},
  );

  return (
    <div className="inline-flex flex-col items-end gap-1">
      <div className="flex justify-end gap-1">
        <form action={action} onSubmit={() => setPendingDecision("Rejected")} className="inline">
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="decision" value="Rejected" />
          <Button type="submit" size="sm" variant="ghost" disabled={pending}>
            {pending && pendingDecision === "Rejected" ? <Loader2 className="animate-spin" /> : null}
            Reject
          </Button>
        </form>
        <form action={action} onSubmit={() => setPendingDecision("Verified")} className="inline">
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="decision" value="Verified" />
          <Button type="submit" size="sm" variant="primary" disabled={pending}>
            {pending && pendingDecision === "Verified" ? <Loader2 className="animate-spin" /> : null}
            Verify
          </Button>
        </form>
      </div>
      {state.error ? <div className="text-[13px] text-danger">{state.error}</div> : null}
    </div>
  );
}
