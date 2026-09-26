"use client";

import * as React from "react";
import { useActionState } from "react";
import { Loader2, Plus } from "lucide-react";
import { setPeriodStatus, createPeriod, type ActionState } from "@/app/actions/payroll";
import { Button, Card, CardHeader } from "@/components/ui";
import { Field, Select, Input, DateInput, FormGrid, FormError } from "@/components/inputs";
import { useToast } from "@/components/toast";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Only the transitions the control record allows are offered. */
export function PeriodActions({
  id,
  status,
  hasRun,
}: {
  id: number;
  status: string;
  hasRun: boolean;
}) {
  const toast = useToast();
  const [state, action, pending] = useActionState(
    async (prev: ActionState, form: FormData): Promise<ActionState> => {
      const result = await setPeriodStatus(prev, form);
      if (result.ok) toast(`Period ${String(form.get("status")).toLowerCase()}`);
      return result;
    },
    {},
  );

  const buttons: { label: string; target: string; variant: "primary" | "secondary" | "ghost" }[] =
    status === "Open"
      ? [{ label: "Release", target: "Locked", variant: "primary" }]
      : status === "Locked"
        ? [
            { label: "Post", target: "Posted", variant: hasRun ? "primary" : "secondary" },
            { label: "Reopen", target: "Open", variant: "ghost" },
          ]
        : [];

  if (buttons.length === 0) {
    return <span className="text-[13px] text-muted">Final</span>;
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex justify-end gap-1">
        {buttons.map((b) => (
          <form key={b.target} action={action}>
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="status" value={b.target} />
            <Button type="submit" size="sm" variant={b.variant} disabled={pending}>
              {pending ? <Loader2 className="animate-spin" /> : null}
              {b.label}
            </Button>
          </form>
        ))}
      </div>
      {state.error ? (
        <span className="text-[13px] text-danger">{state.error}</span>
      ) : null}
    </div>
  );
}

export function NewPeriodForm({ areas }: { areas: { value: string; label: string }[] }) {
  const toast = useToast();
  const [open, setOpen] = React.useState(false);
  const nowDate = new Date();

  const [state, action, pending] = useActionState(
    async (prev: ActionState, form: FormData): Promise<ActionState> => {
      const result = await createPeriod(prev, form);
      if (result.ok) {
        toast("Period created");
        setOpen(false);
      }
      return result;
    },
    {},
  );

  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <Plus />
        New period
      </Button>
    );
  }

  return (
    <Card>
      <CardHeader title="New payroll period" description="One per personnel area per month." />
      <form action={action} className="px-6 pb-5">
        <FormGrid columns={3}>
          <Field label="Personnel area" htmlFor="areaCode" required>
            <Select id="areaCode" name="areaCode" required>
              {areas.map((a) => (
                <option key={a.value} value={a.value}>
                  {a.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Month" htmlFor="month" required>
            <Select id="month" name="month" defaultValue={String(nowDate.getMonth() + 1)}>
              {MONTHS.map((m, i) => (
                <option key={m} value={i + 1}>
                  {m}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Year" htmlFor="year" required>
            <Input
              id="year"
              name="year"
              defaultValue={String(nowDate.getFullYear())}
              className="tabular"
            />
          </Field>
          <Field label="Pay date" htmlFor="payDate">
            <DateInput id="payDate" name="payDate" />
          </Field>
        </FormGrid>

        {state.error ? (
          <div className="mt-4">
            <FormError>{state.error}</FormError>
          </div>
        ) : null}

        <div className="mt-4 flex gap-2">
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? <Loader2 className="animate-spin" /> : null}
            Create period
          </Button>
        </div>
      </form>
    </Card>
  );
}
