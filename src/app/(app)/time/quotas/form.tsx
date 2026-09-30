"use client";

import * as React from "react";
import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { adjustQuotaAction, type ActionState } from "@/app/actions/time";
import { Button, Card, CardHeader } from "@/components/ui";
import { Field, Select, Input, FormGrid, FormError } from "@/components/inputs";
import { useToast } from "@/components/toast";

type QuotaType = { value: string; label: string };
type Employee = { value: string; label: string };

export function AdjustQuotaForm({
  year,
  types,
  employees,
}: {
  year: number;
  types: QuotaType[];
  employees: Employee[];
}) {
  const toast = useToast();

  const [state, action, pending] = useActionState(
    async (prev: ActionState, form: FormData): Promise<ActionState> => {
      const result = await adjustQuotaAction(prev, form);
      if (result.ok) toast("Balance adjusted");
      return result;
    },
    {},
  );

  return (
    <Card>
      <CardHeader
        title="Adjust a balance"
        description="A one-off change outside what a policy accrues automatically — a correction, or a goodwill day. Positive days grant more; negative days take some away. Shows up on that person's ledger with the reason given."
      />
      <form action={action} className="px-6 pb-5">
        <FormGrid columns={3}>
          <Field label="Employee" htmlFor="employeeId" required>
            <Select id="employeeId" name="employeeId" defaultValue={employees[0]?.value}>
              {employees.map((e) => (
                <option key={e.value} value={e.value}>
                  {e.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Quota type" htmlFor="quotaTypeCode" required>
            <Select id="quotaTypeCode" name="quotaTypeCode" defaultValue={types[0]?.value}>
              {types.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Year" htmlFor="year" required>
            <Input id="year" name="year" defaultValue={String(year)} className="tabular" />
          </Field>
          <Field label="Days" htmlFor="days" required hint="Negative to take days away.">
            <Input id="days" name="days" type="number" step="0.5" placeholder="1" className="tabular" />
          </Field>
        </FormGrid>
        <div className="mt-4">
          <Field label="Reason" htmlFor="reason" required>
            <Input id="reason" name="reason" placeholder="Goodwill day for covering the on-call rota" />
          </Field>
        </div>

        {state.error ? (
          <div className="mt-4">
            <FormError>{state.error}</FormError>
          </div>
        ) : null}

        <div className="mt-4">
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? <Loader2 className="animate-spin" /> : null}
            Adjust balance
          </Button>
        </div>
      </form>
    </Card>
  );
}
