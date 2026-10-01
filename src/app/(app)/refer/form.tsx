"use client";

import { useActionState } from "react";
import { CircleCheck } from "lucide-react";
import { referCandidate } from "@/app/actions/recruitment";
import type { ActionState } from "@/app/actions/recruitment";
import { Button } from "@/components/ui";
import { Field, FormError, FormGrid, Input, Select } from "@/components/inputs";

/** Who they are, and which open role they fit — the role is optional. */
export function ReferForm({ roles }: { roles: { id: number; label: string }[] }) {
  const [state, action, pending] = useActionState(referCandidate, {} as ActionState);

  if (state.ok) {
    return (
      <div className="flex items-start gap-2 py-2" role="status">
        <CircleCheck className="size-5 text-ink" />
        <p className="text-[14px] text-ink">Thank you — recruitment will take it from here.</p>
      </div>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-4">
      <FormGrid>
        <Field label="Their name" htmlFor="fullName" required>
          <Input id="fullName" name="fullName" required maxLength={120} />
        </Field>
        <Field label="Their email" htmlFor="email" required>
          <Input id="email" name="email" type="email" required maxLength={200} />
        </Field>
        <Field label="Their phone" htmlFor="phone">
          <Input id="phone" name="phone" maxLength={40} />
        </Field>
        <Field label="Role (optional)" htmlFor="requisitionId" hint="Leave blank if you are not sure which role fits.">
          <Select id="requisitionId" name="requisitionId" defaultValue="">
            <option value="">No specific role</option>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </Select>
        </Field>
      </FormGrid>
      {state.error ? <FormError>{state.error}</FormError> : null}
      <div>
        <Button type="submit" variant="primary" disabled={pending}>
          Refer them
        </Button>
      </div>
    </form>
  );
}
