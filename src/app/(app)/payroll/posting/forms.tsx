"use client";

import * as React from "react";
import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import {
  generateBankFile,
  postToLedger,
  markRemitted,
  type ActionState,
} from "@/app/actions/payroll";
import { Button, Card, CardHeader } from "@/components/ui";
import { Field, Select, DateInput, FormGrid, FormError } from "@/components/inputs";
import { useToast } from "@/components/toast";
import { todayInIndia } from "@/lib/dates";

export function PostingForms({
  runs,
  selectedRunId,
  hasBankFile,
  hasPosting,
}: {
  runs: { value: string; label: string }[];
  selectedRunId: string;
  hasBankFile: boolean;
  hasPosting: boolean;
}) {
  const toast = useToast();
  const router = useRouter();
  const today = todayInIndia();

  const [bankState, bankAction, bankPending] = useActionState(
    async (prev: ActionState, form: FormData): Promise<ActionState> => {
      const result = await generateBankFile(prev, form);
      if (result.ok) toast("Bank file generated");
      return result;
    },
    {},
  );

  const [glState, glAction, glPending] = useActionState(
    async (prev: ActionState, form: FormData): Promise<ActionState> => {
      const result = await postToLedger(prev, form);
      if (result.ok) toast("Posted to the ledger");
      return result;
    },
    {},
  );

  return (
    <Card>
      <CardHeader
        title="Run"
        description="Pick the run to work with, then generate the payment file and post the journal."
      />
      <div className="px-6 pb-5">
        <FormGrid columns={3}>
          <Field label="Payroll run" htmlFor="runSelect">
            <Select
              id="runSelect"
              value={selectedRunId}
              onChange={(e) => router.push(`/payroll/posting?run=${e.target.value}`)}
            >
              {runs.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </Select>
          </Field>
        </FormGrid>

        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <form action={bankAction}>
            <input type="hidden" name="runId" value={selectedRunId} />
            <FormGrid columns={1}>
              <Field label="Payment date" htmlFor="paymentDate" required>
                <DateInput id="paymentDate" name="paymentDate" defaultValue={today} required />
              </Field>
              <Field label="File format" htmlFor="format">
                <Select id="format" name="format" defaultValue="NEFT bulk upload (CSV)">
                  <option>NEFT bulk upload (CSV)</option>
                  <option>SWIFT MT101</option>
                  <option>Standard DME</option>
                </Select>
              </Field>
            </FormGrid>
            {bankState.error ? (
              <div className="mt-3">
                <FormError>{bankState.error}</FormError>
              </div>
            ) : null}
            <div className="mt-3">
              <Button type="submit" variant="secondary" disabled={bankPending}>
                {bankPending ? <Loader2 className="animate-spin" /> : null}
                {hasBankFile ? "Regenerate bank file" : "Generate bank file"}
              </Button>
            </div>
          </form>

          <form action={glAction}>
            <input type="hidden" name="runId" value={selectedRunId} />
            <FormGrid columns={1}>
              <Field
                label="Posting date"
                htmlFor="postingDate"
                required
                hint="Statutory due dates are derived from this."
              >
                <DateInput id="postingDate" name="postingDate" defaultValue={today} required />
              </Field>
            </FormGrid>
            {glState.error ? (
              <div className="mt-3">
                <FormError>{glState.error}</FormError>
              </div>
            ) : null}
            <div className="mt-3">
              <Button type="submit" variant="primary" disabled={glPending}>
                {glPending ? <Loader2 className="animate-spin" /> : null}
                {hasPosting ? "Repost to ledger" : "Post to ledger"}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </Card>
  );
}

export function RemitButton({ id }: { id: number }) {
  const toast = useToast();
  const [state, action, pending] = useActionState(
    async (prev: ActionState, form: FormData): Promise<ActionState> => {
      const result = await markRemitted(prev, form);
      if (result.ok) toast("Marked as remitted");
      return result;
    },
    {},
  );

  return (
    <form action={action} className="inline">
      <input type="hidden" name="id" value={id} />
      <Button type="submit" size="sm" variant="secondary" disabled={pending}>
        {pending ? <Loader2 className="animate-spin" /> : null}
        Mark remitted
      </Button>
      {state.error ? (
        <div className="mt-1 text-[13px] text-danger">{state.error}</div>
      ) : null}
    </form>
  );
}
