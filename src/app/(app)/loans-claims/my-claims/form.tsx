"use client";

import * as React from "react";
import { useActionState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { submitClaim, type ActionState } from "@/app/actions/loans-claims";
import { Button, Card, CardHeader } from "@/components/ui";
import { Field, Input, Select, DateInput, FormGrid, FormError } from "@/components/inputs";
import { useToast } from "@/components/toast";
import { todayInIndia } from "@/lib/dates";

type Category = { value: string; label: string };
type Line = { key: number; date: string; description: string; amount: string };

let nextKey = 0;

export function RequestClaimForm({ categories }: { categories: Category[] }) {
  const toast = useToast();
  const [lines, setLines] = React.useState<Line[]>([{ key: nextKey++, date: todayInIndia(), description: "", amount: "" }]);

  const [state, action, pending] = useActionState(
    async (prev: ActionState, form: FormData): Promise<ActionState> => {
      const result = await submitClaim(prev, form);
      if (result.ok) {
        toast("Claim sent for approval");
        setLines([{ key: nextKey++, date: todayInIndia(), description: "", amount: "" }]);
      }
      return result;
    },
    {},
  );

  const update = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const remove = (key: number) => setLines((ls) => (ls.length > 1 ? ls.filter((l) => l.key !== key) : ls));
  const add = () => setLines((ls) => [...ls, { key: nextKey++, date: todayInIndia(), description: "", amount: "" }]);
  const total = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);

  return (
    <Card>
      <CardHeader title="Submit a claim" description="One or more lines, each with its own bill. Goes to your reporting manager, then Finance." />
      <form action={action} className="px-6 pb-5">
        <FormGrid columns={2}>
          <Field label="Category" htmlFor="categoryCode" required>
            <Select id="categoryCode" name="categoryCode" required defaultValue="">
              <option value="" disabled>
                Choose one
              </option>
              {categories.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Claim date" htmlFor="claimDate" required>
            <DateInput id="claimDate" name="claimDate" defaultValue={todayInIndia()} required />
          </Field>
        </FormGrid>

        <div className="mt-4 flex flex-col gap-4">
          {lines.map((l, i) => (
            <div key={l.key} className="rounded-2xl border border-line p-4">
              <FormGrid columns={3}>
                <Field label="Date" htmlFor={`ld-${l.key}`} required>
                  <DateInput id={`ld-${l.key}`} name={`line_date_${i}`} value={l.date} onChange={(e) => update(l.key, { date: e.target.value })} required />
                </Field>
                <Field label="What for" htmlFor={`lde-${l.key}`} required>
                  <Input id={`lde-${l.key}`} name={`line_description_${i}`} value={l.description} onChange={(e) => update(l.key, { description: e.target.value })} required />
                </Field>
                <Field label="Amount" htmlFor={`la-${l.key}`} required>
                  <Input id={`la-${l.key}`} name={`line_amount_${i}`} type="number" min="1" step="1" value={l.amount} onChange={(e) => update(l.key, { amount: e.target.value })} required />
                </Field>
              </FormGrid>
              <div className="mt-3 flex items-end justify-between gap-4">
                <Field label="Bill" htmlFor={`lf-${l.key}`} required className="flex-1" hint="A PDF or photo of the bill for this line.">
                  <input id={`lf-${l.key}`} name={`line_file_${i}`} type="file" required accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" className="text-[13px] text-secondary" />
                </Field>
                {lines.length > 1 ? (
                  <Button type="button" variant="ghost" size="sm" onClick={() => remove(l.key)}>
                    <Trash2 />
                    Remove
                  </Button>
                ) : null}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-3 flex items-center justify-between">
          <Button type="button" variant="secondary" size="sm" onClick={add}>
            <Plus />
            Add line
          </Button>
          <span className="text-[13px] text-muted">Total ₹{total.toLocaleString("en-IN")}</span>
        </div>

        {state.error ? (
          <div className="mt-3">
            <FormError>{state.error}</FormError>
          </div>
        ) : null}
        <div className="mt-3">
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? <Loader2 className="animate-spin" /> : null}
            Submit claim
          </Button>
        </div>
      </form>
    </Card>
  );
}
