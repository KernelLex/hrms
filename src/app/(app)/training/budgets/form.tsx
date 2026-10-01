"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { saveDepartmentBudget, type ActionState } from "@/app/actions/training";
import { Button } from "@/components/ui";
import { Field, Select, Input, FormError, FormGrid } from "@/components/inputs";
import { useToast } from "@/components/toast";

export function BudgetForm({ units }: { units: { code: string; name: string }[] }) {
  const toast = useToast();
  const [state, action, pending] = useActionState(
    async (prev: ActionState, form: FormData): Promise<ActionState> => {
      const result = await saveDepartmentBudget(prev, form);
      if (result.ok) toast("Budget saved");
      return result;
    },
    {},
  );

  return (
    <form action={action} className="flex flex-col gap-4">
      <FormGrid>
        <Field label="Department" htmlFor="orgUnitCode" required>
          <Select id="orgUnitCode" name="orgUnitCode" required defaultValue="">
            <option value="">Choose a department</option>
            {units.map((u) => (
              <option key={u.code} value={u.code}>
                {u.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Year" htmlFor="year" required>
          <Input id="year" name="year" inputMode="numeric" required placeholder="2026" />
        </Field>
        <Field label="Allocated (₹)" htmlFor="allocated" required>
          <Input id="allocated" name="allocated" inputMode="decimal" required placeholder="200000" />
        </Field>
      </FormGrid>
      {state.error ? <FormError>{state.error}</FormError> : null}
      <div>
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : null}
          Save budget
        </Button>
      </div>
    </form>
  );
}
