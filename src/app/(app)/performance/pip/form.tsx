"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { savePip, addPipCheckin, closePip, type ActionState } from "@/app/actions/performance";
import { Button } from "@/components/ui";
import { Field, Select, Input, Textarea, DateInput, FormError, FormGrid, FormFull } from "@/components/inputs";
import { useToast } from "@/components/toast";

type Choice = { id: number; label: string };

export function PipForm({ employees }: { employees: Choice[] }) {
  const toast = useToast();
  const [state, action, pending] = useActionState(
    async (prev: ActionState, form: FormData): Promise<ActionState> => {
      const result = await savePip(prev, form);
      if (result.ok) toast("Plan opened");
      return result;
    },
    {},
  );

  return (
    <form action={action} className="flex flex-col gap-4">
      <FormGrid>
        <Field label="Employee" htmlFor="employeeId" required>
          <Select id="employeeId" name="employeeId" required defaultValue="">
            <option value="">Choose who this plan is for</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Start date" htmlFor="startDate" required>
          <DateInput id="startDate" name="startDate" required />
        </Field>
        <Field label="End date" htmlFor="endDate" required>
          <DateInput id="endDate" name="endDate" required />
        </Field>
        <FormFull>
          <Field label="Why this plan is needed" htmlFor="reason" required>
            <Textarea id="reason" name="reason" required rows={3} />
          </Field>
        </FormFull>
        <FormFull>
          <Field label="Goals" htmlFor="goals" required hint="What needs to improve, and by when.">
            <Textarea id="goals" name="goals" required rows={3} />
          </Field>
        </FormFull>
      </FormGrid>
      {state.error ? <FormError>{state.error}</FormError> : null}
      <div>
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : null}
          Open plan
        </Button>
      </div>
    </form>
  );
}

export function PipCheckinForm({ pipId }: { pipId: number }) {
  const toast = useToast();
  const [state, action, pending] = useActionState(
    async (prev: ActionState, form: FormData): Promise<ActionState> => {
      const result = await addPipCheckin(prev, form);
      if (result.ok) toast("Check-in added");
      return result;
    },
    {},
  );

  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="pipId" value={pipId} />
      <Field label="Check in" htmlFor={`note-${pipId}`} className="min-w-[220px] flex-1">
        <Input id={`note-${pipId}`} name="note" placeholder="How this week went" />
      </Field>
      {state.error ? <FormError>{state.error}</FormError> : null}
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? <Loader2 className="animate-spin" /> : null}
        Add
      </Button>
    </form>
  );
}

export function ClosePipForm({ id }: { id: number }) {
  const toast = useToast();
  const [state, action, pending] = useActionState(
    async (prev: ActionState, form: FormData): Promise<ActionState> => {
      const result = await closePip(prev, form);
      if (result.ok) toast("Plan closed");
      return result;
    },
    {},
  );

  return (
    <form action={action} className="flex items-end gap-2">
      <input type="hidden" name="id" value={id} />
      <Field label="Close as" htmlFor={`outcome-${id}`}>
        <Select id={`outcome-${id}`} name="outcome" defaultValue="Passed">
          <option value="Passed">Passed</option>
          <option value="Failed">Failed</option>
        </Select>
      </Field>
      {state.error ? <FormError>{state.error}</FormError> : null}
      <Button type="submit" variant="ghost" disabled={pending}>
        {pending ? <Loader2 className="animate-spin" /> : null}
        Close
      </Button>
    </form>
  );
}
