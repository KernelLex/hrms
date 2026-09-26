"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { generateForm16, type ActionState } from "@/app/actions/tax";
import { Button, Card, CardHeader } from "@/components/ui";
import { Field, Select, Input, FormGrid, FormError } from "@/components/inputs";
import { useToast } from "@/components/toast";

export function GenerateForm16Form({
  employees,
  years,
  pendingCount,
}: {
  employees: { value: string; label: string }[];
  years: { value: string; label: string }[];
  pendingCount: number;
}) {
  const toast = useToast();

  const [state, action, pending] = useActionState(
    async (prev: ActionState, form: FormData): Promise<ActionState> => {
      const result = await generateForm16(prev, form);
      if (result.ok) toast("Certificate generated");
      return result;
    },
    {},
  );

  return (
    <Card>
      <CardHeader
        title="Generate a certificate"
        description={
          pendingCount > 0
            ? `${pendingCount} employee year${pendingCount === 1 ? " has" : "s have"} deductions recorded but no certificate yet.`
            : "Regenerating replaces the stored computation, keeping the certificate number."
        }
      />
      <form action={action} className="px-6 pb-5">
        <FormGrid columns={3}>
          <Field label="Employee" htmlFor="employeeId" required>
            <Select id="employeeId" name="employeeId" required>
              {employees.map((e) => (
                <option key={e.value} value={e.value}>
                  {e.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Financial year" htmlFor="financialYear" required>
            <Select id="financialYear" name="financialYear" required>
              {years.map((y) => (
                <option key={y.value} value={y.value}>
                  {y.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Employee PAN" htmlFor="employeePan" hint="Printed on the certificate.">
            <Input id="employeePan" name="employeePan" placeholder="ABCPM1234D" className="uppercase" />
          </Field>
          <Field label="Employer TAN" htmlFor="employerTan">
            <Input id="employerTan" name="employerTan" placeholder="BLRA12345B" className="uppercase" />
          </Field>
          <Field label="Employer PAN" htmlFor="employerPan">
            <Input id="employerPan" name="employerPan" placeholder="AACCA1234B" className="uppercase" />
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
            Generate certificate
          </Button>
        </div>
      </form>
    </Card>
  );
}
