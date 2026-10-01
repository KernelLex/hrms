"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { submitLoan, type ActionState } from "@/app/actions/loans-claims";
import { Button, Card, CardHeader } from "@/components/ui";
import { Field, Input, Select, DateInput, Textarea, FormGrid, FormError } from "@/components/inputs";
import { useToast } from "@/components/toast";
import { todayInIndia } from "@/lib/dates";

const LOAN_TYPES = ["Personal", "Vehicle", "Housing", "Emergency", "Education"];

export function RequestLoanForm() {
  const toast = useToast();
  const [state, action, pending] = useActionState(
    async (prev: ActionState, form: FormData): Promise<ActionState> => {
      const result = await submitLoan(prev, form);
      if (result.ok) toast("Loan request sent for approval");
      return result;
    },
    {},
  );

  return (
    <Card>
      <CardHeader title="Ask for a loan" description="Goes to your reporting manager to decide. Once approved, the EMI schedule generates straight away." />
      <form action={action} className="px-6 pb-5">
        <FormGrid columns={3}>
          <Field label="Type" htmlFor="loanType" required>
            <Select id="loanType" name="loanType" required defaultValue="">
              <option value="" disabled>
                Choose one
              </option>
              {LOAN_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Amount" htmlFor="principal" required>
            <Input id="principal" name="principal" type="number" min="1" step="1" required />
          </Field>
          <Field label="Tenure, in months" htmlFor="tenureMonths" required>
            <Input id="tenureMonths" name="tenureMonths" type="number" min="1" max="120" step="1" required />
          </Field>
          <Field label="Annual interest %" htmlFor="annualRate" hint="Leave blank, or 0, for an interest-free loan.">
            <Input id="annualRate" name="annualRate" type="number" min="0" step="0.01" defaultValue="0" />
          </Field>
          <Field label="Start date" htmlFor="startDate" required>
            <DateInput id="startDate" name="startDate" defaultValue={todayInIndia()} required />
          </Field>
          <Field label="Reason" htmlFor="reason" className="sm:col-span-3">
            <Textarea id="reason" name="reason" rows={2} />
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
            Ask for this loan
          </Button>
        </div>
      </form>
    </Card>
  );
}
