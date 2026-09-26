"use client";

import * as React from "react";
import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import {
  generateIncrements,
  updateIncrement,
  approveIncrement,
  pushIncrementsToPayroll,
  type ActionState,
} from "@/app/actions/performance";
import { Button, Card, CardHeader } from "@/components/ui";
import { Dialog } from "@/components/dialog";
import { Field, Select, Input, DateInput, FormGrid, FormError } from "@/components/inputs";
import { useToast } from "@/components/toast";

export function GenerateIncrementsForm({
  cycles,
  selectedCycle,
}: {
  cycles: { value: string; label: string }[];
  selectedCycle: string;
}) {
  const toast = useToast();
  const router = useRouter();
  const nextApril = `${new Date().getUTCFullYear() + (new Date().getUTCMonth() >= 3 ? 1 : 0)}-04-01`;

  const [state, action, pending] = useActionState(
    async (prev: ActionState, form: FormData): Promise<ActionState> => {
      const result = await generateIncrements(prev, form);
      if (result.ok) toast("Recommendations generated");
      return result;
    },
    {},
  );

  return (
    <Card>
      <CardHeader
        title="Generate recommendations"
        description="Builds a draft for every finalised appraisal, using the salary valid on the effective date. Anything already approved or pushed is left alone."
      />
      <form action={action} className="px-6 pb-5">
        <FormGrid columns={3}>
          <Field label="Cycle" htmlFor="cycleId" required>
            <Select
              id="cycleId"
              name="cycleId"
              value={selectedCycle}
              onChange={(e) => router.push(`/performance/increments?cycle=${e.target.value}`)}
            >
              {cycles.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Effective from"
            htmlFor="effectiveDate"
            required
            hint="The date the new salary starts."
          >
            <DateInput id="effectiveDate" name="effectiveDate" defaultValue={nextApril} required />
          </Field>
        </FormGrid>

        {state.error ? (
          <div className="mt-4">
            <FormError>{state.error}</FormError>
          </div>
        ) : null}

        <div className="mt-4">
          <Button type="submit" variant="secondary" disabled={pending}>
            {pending ? <Loader2 className="animate-spin" /> : null}
            Generate recommendations
          </Button>
        </div>
      </form>
    </Card>
  );
}

export function IncrementActions({
  id,
  status,
  employeeName,
  currentPercent,
  effectiveDate,
}: {
  id: number;
  status: string;
  employeeName: string;
  currentPercent: string;
  effectiveDate: string;
}) {
  const toast = useToast();
  const [editing, setEditing] = React.useState(false);

  const [editState, edit, editPending] = useActionState(
    async (prev: ActionState, form: FormData): Promise<ActionState> => {
      const result = await updateIncrement(prev, form);
      if (result.ok) {
        setEditing(false);
        toast("Increment updated");
      }
      return result;
    },
    {},
  );

  const [approveState, approve, approvePending] = useActionState(
    async (prev: ActionState, form: FormData): Promise<ActionState> => {
      const result = await approveIncrement(prev, form);
      if (result.ok) toast("Increment approved");
      return result;
    },
    {},
  );

  if (status === "Pushed") {
    return <span className="text-[13px] text-muted">Written to basic pay</span>;
  }

  return (
    <>
      <div className="flex flex-col items-end gap-1">
        <div className="flex justify-end gap-1">
          {status === "Draft" ? (
            <>
              <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
                Adjust
              </Button>
              <form action={approve}>
                <input type="hidden" name="id" value={id} />
                <Button type="submit" size="sm" variant="primary" disabled={approvePending}>
                  {approvePending ? <Loader2 className="animate-spin" /> : null}
                  Approve
                </Button>
              </form>
            </>
          ) : (
            <span className="text-[13px] text-muted">Waiting to be pushed</span>
          )}
        </div>
        {approveState.error ? (
          <span className="text-[13px] text-danger">{approveState.error}</span>
        ) : null}
      </div>

      <Dialog
        open={editing}
        onClose={() => setEditing(false)}
        title={`Adjust increment for ${employeeName}`}
        description="The new salary is recalculated from the percentage."
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(false)} disabled={editPending}>
              Cancel
            </Button>
            <Button type="submit" form="edit-increment" variant="primary" disabled={editPending}>
              {editPending ? <Loader2 className="animate-spin" /> : null}
              Save increment
            </Button>
          </>
        }
      >
        <form id="edit-increment" action={edit} className="flex flex-col gap-4 pb-1">
          <input type="hidden" name="id" value={id} />
          <Field label="Increment %" htmlFor="incrementPercent" required>
            <Input
              id="incrementPercent"
              name="incrementPercent"
              defaultValue={currentPercent}
              className="tabular"
              required
            />
          </Field>
          <Field label="Effective from" htmlFor="editEffective">
            <DateInput id="editEffective" name="effectiveDate" defaultValue={effectiveDate} />
          </Field>
          {editState.error ? <FormError>{editState.error}</FormError> : null}
        </form>
      </Dialog>
    </>
  );
}

export function PushAllButton({ cycleId }: { cycleId: number }) {
  const toast = useToast();
  const [state, action, pending] = useActionState(
    async (prev: ActionState, form: FormData): Promise<ActionState> => {
      const result = await pushIncrementsToPayroll(prev, form);
      if (result.ok) toast("Increments written to basic pay");
      return result;
    },
    {},
  );

  return (
    <form action={action} className="shrink-0">
      <input type="hidden" name="cycleId" value={cycleId} />
      <Button type="submit" variant="primary" disabled={pending}>
        {pending ? <Loader2 className="animate-spin" /> : null}
        Push to basic pay
      </Button>
      {state.error ? (
        <div className="mt-1 text-[13px] text-danger">{state.error}</div>
      ) : null}
    </form>
  );
}
