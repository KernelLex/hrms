"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { submitExitInterview, type ActionState } from "@/app/actions/exits";
import { Button, Card, CardHeader } from "@/components/ui";
import { Field, Select, Textarea, FormGrid, FormError } from "@/components/inputs";
import { useToast } from "@/components/toast";

export function ExitInterviewForm({ exitId }: { exitId: number }) {
  const toast = useToast();
  const [state, action, pending] = useActionState(
    async (prev: ActionState, form: FormData): Promise<ActionState> => {
      const result = await submitExitInterview(prev, form);
      if (result.ok) toast("Thank you — your answers are on file");
      return result;
    },
    {},
  );

  return (
    <Card>
      <CardHeader title="Exit interview" description="A few questions before you go. Optional, and only HR sees it." />
      <form action={action} className="px-6 pb-5">
        <input type="hidden" name="exitId" value={exitId} />
        <FormGrid columns={2}>
          <Field label="Main reason for leaving" htmlFor="primaryReason">
            <Select id="primaryReason" name="primaryReason" defaultValue="">
              <option value="">Prefer not to say</option>
              <option value="Better opportunity">Better opportunity</option>
              <option value="Compensation">Compensation</option>
              <option value="Growth">Growth</option>
              <option value="Work-life balance">Work-life balance</option>
              <option value="Relocation">Relocation</option>
              <option value="Other">Other</option>
            </Select>
          </Field>
          <Field label="Would you recommend working here?" htmlFor="wouldRecommend">
            <Select id="wouldRecommend" name="wouldRecommend" defaultValue="">
              <option value="">Prefer not to say</option>
              <option value="true">Yes</option>
              <option value="false">No</option>
            </Select>
          </Field>
          <Field label="Comments" htmlFor="comments" className="sm:col-span-2">
            <Textarea id="comments" name="comments" rows={3} />
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
