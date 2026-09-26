"use client";

import * as React from "react";
import { useActionState } from "react";
import Link from "next/link";
import { Loader2, Plus } from "lucide-react";
import {
  advanceApplication,
  rejectApplication,
  createApplication,
  type ActionState,
} from "@/app/actions/recruitment";
import { Button, Card, CardHeader } from "@/components/ui";
import { Dialog } from "@/components/dialog";
import { Field, Select, Input, FormGrid, FormError } from "@/components/inputs";
import { useToast } from "@/components/toast";

export function PipelineActions({
  id,
  stage,
  rejected,
  describe,
}: {
  id: number;
  stage: string;
  rejected: boolean;
  describe: string;
}) {
  const toast = useToast();
  const [rejecting, setRejecting] = React.useState(false);
  const [offering, setOffering] = React.useState(false);

  const [advanceState, advance, advancing] = useActionState(
    async (prev: ActionState, form: FormData): Promise<ActionState> => {
      const result = await advanceApplication(prev, form);
      if (result.ok) {
        setOffering(false);
        toast("Moved to the next stage");
      }
      return result;
    },
    {},
  );

  const [rejectState, reject, rejectingBusy] = useActionState(
    async (prev: ActionState, form: FormData): Promise<ActionState> => {
      const result = await rejectApplication(prev, form);
      if (result.ok) {
        setRejecting(false);
        toast("Application rejected");
      }
      return result;
    },
    {},
  );

  if (rejected) return <span className="text-[13px] text-muted">Closed</span>;

  // An offered candidate is converted on the hire tab, not advanced here.
  if (stage === "Offered") {
    return (
      <Link
        href="/recruitment/hire"
        className="text-[13px] font-medium text-ink hover:underline"
      >
        Convert to employee
      </Link>
    );
  }

  if (stage === "Hired") {
    return <span className="text-[13px] text-muted">Hired</span>;
  }

  // Moving to Offered needs a salary, so it asks rather than guessing.
  const nextIsOffer = stage === "Interviewed";

  return (
    <>
      <div className="flex flex-col items-end gap-1">
        <div className="flex justify-end gap-1">
          {nextIsOffer ? (
            <Button size="sm" variant="primary" onClick={() => setOffering(true)}>
              Make offer
            </Button>
          ) : (
            <form action={advance}>
              <input type="hidden" name="id" value={id} />
              <Button type="submit" size="sm" variant="primary" disabled={advancing}>
                {advancing ? <Loader2 className="animate-spin" /> : null}
                Advance
              </Button>
            </form>
          )}
          <Button size="sm" variant="destructive" onClick={() => setRejecting(true)}>
            Reject
          </Button>
        </div>
        {advanceState.error && !offering ? (
          <span className="text-[13px] text-danger">{advanceState.error}</span>
        ) : null}
      </div>

      <Dialog
        open={offering}
        onClose={() => setOffering(false)}
        title="Make an offer"
        description={describe}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOffering(false)} disabled={advancing}>
              Cancel
            </Button>
            <Button type="submit" form="offer-form" variant="primary" disabled={advancing}>
              {advancing ? <Loader2 className="animate-spin" /> : null}
              Record offer
            </Button>
          </>
        }
      >
        <form id="offer-form" action={advance} className="pb-1">
          <input type="hidden" name="id" value={id} />
          <Field
            label="Offered basic salary"
            htmlFor="offeredSalary"
            required
            hint="Per month, in rupees. Carried into the hire conversion."
          >
            <Input id="offeredSalary" name="offeredSalary" placeholder="68000" required />
          </Field>
          {advanceState.error ? (
            <div className="mt-4">
              <FormError>{advanceState.error}</FormError>
            </div>
          ) : null}
        </form>
      </Dialog>

      <Dialog
        open={rejecting}
        onClose={() => setRejecting(false)}
        title="Reject application"
        description={describe}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRejecting(false)} disabled={rejectingBusy}>
              Cancel
            </Button>
            <Button type="submit" form="reject-app" variant="destructive" disabled={rejectingBusy}>
              {rejectingBusy ? <Loader2 className="animate-spin" /> : null}
              Reject application
            </Button>
          </>
        }
      >
        <form id="reject-app" action={reject} className="pb-1">
          <input type="hidden" name="id" value={id} />
          <Field label="Reason" htmlFor="reason" hint="Kept on the application for the record.">
            <Input id="reason" name="reason" placeholder="Not enough systems experience" />
          </Field>
          {rejectState.error ? (
            <div className="mt-4">
              <FormError>{rejectState.error}</FormError>
            </div>
          ) : null}
        </form>
      </Dialog>
    </>
  );
}

export function NewApplicationForm({
  candidates,
  requisitions,
}: {
  candidates: { value: string; label: string }[];
  requisitions: { value: string; label: string }[];
}) {
  const toast = useToast();
  const [open, setOpen] = React.useState(false);

  const [state, action, pending] = useActionState(
    async (prev: ActionState, form: FormData): Promise<ActionState> => {
      const result = await createApplication(prev, form);
      if (result.ok) {
        toast("Application created");
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
        New application
      </Button>
    );
  }

  return (
    <Card>
      <CardHeader title="New application" description="Apply an existing candidate to an open requisition." />
      <form action={action} className="px-6 pb-5">
        <FormGrid columns={2}>
          <Field label="Candidate" htmlFor="candidateId" required>
            <Select id="candidateId" name="candidateId" required>
              {candidates.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Requisition" htmlFor="requisitionId" required>
            <Select id="requisitionId" name="requisitionId" required>
              {requisitions.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </Select>
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
            Create application
          </Button>
        </div>
      </form>
    </Card>
  );
}
