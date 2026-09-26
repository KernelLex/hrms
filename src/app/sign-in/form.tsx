"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { signInAction, type SignInState } from "@/app/actions/auth";
import { Button } from "@/components/ui";
import { Field, Input, FormError } from "@/components/inputs";

const INITIAL: SignInState = {};

export function SignInForm() {
  const [state, formAction, pending] = useActionState(signInAction, INITIAL);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <Field label="Username" htmlFor="username">
        <Input
          id="username"
          name="username"
          autoComplete="username"
          placeholder="hr.admin"
          required
        />
      </Field>

      <Field label="Password" htmlFor="password">
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </Field>

      {state.error ? <FormError>{state.error}</FormError> : null}

      {/* §8 Loading: a spinner inside the button that was pressed, disabled. */}
      <Button type="submit" variant="primary" size="lg" disabled={pending}>
        {pending ? <Loader2 className="animate-spin" /> : null}
        Sign in
      </Button>
    </form>
  );
}
