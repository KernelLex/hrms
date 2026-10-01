"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { saveSelfRating, saveGoalCheckin, submitFeedback, type ActionState } from "@/app/actions/performance";
import { RATING_LABELS } from "@/db/schema";
import { Button, Card, CardHeader } from "@/components/ui";
import { Field, Select, Textarea, FormError, Input } from "@/components/inputs";
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

/** A progress update on one goal — their own side of the conversation. */
export function CheckinForm({ goalId }: { goalId: number }) {
  const toast = useToast();
  const [state, action, pending] = useActionState(
    async (prev: ActionState, form: FormData): Promise<ActionState> => {
      const result = await saveGoalCheckin(prev, form);
      if (result.ok) toast("Check-in saved");
      return result;
    },
    {},
  );

  return (
    <form action={action} className="flex flex-wrap items-end gap-3 border-t border-soft pt-3">
      <input type="hidden" name="goalId" value={goalId} />
      <Field label="Status" htmlFor={`status-${goalId}`}>
        <Select id={`status-${goalId}`} name="status" defaultValue="On track">
          <option value="On track">On track</option>
          <option value="At risk">At risk</option>
          <option value="Behind">Behind</option>
        </Select>
      </Field>
      <Field label="A word on progress" htmlFor={`comment-${goalId}`} className="min-w-[220px] flex-1">
        <Input id={`comment-${goalId}`} name="comment" placeholder="On track to finish by the target date." />
      </Field>
      {state.error ? <FormError>{state.error}</FormError> : null}
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? <Loader2 className="animate-spin" /> : null}
        Check in
      </Button>
    </form>
  );
}

const FEEDBACK_COMPETENCIES = ["Communication", "Collaboration", "Execution", "Leadership"] as const;

/** Answering someone else's 360 request: a rating and a comment per competency. */
export function FeedbackResponseForm({ id, revieweeName }: { id: number; revieweeName: string }) {
  const toast = useToast();
  const [state, action, pending] = useActionState(
    async (prev: ActionState, form: FormData): Promise<ActionState> => {
      const result = await submitFeedback(prev, form);
      if (result.ok) toast("Feedback submitted");
      return result;
    },
    {},
  );

  if (state.ok) return null;

  return (
    <Card>
      <CardHeader title={`Feedback on ${revieweeName}`} description="Shown in aggregate with others' if this is peer feedback, or directly otherwise." />
      <form action={action} className="flex flex-col gap-4 px-6 pb-5">
        <input type="hidden" name="id" value={id} />
        {FEEDBACK_COMPETENCIES.map((c) => (
          <div key={c} className="grid grid-cols-1 gap-2 sm:grid-cols-[160px_100px_1fr] sm:items-start">
            <span className="pt-2 text-[13px] font-medium text-ink-hover">{c}</span>
            <Select name={`rating:${c}`} defaultValue="" required aria-label={`${c} rating`}>
              <option value="">Rate</option>
              {[1, 2, 3, 4, 5].map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </Select>
            <Input name={`comments:${c}`} placeholder="A short comment (optional)" />
          </div>
        ))}
        {state.error ? <FormError>{state.error}</FormError> : null}
        <div>
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? <Loader2 className="animate-spin" /> : null}
            Submit feedback
          </Button>
        </div>
      </form>
    </Card>
  );
}
