"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { submitRegularisation, type ActionState } from "@/app/actions/attendance";
import { Button, Card, CardHeader } from "@/components/ui";
import { Field, Input, FormGrid, FormError } from "@/components/inputs";
import { useToast } from "@/components/toast";

export function RegulariseForm() {
  const toast = useToast();
  const [state, action, pending] = useActionState(
    async (prev: ActionState, form: FormData): Promise<ActionState> => {
      const result = await submitRegularisation(prev, form);
      if (result.ok) toast("Sent to your manager");
      return result;
    },
    {},
  );

  return (
    <Card>
      <CardHeader title="Ask for a correction" description="A punch you missed, or one that is wrong. Give at least one time you are claiming, and why — it goes to your manager to approve." />
      <form action={action} className="px-6 pb-5">
        <FormGrid columns={3}>
          <Field label="Date" htmlFor="date" required>
            <Input id="date" name="date" type="date" />
          </Field>
          <Field label="Claimed in" htmlFor="claimedIn">
            <Input id="claimedIn" name="claimedIn" type="datetime-local" className="tabular" />
          </Field>
          <Field label="Claimed out" htmlFor="claimedOut">
            <Input id="claimedOut" name="claimedOut" type="datetime-local" className="tabular" />
          </Field>
        </FormGrid>
        <div className="mt-4">
          <Field label="Reason" htmlFor="reason" required>
            <Input id="reason" name="reason" placeholder="Forgot to punch out before leaving early with approval" />
          </Field>
        </div>

        {state.error ? (
          <div className="mt-4">
            <FormError>{state.error}</FormError>
          </div>
        ) : null}

        <div className="mt-4">
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? <Loader2 className="animate-spin" /> : null}
            Send for approval
          </Button>
        </div>
      </form>
    </Card>
  );
}
