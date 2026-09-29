"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { completeTask, type ActionState } from "@/app/actions/lifecycle";
import { Button } from "@/components/ui";
import { useToast } from "@/components/toast";

export function CompleteTaskButton({ id }: { id: number }) {
  const toast = useToast();
  const [, action, pending] = useActionState(async (prev: ActionState, form: FormData) => {
    const r = await completeTask(prev, form);
    if (r.ok) toast("Task done");
    else if (r.error) toast(r.error, true);
    return r;
  }, {} as ActionState);

  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? <Loader2 className="animate-spin" /> : null}
        Mark done
      </Button>
    </form>
  );
}
