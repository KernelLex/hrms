"use client";

import { useActionState } from "react";
import { Loader2, Mail } from "lucide-react";
import { resendPayslip, type ActionState } from "@/app/actions/payroll";
import { Button } from "@/components/ui";
import { useToast } from "@/components/toast";

/** Emails this payslip to its employee again, as a new message. */
export function ResendPayslip({ resultId }: { resultId: number }) {
  const toast = useToast();
  const [state, action, pending] = useActionState(async (prev: ActionState, form: FormData) => {
    const r = await resendPayslip(prev, form);
    if (r.ok) toast("Payslip emailed again");
    return r;
  }, {} as ActionState);
  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <input type="hidden" name="resultId" value={resultId} />
      <Button type="submit" variant="ghost" disabled={pending}>
        {pending ? <Loader2 className="animate-spin" /> : <Mail />}
        Email again
      </Button>
      {state.error ? <span className="max-w-[260px] text-right text-[13px] text-danger">{state.error}</span> : null}
    </form>
  );
}
