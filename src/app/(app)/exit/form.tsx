"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { submitExit, type ActionState } from "@/app/actions/exits";
import { Button, Card, CardHeader } from "@/components/ui";
import { Field, Input, DateInput, Textarea, FormGrid, FormError } from "@/components/inputs";
import { useToast } from "@/components/toast";

export function RequestExitForm() {
  const toast = useToast();
  const [state, action, pending] = useActionState(
    async (prev: ActionState, form: FormData): Promise<ActionState> => {
      const result = await submitExit(prev, form);
      if (result.ok) toast("Resignation sent for approval");
      return result;
    },
    {},
  );

  return (
    <Card>
      <CardHeader
        title="Resign"
        description="Goes to your reporting manager, then HR, to decide. Clearance and your settlement follow once your last day arrives. Retirement follows the company's own policy, and HR records it for you."
      />
      <form action={action} className="px-6 pb-5">
        <FormGrid columns={3}>
          <Field label="Last working day" htmlFor="requestedLastDay" required>
            <DateInput id="requestedLastDay" name="requestedLastDay" required />
          </Field>
          <Field label="Notice period, in days" htmlFor="noticeDays" required>
            <Input id="noticeDays" name="noticeDays" type="number" min="0" step="1" defaultValue={30} required />
          </Field>
          <Field label="Reason" htmlFor="reason" className="sm:col-span-3">
            <Textarea id="reason" name="reason" rows={2} />
          </Field>
        </FormGrid>
        {state.error ? (
          <div className="mt-3">
            <FormError>{state.error}</FormError>
          </div>
        ) : null}
        <div className="mt-3">
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? <Loader2 className="animate-spin" /> : null}
            Submit
          </Button>
        </div>
      </form>
    </Card>
  );
}
