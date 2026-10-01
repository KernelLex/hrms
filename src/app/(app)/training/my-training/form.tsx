"use client";

import * as React from "react";
import { useActionState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { nominate, saveCertification, deleteCertification, type ActionState } from "@/app/actions/training";
import { Button } from "@/components/ui";
import { Field, Input, DateInput, FormError, FormGrid } from "@/components/inputs";
import { useToast } from "@/components/toast";

export function NominateForm({ sessionId, full }: { sessionId: number; full: boolean }) {
  const toast = useToast();
  const [state, action, pending] = useActionState(
    async (prev: ActionState, form: FormData): Promise<ActionState> => {
      const result = await nominate(prev, form);
      if (result.ok) toast("Nominated");
      return result;
    },
    {},
  );

  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <input type="hidden" name="sessionId" value={sessionId} />
      <Button type="submit" size="sm" variant="secondary" disabled={pending || full}>
        {pending ? <Loader2 className="animate-spin" /> : null}
        {full ? "Full" : "Nominate me"}
      </Button>
      {state.error ? <FormError>{state.error}</FormError> : null}
    </form>
  );
}

export function CertificationForm() {
  const toast = useToast();
  const formRef = React.useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState(
    async (prev: ActionState, form: FormData): Promise<ActionState> => {
      const result = await saveCertification(prev, form);
      if (result.ok) {
        toast("Certification added");
        formRef.current?.reset();
      }
      return result;
    },
    {},
  );

  return (
    <form ref={formRef} action={action} className="flex flex-col gap-4">
      <FormGrid>
        <Field label="Name" htmlFor="name" required>
          <Input id="name" name="name" required placeholder="Forklift license" />
        </Field>
        <Field label="Issuer" htmlFor="issuer">
          <Input id="issuer" name="issuer" />
        </Field>
        <Field label="Issued" htmlFor="issuedDate" required>
          <DateInput id="issuedDate" name="issuedDate" required />
        </Field>
        <Field label="Expires" htmlFor="expiryDate" hint="Leave blank if it never expires.">
          <DateInput id="expiryDate" name="expiryDate" />
        </Field>
        <Field label="Certificate (optional)" htmlFor="file">
          <input id="file" name="file" type="file" className="text-[13px]" />
        </Field>
      </FormGrid>
      {state.error ? <FormError>{state.error}</FormError> : null}
      <div>
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : null}
          Add certification
        </Button>
      </div>
    </form>
  );
}

export function DeleteCertificationButton({ id }: { id: number }) {
  const toast = useToast();
  const [, action, pending] = useActionState(
    async (prev: ActionState, form: FormData): Promise<ActionState> => {
      const result = await deleteCertification(prev, form);
      if (result.ok) toast("Removed");
      return result;
    },
    {},
  );

  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <Button type="submit" size="sm" variant="ghost" disabled={pending} aria-label="Remove">
        <Trash2 className="size-4" />
      </Button>
    </form>
  );
}
