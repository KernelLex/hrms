"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { saveSelfRating, type ActionState } from "@/app/actions/performance";
import { RATING_LABELS } from "@/db/schema";
import { Button, Card, CardHeader } from "@/components/ui";
import { Field, Select, Textarea, FormError } from "@/components/inputs";
import { useToast } from "@/components/toast";

export function SelfReviewForm({
  id,
  defaultRating,
  defaultComments,
}: {
  id: number;
  defaultRating: number | null;
  defaultComments: string | null;
}) {
  const toast = useToast();

  const [state, action, pending] = useActionState(
    async (prev: ActionState, form: FormData): Promise<ActionState> => {
      const result = await saveSelfRating(prev, form);
      if (result.ok) toast("Self review submitted");
      return result;
    },
    {},
  );

  return (
    <Card>
      <CardHeader
        title="My self review"
        description="Submitting passes the appraisal to your manager. You cannot change it afterwards."
      />
      <form action={action} className="flex flex-col gap-4 px-6 pb-5">
        <input type="hidden" name="id" value={id} />

        <Field label="How would you rate your year?" htmlFor="selfRating" required>
          <Select
            id="selfRating"
            name="selfRating"
            defaultValue={defaultRating ? String(defaultRating) : ""}
            required
          >
            <option value="">Choose a rating</option>
            {[1, 2, 3, 4, 5].map((r) => (
              <option key={r} value={r}>
                {r} — {RATING_LABELS[r]}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Comments"
          htmlFor="selfComments"
          hint="What went well, and what you would do differently."
        >
          <Textarea
            id="selfComments"
            name="selfComments"
            defaultValue={defaultComments ?? ""}
            placeholder="Delivered the billing module a month early, and picked up the on-call rota."
          />
        </Field>

        {state.error ? <FormError>{state.error}</FormError> : null}

        <div>
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? <Loader2 className="animate-spin" /> : null}
            Submit self review
          </Button>
        </div>
      </form>
    </Card>
  );
}
