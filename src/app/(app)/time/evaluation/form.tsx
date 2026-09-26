"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { runTimeEvaluation, type ActionState } from "@/app/actions/time";
import { Button, Card, CardHeader } from "@/components/ui";
import { Field, Select, FormGrid, FormError } from "@/components/inputs";
import { useToast } from "@/components/toast";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function RunEvaluationForm({ year, month }: { year: number; month: number }) {
  const toast = useToast();
  const router = useRouter();

  const [state, action, pending] = useActionState(
    async (prev: ActionState, form: FormData): Promise<ActionState> => {
      const result = await runTimeEvaluation(prev, form);
      if (result.ok) {
        toast("Time evaluation run");
        router.push(`/time/evaluation?year=${form.get("year")}&month=${form.get("month")}`);
      }
      return result;
    },
    {},
  );

  const years = Array.from({ length: 5 }, (_, i) => year - 2 + i);

  return (
    <Card>
      <CardHeader
        title="Run evaluation"
        description="Recalculates the period from the absence and attendance records as they stand now."
      />
      <form action={action} className="px-6 pb-5">
        <FormGrid columns={3}>
          <Field label="Month" htmlFor="month" required>
            <Select id="month" name="month" defaultValue={String(month)}>
              {MONTHS.map((m, i) => (
                <option key={m} value={i + 1}>
                  {m}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Year" htmlFor="year" required>
            <Select id="year" name="year" defaultValue={String(year)}>
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
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
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? <Loader2 className="animate-spin" /> : null}
            Run evaluation
          </Button>
        </div>
      </form>
    </Card>
  );
}
