"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { saveProofWindow, type ActionState } from "@/app/actions/tax";
import { Button } from "@/components/ui";
import { Field, Select, DateInput, FormGrid, FormError } from "@/components/inputs";
import { useToast } from "@/components/toast";
import { todayInIndia } from "@/lib/dates";

/** "2026-27" for today, and the two years either side — enough to open a window for any year in reach. */
function financialYears(): string[] {
  const y = Number(todayInIndia().slice(0, 4));
  return [y - 1, y, y + 1].map((start) => `${start}-${String((start + 1) % 100).padStart(2, "0")}`);
}

export function ProofWindowForm() {
  const toast = useToast();
  const [state, action, pending] = useActionState(
    async (prev: ActionState, form: FormData): Promise<ActionState> => {
      const result = await saveProofWindow(prev, form);
      if (result.ok) toast("Proof window saved");
      return result;
    },
    {},
  );

  return (
    <form action={action} className="px-6 pb-5">
      <FormGrid columns={3}>
        <Field label="Financial year" htmlFor="financialYear" required>
          <Select id="financialYear" name="financialYear" required defaultValue="">
            <option value="" disabled>
              Choose one
            </option>
            {financialYears().map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Opens" htmlFor="opensAt" required>
          <DateInput id="opensAt" name="opensAt" required />
        </Field>
        <Field label="Closes" htmlFor="closesAt" required>
          <DateInput id="closesAt" name="closesAt" required />
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
          Save window
        </Button>
      </div>
    </form>
  );
}
