"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { convertToEmployee, type ActionState } from "@/app/actions/recruitment";
import { Button } from "@/components/ui";
import { Field, Input, DateInput, FormGrid, FormError } from "@/components/inputs";
import { useToast } from "@/components/toast";

export function ConvertForm({
  applicationId,
  defaultSalary,
  disabled,
}: {
  applicationId: number;
  defaultSalary: string;
  disabled?: boolean;
}) {
  const toast = useToast();
  const router = useRouter();

  const [state, action, pending] = useActionState(
    async (prev: ActionState, form: FormData): Promise<ActionState> => {
      const result = await convertToEmployee(prev, form);
      if (result.ok && result.employeeId) {
        toast("Candidate converted to employee");
        router.push(`/core-hr/${result.employeeId}`);
      }
      return result;
    },
    {},
  );

  return (
    <form action={action}>
      <input type="hidden" name="applicationId" value={applicationId} />
      <FormGrid columns={3}>
        <Field label="Hire date" htmlFor={`hireDate-${applicationId}`} required>
          <DateInput id={`hireDate-${applicationId}`} name="hireDate" required />
        </Field>
        <Field
          label="Starting basic salary"
          htmlFor={`salary-${applicationId}`}
          required
          hint="Per month, in rupees."
        >
          <Input
            id={`salary-${applicationId}`}
            name="salary"
            defaultValue={defaultSalary}
            placeholder="68000"
            required
          />
        </Field>
      </FormGrid>

      {state.error ? (
        <div className="mt-4">
          <FormError>{state.error}</FormError>
        </div>
      ) : null}

      <div className="mt-4">
        <Button type="submit" variant="primary" disabled={pending || disabled}>
          {pending ? <Loader2 className="animate-spin" /> : null}
          Convert to employee
        </Button>
      </div>
    </form>
  );
}
