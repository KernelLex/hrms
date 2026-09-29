"use client";

import * as React from "react";
import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import {
  confirmProbationAction,
  endProbationAction,
  extendProbationAction,
  issueLetterAction,
  type ActionState,
} from "@/app/actions/lifecycle";
import { Button } from "@/components/ui";
import { DateInput, Field, FormError, FormGrid, Select, Textarea } from "@/components/inputs";
import { Dialog } from "@/components/dialog";
import { useToast } from "@/components/toast";

const INITIAL: ActionState = {};
const today = () => new Date().toISOString().slice(0, 10);

function useDialogAction(run: (prev: ActionState, form: FormData) => Promise<ActionState>, onDone: () => void) {
  const [open, setOpen] = React.useState(false);
  const [state, action, pending] = useActionState(async (prev: ActionState, form: FormData) => {
    const r = await run(prev, form);
    if (r.ok) {
      setOpen(false);
      onDone();
    }
    return r;
  }, INITIAL);
  return { open, setOpen, state, action, pending };
}

/** Confirm, extend or end a pending probation review — HR's decision, not a routed approval. */
export function ProbationActions({ id }: { id: number }) {
  const toast = useToast();
  const confirm = useDialogAction(confirmProbationAction, () => toast("Probation confirmed"));
  const extend = useDialogAction(extendProbationAction, () => toast("Review pushed back"));
  const end = useDialogAction(endProbationAction, () => toast("Employment ended"));

  return (
    <div className="mt-4 flex flex-wrap gap-2 border-t border-soft pt-4">
      <Button type="button" variant="primary" size="sm" onClick={() => confirm.setOpen(true)}>
        Confirm
      </Button>
      <Button type="button" variant="secondary" size="sm" onClick={() => extend.setOpen(true)}>
        Extend
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={() => end.setOpen(true)}>
        End employment
      </Button>

      <Dialog
        open={confirm.open}
        onClose={() => confirm.setOpen(false)}
        title="Confirm probation?"
        description="Their employment is confirmed from today. This cannot be undone."
        footer={
          <>
            <Button variant="ghost" onClick={() => confirm.setOpen(false)} disabled={confirm.pending}>
              Cancel
            </Button>
            <Button type="submit" form="confirm-probation" variant="primary" disabled={confirm.pending}>
              {confirm.pending ? <Loader2 className="animate-spin" /> : null}
              Confirm
            </Button>
          </>
        }
      >
        <form id="confirm-probation" action={confirm.action} className="flex flex-col gap-4 pb-1">
          <input type="hidden" name="id" value={id} />
          <Field label="Note" htmlFor="confirm-note" hint="Optional.">
            <Textarea id="confirm-note" name="note" rows={2} />
          </Field>
          {confirm.state.error ? <FormError>{confirm.state.error}</FormError> : null}
        </form>
      </Dialog>

      <Dialog
        open={extend.open}
        onClose={() => extend.setOpen(false)}
        title="Extend the review"
        description="Pushes the review to a new date. The current one stays on record as extended."
        footer={
          <>
            <Button variant="ghost" onClick={() => extend.setOpen(false)} disabled={extend.pending}>
              Cancel
            </Button>
            <Button type="submit" form="extend-probation" variant="primary" disabled={extend.pending}>
              {extend.pending ? <Loader2 className="animate-spin" /> : null}
              Extend
            </Button>
          </>
        }
      >
        <form id="extend-probation" action={extend.action} className="flex flex-col gap-4 pb-1">
          <input type="hidden" name="id" value={id} />
          <Field label="New review date" htmlFor="extend-date" required>
            <DateInput id="extend-date" name="newDate" required defaultValue={today()} />
          </Field>
          <Field label="Note" htmlFor="extend-note" hint="Optional.">
            <Textarea id="extend-note" name="note" rows={2} />
          </Field>
          {extend.state.error ? <FormError>{extend.state.error}</FormError> : null}
        </form>
      </Dialog>

      <Dialog
        open={end.open}
        onClose={() => end.setOpen(false)}
        title="End employment?"
        description="Marks their last working day and frees their position. This is not a routed approval, and cannot be undone here."
        footer={
          <>
            <Button variant="ghost" onClick={() => end.setOpen(false)} disabled={end.pending}>
              Cancel
            </Button>
            <Button type="submit" form="end-probation" variant="destructive" disabled={end.pending}>
              {end.pending ? <Loader2 className="animate-spin" /> : null}
              End employment
            </Button>
          </>
        }
      >
        <form id="end-probation" action={end.action} className="flex flex-col gap-4 pb-1">
          <input type="hidden" name="id" value={id} />
          <Field label="Last working day" htmlFor="end-date" required>
            <DateInput id="end-date" name="effectiveDate" required defaultValue={today()} />
          </Field>
          <Field label="Note" htmlFor="end-note" required hint="Said why, for the record.">
            <Textarea id="end-note" name="note" rows={2} required />
          </Field>
          {end.state.error ? <FormError>{end.state.error}</FormError> : null}
        </form>
      </Dialog>
    </div>
  );
}

/** Issues a letter from an active template, merged with the record as of the issue date. */
export function IssueLetterButton({
  employeeId,
  templates,
}: {
  employeeId: number;
  templates: { id: number; kind: string }[];
}) {
  const toast = useToast();
  const issue = useDialogAction(issueLetterAction, () => toast("Letter issued"));

  if (templates.length === 0) return null;
  return (
    <>
      <Button type="button" size="sm" onClick={() => issue.setOpen(true)}>
        Issue letter
      </Button>
      <Dialog
        open={issue.open}
        onClose={() => issue.setOpen(false)}
        title="Issue a letter"
        description="Merges the template with the record as of the issue date, and files the result as a PDF, kept exactly as issued."
        footer={
          <>
            <Button variant="ghost" onClick={() => issue.setOpen(false)} disabled={issue.pending}>
              Cancel
            </Button>
            <Button type="submit" form="issue-letter" variant="primary" disabled={issue.pending}>
              {issue.pending ? <Loader2 className="animate-spin" /> : null}
              Issue letter
            </Button>
          </>
        }
      >
        <form id="issue-letter" action={issue.action} className="pb-1">
          <input type="hidden" name="employeeId" value={employeeId} />
          <FormGrid columns={2}>
            <Field label="Letter" htmlFor="templateId" required>
              <Select id="templateId" name="templateId" required defaultValue={templates[0]?.id}>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.kind}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Issue date" htmlFor="issueDate" required>
              <DateInput id="issueDate" name="issueDate" required defaultValue={today()} />
            </Field>
          </FormGrid>
          {issue.state.error ? <FormError>{issue.state.error}</FormError> : null}
        </form>
      </Dialog>
    </>
  );
}
