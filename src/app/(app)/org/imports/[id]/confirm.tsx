"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { confirmImportAction, type ActionState } from "@/app/actions/imports";
import { Button } from "@/components/ui";
import { useToast } from "@/components/toast";

const INITIAL: ActionState = {};

export function ConfirmImportButton({ id }: { id: number }) {
  const router = useRouter();
  const toast = useToast();
  const [state, action, pending] = useActionState(async (prev: ActionState, form: FormData): Promise<ActionState> => {
    const r = await confirmImportAction(prev, form);
    if (r.ok) {
      toast("Writing the rows that passed");
      router.refresh();
    }
    return r;
  }, INITIAL);

  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <Button type="submit" variant="primary" disabled={pending}>
        {pending ? <Loader2 className="animate-spin" /> : null}
        Write the rows that passed
      </Button>
      {state.error ? <span className="text-[13px] text-danger">{state.error}</span> : null}
    </form>
  );
}
