"use client";

import * as React from "react";
import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { saveManagerRating, type ActionState } from "@/app/actions/performance";
import { RATING_LABELS } from "@/db/schema";
import { Button } from "@/components/ui";
import { Dialog } from "@/components/dialog";
import { Field, Select, Textarea, FormError } from "@/components/inputs";
import { useToast } from "@/components/toast";

export function ManagerRatingButton({
  id,
  employeeName,
  selfRating,
  selfComments,
  currentRating,
  currentComments,
  done,
}: {
  id: number;
  employeeName: string;
  selfRating: number | null;
  selfComments: string | null;
  currentRating: number | null;
  currentComments: string | null;
  done: boolean;
}) {
  const toast = useToast();
  const [open, setOpen] = React.useState(false);

  const [state, action, pending] = useActionState(
    async (prev: ActionState, form: FormData): Promise<ActionState> => {
      const result = await saveManagerRating(prev, form);
      if (result.ok) {
        setOpen(false);
        toast("Manager rating saved");
      }
      return result;
    },
    {},
  );

  return (
    <>
      <Button size="sm" variant={done ? "ghost" : "primary"} onClick={() => setOpen(true)}>
        {done ? "Edit rating" : "Rate"}
      </Button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        wide
        title={`Rate ${employeeName}`}
        description="The self review is shown alongside, so the two can be compared before deciding."
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" form="manager-rating" variant="primary" disabled={pending}>
              {pending ? <Loader2 className="animate-spin" /> : null}
              Save rating
            </Button>
          </>
        }
      >
        <form id="manager-rating" action={action} className="flex flex-col gap-4 pb-1">
          <input type="hidden" name="id" value={id} />

          <div className="rounded-2xl bg-soft px-4 py-3">
            <div className="text-[13px] text-muted">Their self review</div>
            <div className="mt-1 text-sm text-ink">
              {selfRating ? `${selfRating} of 5 — ${RATING_LABELS[selfRating]}` : "Not submitted"}
            </div>
            {selfComments ? (
              <p className="mt-1 text-[13px] text-ink-hover">{selfComments}</p>
            ) : null}
          </div>

          <Field label="Manager rating" htmlFor="managerRating" required>
            <Select
              id="managerRating"
              name="managerRating"
              defaultValue={currentRating ? String(currentRating) : ""}
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

          <Field label="Comments" htmlFor="managerComments">
            <Textarea
              id="managerComments"
              name="managerComments"
              defaultValue={currentComments ?? ""}
              placeholder="Consistently strong delivery this year."
            />
          </Field>

          {state.error ? <FormError>{state.error}</FormError> : null}
        </form>
      </Dialog>
    </>
  );
}
