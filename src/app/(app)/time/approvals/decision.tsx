"use client";

import * as React from "react";
import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { decideLeaveRequest, type ActionState } from "@/app/actions/time";
import { Button } from "@/components/ui";
import { Dialog } from "@/components/dialog";
import { Field, Input, FormError } from "@/components/inputs";
import { useToast } from "@/components/toast";

/**
 * Approve or reject. Rejecting asks for a note, because a rejection without a
 * reason is the thing people complain about most in these systems.
 */
export function DecisionButtons({ id, describe }: { id: number; describe: string }) {
  const toast = useToast();
  const [rejecting, setRejecting] = React.useState(false);

  const [state, action, pending] = useActionState(
    async (prev: ActionState, form: FormData): Promise<ActionState> => {
      const result = await decideLeaveRequest(prev, form);
      if (result.ok) {
        const decision = form.get("decision");
        setRejecting(false);
        toast(decision === "Approved" ? "Leave approved" : "Leave rejected");
      }
      return result;
    },
    {},
  );

  return (
    <>
      <div className="flex justify-end gap-1">
        <form action={action}>
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="decision" value="Approved" />
          <Button type="submit" size="sm" variant="primary" disabled={pending}>
            {pending ? <Loader2 className="animate-spin" /> : null}
            Approve
          </Button>
        </form>
        <Button size="sm" variant="destructive" onClick={() => setRejecting(true)}>
          Reject
        </Button>
      </div>

      {state.error && !rejecting ? (
        <div className="mt-2 text-right text-[13px] text-danger">{state.error}</div>
      ) : null}

      <Dialog
        open={rejecting}
        onClose={() => setRejecting(false)}
        title="Reject leave request"
        description={describe}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRejecting(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" form="reject-form" variant="destructive" disabled={pending}>
              {pending ? <Loader2 className="animate-spin" /> : null}
              Reject request
            </Button>
          </>
        }
      >
        <form id="reject-form" action={action} className="pb-1">
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="decision" value="Rejected" />
          <Field
            label="Reason"
            htmlFor="decisionNote"
            hint="The employee sees this on their request."
          >
            <Input
              id="decisionNote"
              name="decisionNote"
              placeholder="Team is short-staffed that week"
            />
          </Field>
          {state.error ? (
            <div className="mt-4">
              <FormError>{state.error}</FormError>
            </div>
          ) : null}
        </form>
      </Dialog>
    </>
  );
}
