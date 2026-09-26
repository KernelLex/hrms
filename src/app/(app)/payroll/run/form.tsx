"use client";

import * as React from "react";
import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { runPayrollAction, type ActionState } from "@/app/actions/payroll";
import { Button, Card, CardHeader } from "@/components/ui";
import { Field, Select, FormGrid, FormError } from "@/components/inputs";
import { useToast } from "@/components/toast";

type Period = { value: string; label: string; runnable: boolean };

export function RunForm({
  periods,
  selectedId,
}: {
  periods: Period[];
  selectedId: string;
}) {
  const toast = useToast();
  const router = useRouter();
  const [periodId, setPeriodId] = React.useState(selectedId);
  const selected = periods.find((p) => p.value === periodId);

  const [state, action, pending] = useActionState(
    async (prev: ActionState, form: FormData): Promise<ActionState> => {
      const result = await runPayrollAction(prev, form);
      if (result.ok) toast("Payroll run complete");
      return result;
    },
    {},
  );

  return (
    <Card>
      <CardHeader
        title="Period"
        description="Only a released period can be run. Running again replaces the previous results for that period."
      />
      <form action={action} className="px-6 pb-5">
        <FormGrid columns={2}>
          <Field label="Payroll period" htmlFor="periodId" required>
            <Select
              id="periodId"
              name="periodId"
              value={periodId}
              onChange={(e) => {
                setPeriodId(e.target.value);
                router.push(`/payroll/run?period=${e.target.value}`);
              }}
            >
              {periods.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
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

        <div className="mt-4">
          <Button
            type="submit"
            variant="primary"
            disabled={pending || !selected?.runnable}
          >
            {pending ? <Loader2 className="animate-spin" /> : null}
            Run payroll
          </Button>
        </div>
      </form>
    </Card>
  );
}
