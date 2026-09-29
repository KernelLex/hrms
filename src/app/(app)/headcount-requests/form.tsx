"use client";

import * as React from "react";
import { useActionState } from "react";
import { Loader2, Plus } from "lucide-react";
import { requestHeadcount, type ActionState } from "@/app/actions/headcount";
import { Button } from "@/components/ui";
import { Dialog } from "@/components/dialog";
import { Field, FormError, FormGrid, Input, NumberInput, Select, Textarea } from "@/components/inputs";
import { useToast } from "@/components/toast";

const INITIAL: ActionState = {};

export function NewHeadcountRequestButton({
  units,
  jobs,
}: {
  units: { value: string; label: string }[];
  jobs: { value: string; label: string }[];
}) {
  const toast = useToast();
  const [open, setOpen] = React.useState(false);
  const formId = React.useId();
  const [state, action, pending] = useActionState(async (prev: ActionState, form: FormData) => {
    const r = await requestHeadcount(prev, form);
    if (r.ok) {
      setOpen(false);
      toast("Headcount request sent for approval");
    }
    return r;
  }, INITIAL);

  return (
    <>
      <Button type="button" variant="primary" onClick={() => setOpen(true)}>
        <Plus /> New request
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Ask for a new position"
        description="Goes to your manager, then HR, then finance to approve."
        wide
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" form={formId} variant="primary" disabled={pending}>
              {pending ? <Loader2 className="animate-spin" /> : null}
              Send for approval
            </Button>
          </>
        }
      >
        <form id={formId} action={action} className="flex flex-col gap-4 pb-1">
          <FormGrid columns={2}>
            <Field label="Position title" htmlFor="title" required>
              <Input id="title" name="title" required placeholder="Backend engineer" />
            </Field>
            <Field label="Grade" htmlFor="grade" hint="Optional.">
              <Input id="grade" name="grade" placeholder="L3" />
            </Field>
            <Field label="Department" htmlFor="orgUnitCode" required>
              <Select id="orgUnitCode" name="orgUnitCode" required defaultValue={units[0]?.value}>
                {units.map((u) => (
                  <option key={u.value} value={u.value}>
                    {u.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Job" htmlFor="jobCode" required>
              <Select id="jobCode" name="jobCode" required defaultValue={jobs[0]?.value}>
                {jobs.map((j) => (
                  <option key={j.value} value={j.value}>
                    {j.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Monthly budget" htmlFor="budget" required hint="Rupees a month, all in.">
              <NumberInput id="budget" name="budget" required min={1} placeholder="90000" />
            </Field>
          </FormGrid>
          <Field label="Reason" htmlFor="reason" hint="Optional — helps whoever approves it.">
            <Textarea id="reason" name="reason" rows={3} placeholder="Growing the platform team to keep up with the roadmap." />
          </Field>
          {state.error ? <FormError>{state.error}</FormError> : null}
        </form>
      </Dialog>
    </>
  );
}
