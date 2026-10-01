"use client";

import * as React from "react";
import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { prepayLoanAction, closeLoanAction, type ActionState } from "@/app/actions/loans-claims";
import { Button } from "@/components/ui";
import { Field, Input, DateInput, FormGrid, FormError } from "@/components/inputs";
import { Dialog } from "@/components/dialog";
import { useToast } from "@/components/toast";
import { todayInIndia } from "@/lib/dates";

export function LoanAdminActions({ id, name }: { id: number; name: string }) {
  const toast = useToast();
  const [prepaying, setPrepaying] = React.useState(false);
  const [closing, setClosing] = React.useState(false);

  const [prepayState, prepayAction, prepayPending] = useActionState(
    async (prev: ActionState, form: FormData): Promise<ActionState> => {
      const result = await prepayLoanAction(prev, form);
      if (result.ok) {
        setPrepaying(false);
        toast("Prepayment recorded");
      }
      return result;
    },
    {},
  );
  const [closeState, closeAction, closePending] = useActionState(
    async (prev: ActionState, form: FormData): Promise<ActionState> => {
      const result = await closeLoanAction(prev, form);
      if (result.ok) {
        setClosing(false);
        toast("Loan closed");
      }
      return result;
    },
    {},
  );

  return (
    <>
      <div className="flex justify-end gap-1">
        <Button size="sm" variant="ghost" onClick={() => setPrepaying(true)}>
          Prepay
        </Button>
        <Button size="sm" variant="destructive" onClick={() => setClosing(true)}>
          Close
        </Button>
      </div>

      <Dialog
        open={prepaying}
        onClose={() => setPrepaying(false)}
        title="Record a prepayment"
        description={`${name}'s loan: a lump sum against the outstanding balance, which reschedules what is left at the same EMI.`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setPrepaying(false)} disabled={prepayPending}>
              Cancel
            </Button>
            <Button type="submit" form="prepay-form" variant="primary" disabled={prepayPending}>
              {prepayPending ? <Loader2 className="animate-spin" /> : null}
              Record prepayment
            </Button>
          </>
        }
      >
        <form id="prepay-form" action={prepayAction} className="flex flex-col gap-4 pb-1">
          <input type="hidden" name="loanId" value={id} />
          <FormGrid columns={2}>
            <Field label="Amount" htmlFor="amount" required>
              <Input id="amount" name="amount" type="number" min="1" step="1" required />
            </Field>
            <Field label="Date" htmlFor="date" required>
              <DateInput id="date" name="date" defaultValue={todayInIndia()} required />
            </Field>
          </FormGrid>
          {prepayState.error ? <FormError>{prepayState.error}</FormError> : null}
        </form>
      </Dialog>

      <Dialog
        open={closing}
        onClose={() => setClosing(false)}
        title="Close this loan"
        description={`${name}'s remaining, unqueued instalments will be removed. This cannot be undone.`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setClosing(false)} disabled={closePending}>
              Cancel
            </Button>
            <Button type="submit" form="close-form" variant="destructive" disabled={closePending}>
              {closePending ? <Loader2 className="animate-spin" /> : null}
              Close loan
            </Button>
          </>
        }
      >
        <form id="close-form" action={closeAction} className="pb-1">
          <input type="hidden" name="id" value={id} />
          {closeState.error ? <FormError>{closeState.error}</FormError> : null}
        </form>
      </Dialog>
    </>
  );
}
