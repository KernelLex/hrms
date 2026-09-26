"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { saveDelegation, endDelegation, type ActionState } from "@/app/actions/approvals";
import { Button, Card, CardHeader } from "@/components/ui";
import { DateInput, Field, FormError, FormGrid, Select } from "@/components/inputs";
import { useToast } from "@/components/toast";

type Delegation = {
  id: number;
  mine: boolean;
  other: string;
  range: string;
};

/**
 * "While I am away, send my approvals to…" — the person chosen decides what
 * is waiting for you between the dates, and the record says on whose behalf.
 */
export function AwayCard({
  delegations,
  people,
  today,
}: {
  delegations: Delegation[];
  people: { id: number; label: string }[];
  today: string;
}) {
  const toast = useToast();
  const [state, save, saving] = useActionState(
    async (prev: ActionState, form: FormData): Promise<ActionState> => {
      const result = await saveDelegation(prev, form);
      if (result.ok) toast("Approvals handed over");
      return result;
    },
    {},
  );
  const [endState, end, ending] = useActionState(
    async (prev: ActionState, form: FormData): Promise<ActionState> => {
      const result = await endDelegation(prev, form);
      if (result.ok) toast("Hand-over ended");
      return result;
    },
    {},
  );

  return (
    <Card id="away">
      <CardHeader
        title="While I am away"
        description="Send the approvals waiting for you to someone else for a few days. Each decision they make says it was on your behalf."
      />
      {delegations.length > 0 ? (
        <ul className="px-6">
          {delegations.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-4 border-b border-soft py-3 last:border-0">
              <div className="min-w-0 text-sm text-ink">
                {d.mine ? (
                  <>
                    <span className="font-medium">{d.other}</span> approves for you
                  </>
                ) : (
                  <>
                    You approve for <span className="font-medium">{d.other}</span>
                  </>
                )}
                <div className="tabular text-xs text-muted">{d.range}</div>
              </div>
              {d.mine ? (
                <form action={end}>
                  <input type="hidden" name="id" value={d.id} />
                  <Button type="submit" size="sm" variant="ghost" disabled={ending}>
                    End now
                  </Button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {endState.error ? (
        <div className="px-6 pb-2">
          <FormError>{endState.error}</FormError>
        </div>
      ) : null}
      <form action={save} className="border-t border-soft px-6 py-5">
        <FormGrid columns={1}>
          <Field label="Send my approvals to" htmlFor="toUserId" required>
            <Select id="toUserId" name="toUserId" defaultValue="" required>
              <option value="" disabled>
                Choose a person
              </option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </Select>
          </Field>
          <FormGrid columns={2}>
            <Field label="First day away" htmlFor="fromDate" required>
              <DateInput id="fromDate" name="fromDate" defaultValue={today} required />
            </Field>
            <Field label="Last day away" htmlFor="toDate" required>
              <DateInput id="toDate" name="toDate" required />
            </Field>
          </FormGrid>
        </FormGrid>
        {state.error ? (
          <div className="mt-4">
            <FormError>{state.error}</FormError>
          </div>
        ) : null}
        <div className="mt-4 flex justify-end">
          <Button type="submit" disabled={saving}>
            {saving ? <Loader2 className="animate-spin" /> : null}
            Hand over approvals
          </Button>
        </div>
      </form>
    </Card>
  );
}
