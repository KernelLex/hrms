"use client";

import * as React from "react";
import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { decideApproval, type ActionState } from "@/app/actions/approvals";
import { Button } from "@/components/ui";
import { Dialog } from "@/components/dialog";
import { Field, FormError, Textarea } from "@/components/inputs";
import { useToast } from "@/components/toast";

/**
 * Approve or reject any request in the inbox, by its approval request id.
 * The engine decides who may; a refusal — "someone else has to approve this
 * one" — shows under the buttons.
 */
export function ApprovalDecision({ requestId, describe }: { requestId: number; describe: string }) {
  const toast = useToast();
  const router = useRouter();
  const [rejecting, setRejecting] = React.useState(false);
  const formId = React.useId();
  const [state, action, pending] = useActionState(async (prev: ActionState, form: FormData) => {
    const r = await decideApproval(prev, form);
    if (r.ok) {
      setRejecting(false);
      toast(form.get("decision") === "Approved" ? "Approved" : "Rejected");
      router.refresh();
    }
    return r;
  }, {} as ActionState);

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex justify-end gap-1">
        <form action={action}>
          <input type="hidden" name="requestId" value={requestId} />
          <input type="hidden" name="decision" value="Approved" />
          <Button type="submit" size="sm" variant="primary" disabled={pending}>
            {pending && !rejecting ? <Loader2 className="animate-spin" /> : null}
            Approve
          </Button>
        </form>
        <Button size="sm" variant="destructive" onClick={() => setRejecting(true)}>
          Reject
        </Button>
      </div>
      {state.error && !rejecting ? <p className="max-w-[320px] text-right text-[13px] text-danger">{state.error}</p> : null}
      <Dialog
        open={rejecting}
        onClose={() => setRejecting(false)}
        title="Reject the request"
        description={describe}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRejecting(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" form={formId} variant="destructive" disabled={pending}>
              {pending ? <Loader2 className="animate-spin" /> : null}
              Reject
            </Button>
          </>
        }
      >
        <form id={formId} action={action} className="flex flex-col gap-4 pb-1">
          <input type="hidden" name="requestId" value={requestId} />
          <input type="hidden" name="decision" value="Rejected" />
          <Field label="Why" htmlFor={`${formId}-comment`} hint="The employee sees this.">
            <Textarea id={`${formId}-comment`} name="comment" rows={3} maxLength={1000} placeholder="The cheque is from a different account." />
          </Field>
          {state.error ? <FormError>{state.error}</FormError> : null}
        </form>
      </Dialog>
    </div>
  );
}
