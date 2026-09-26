"use client";

import * as React from "react";
import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { saveCalibration, type ActionState } from "@/app/actions/performance";
import { RATING_LABELS } from "@/db/schema";
import { Button } from "@/components/ui";
import { Dialog } from "@/components/dialog";
import { Field, Select, Textarea, FormError } from "@/components/inputs";
import { useToast } from "@/components/toast";

export function CalibrateButton({
  appraisalId,
  employeeName,
  managerRating,
  currentRating,
  currentComments,
  finalised,
}: {
  appraisalId: number;
  employeeName: string;
  managerRating: number | null;
  currentRating: number | null;
  currentComments: string | null;
  finalised: boolean;
}) {
  const toast = useToast();
  const [open, setOpen] = React.useState(false);
  const [finalise, setFinalise] = React.useState(false);

  const [state, action, pending] = useActionState(
    async (prev: ActionState, form: FormData): Promise<ActionState> => {
      const result = await saveCalibration(prev, form);
      if (result.ok) {
        setOpen(false);
        toast(form.get("finalise") === "1" ? "Rating finalised" : "Calibration saved");
      }
      return result;
    },
    {},
  );

  if (finalised) {
    return <span className="text-[13px] text-muted">Finalised</span>;
  }

  return (
    <>
      <Button size="sm" variant="primary" onClick={() => setOpen(true)}>
        Calibrate
      </Button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        wide
        title={`Calibrate ${employeeName}`}
        description="Finalising locks the rating, and is what makes it eligible for an increment."
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button
              type="submit"
              form="calibrate-form"
              variant="secondary"
              disabled={pending}
              onClick={() => setFinalise(false)}
            >
              Save
            </Button>
            <Button
              type="submit"
              form="calibrate-form"
              variant="primary"
              disabled={pending}
              onClick={() => setFinalise(true)}
            >
              {pending ? <Loader2 className="animate-spin" /> : null}
              Finalise
            </Button>
          </>
        }
      >
        <form id="calibrate-form" action={action} className="flex flex-col gap-4 pb-1">
          <input type="hidden" name="appraisalId" value={appraisalId} />
          <input type="hidden" name="finalise" value={finalise ? "1" : "0"} />

          <div className="rounded-2xl bg-soft px-4 py-3">
            <div className="text-[13px] text-muted">Manager gave</div>
            <div className="mt-1 text-sm text-ink">
              {managerRating
                ? `${managerRating} of 5 — ${RATING_LABELS[managerRating]}`
                : "Not rated"}
            </div>
          </div>

          <Field
            label="Calibrated rating"
            htmlFor="calibratedRating"
            required
            hint="The manager's rating is kept separately, so moderating does not erase it."
          >
            <Select
              id="calibratedRating"
              name="calibratedRating"
              defaultValue={String(currentRating ?? managerRating ?? "")}
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

          <Field label="Committee comments" htmlFor="committeeComments">
            <Textarea
              id="committeeComments"
              name="committeeComments"
              defaultValue={currentComments ?? ""}
              placeholder="Agreed — strong year, consistent with peers at this level."
            />
          </Field>

          {state.error ? <FormError>{state.error}</FormError> : null}
        </form>
      </Dialog>
    </>
  );
}
