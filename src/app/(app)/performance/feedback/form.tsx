"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { requestFeedback, type ActionState } from "@/app/actions/performance";
import { FEEDBACK_RELATIONSHIPS } from "@/db/schema";
import { Button } from "@/components/ui";
import { Field, Select, FormError, FormGrid } from "@/components/inputs";
import { useToast } from "@/components/toast";

type Choice = { id: number; label: string };

export function RequestFeedbackForm({ cycles, employees }: { cycles: Choice[]; employees: Choice[] }) {
  const toast = useToast();
  const [state, action, pending] = useActionState(
    async (prev: ActionState, form: FormData): Promise<ActionState> => {
      const result = await requestFeedback(prev, form);
      if (result.ok) toast("Feedback requested");
      return result;
    },
    {},
  );

  return (
    <form action={action} className="flex flex-col gap-4">
      <FormGrid>
        <Field label="Cycle" htmlFor="cycleId" required>
          <Select id="cycleId" name="cycleId" required defaultValue="">
            <option value="">Choose a cycle</option>
            {cycles.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Feedback about" htmlFor="revieweeEmployeeId" required>
          <Select id="revieweeEmployeeId" name="revieweeEmployeeId" required defaultValue="">
            <option value="">Choose who it is about</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Asked of" htmlFor="reviewerEmployeeId" required>
          <Select id="reviewerEmployeeId" name="reviewerEmployeeId" required defaultValue="">
            <option value="">Choose who is asked</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Relationship" htmlFor="relationship" required>
          <Select id="relationship" name="relationship" required defaultValue="">
            <option value="">How they relate</option>
            {FEEDBACK_RELATIONSHIPS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </Select>
        </Field>
      </FormGrid>
      {state.error ? <FormError>{state.error}</FormError> : null}
      <div>
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : null}
          Ask for feedback
        </Button>
      </div>
    </form>
  );
}
