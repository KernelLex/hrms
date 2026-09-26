"use client";

import * as React from "react";
import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { generateQuotaAction, type ActionState } from "@/app/actions/time";
import { Button, Card, CardHeader } from "@/components/ui";
import { Field, Select, Input, FormGrid, FormError } from "@/components/inputs";
import { useToast } from "@/components/toast";

type QuotaType = { value: string; label: string; defaultDays: number };

export function GenerateQuotaForm({
  year,
  types,
}: {
  year: number;
  types: QuotaType[];
}) {
  const toast = useToast();
  const [typeCode, setTypeCode] = React.useState(types[0]?.value ?? "");
  const selected = types.find((t) => t.value === typeCode);

  const [state, action, pending] = useActionState(
    async (prev: ActionState, form: FormData): Promise<ActionState> => {
      const result = await generateQuotaAction(prev, form);
      if (result.ok) toast("Quota generated");
      return result;
    },
    {},
  );

  return (
    <Card>
      <CardHeader
        title="Generate entitlement"
        description="Grants leave for every employee. Re-running adjusts the entitlement and leaves whatever has already been taken untouched."
      />
      <form action={action} className="px-6 pb-5">
        <FormGrid columns={3}>
          <Field label="Quota type" htmlFor="quotaTypeCode" required>
            <Select
              id="quotaTypeCode"
              name="quotaTypeCode"
              value={typeCode}
              onChange={(e) => setTypeCode(e.target.value)}
            >
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
          <Field
            label="Entitlement days"
            htmlFor="entitlementDays"
            required
            hint={selected ? `Standard is ${selected.defaultDays} days.` : undefined}
          >
            <Input
              id="entitlementDays"
              name="entitlementDays"
              key={typeCode}
              defaultValue={String(selected?.defaultDays ?? 0)}
              className="tabular"
            />
          </Field>
        </FormGrid>

        {state.error ? (
          <div className="mt-4">
            <FormError>{state.error}</FormError>
          </div>
        ) : null}

        <div className="mt-4">
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? <Loader2 className="animate-spin" /> : null}
            Generate quota
          </Button>
        </div>
      </form>
    </Card>
  );
}
