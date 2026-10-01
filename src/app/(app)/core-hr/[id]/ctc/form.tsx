"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { saveCtc, type ActionState } from "@/app/actions/statutory";
import { Button, Card, CardHeader } from "@/components/ui";
import { Field, Input, Select, DateInput, FormGrid, FormError } from "@/components/inputs";
import { useToast } from "@/components/toast";
import { todayInIndia } from "@/lib/dates";

export function CtcForm({ employeeId, structures }: { employeeId: number; structures: { value: string; label: string }[] }) {
  const toast = useToast();
  const [state, action, pending] = useActionState(
    async (prev: ActionState, form: FormData): Promise<ActionState> => {
      const result = await saveCtc(prev, form);
      if (result.ok) toast("CTC saved");
      return result;
    },
    {},
  );

  return (
    <Card>
      <CardHeader title="Revise CTC" description="Derives basic pay and the balancing allowance from the structure; both take effect from the date below." />
      <form action={action} className="px-6 pb-5">
        <input type="hidden" name="employeeId" value={employeeId} />
        <FormGrid columns={3}>
          <Field label="Salary structure" htmlFor="structureCode" required>
            <Select id="structureCode" name="structureCode" required>
              {structures.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Annual CTC" htmlFor="annualCtc" required hint="In rupees, per year.">
            <Input id="annualCtc" name="annualCtc" type="number" min="1" step="1" required />
          </Field>
          <Field label="Valid from" htmlFor="validFrom" required>
            <DateInput id="validFrom" name="validFrom" defaultValue={todayInIndia()} required />
          </Field>
        </FormGrid>
        {state.error ? (
          <div className="mt-3">
            <FormError>{state.error}</FormError>
          </div>
        ) : null}
        <div className="mt-3">
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? <Loader2 className="animate-spin" /> : null}
            Save CTC
          </Button>
        </div>
      </form>
    </Card>
  );
}
