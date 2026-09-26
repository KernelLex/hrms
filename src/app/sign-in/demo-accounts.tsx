"use client";

import * as React from "react";
import { useActionState } from "react";
import { ChevronRight, Loader2 } from "lucide-react";
import { demoSignInAction, type SignInState } from "@/app/actions/auth";
import { Avatar, Card } from "@/components/ui";
import { FormError } from "@/components/inputs";

type Account = { username: string; name: string; role: string; sees: string };

const INITIAL: SignInState = {};

/**
 * §11 Sign-in: "a card listing accounts as rows". Each row is a submit button
 * carrying its own username, so one click signs in as that person.
 */
export function DemoAccounts({ accounts }: { accounts: readonly Account[] }) {
  const [state, action, pending] = useActionState(demoSignInAction, INITIAL);
  const [chosen, setChosen] = React.useState<string | null>(null);

  return (
    <form action={action}>
      <Card className="py-2">
        <ul>
          {accounts.map((a) => {
            const busy = pending && chosen === a.username;
            return (
              <li key={a.username}>
                <button
                  type="submit"
                  name="username"
                  value={a.username}
                  disabled={pending}
                  onClick={() => setChosen(a.username)}
                  aria-label={`Sign in as ${a.name}, ${a.role}`}
                  className="mx-2 flex w-[calc(100%-16px)] items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors duration-150 hover:bg-canvas disabled:opacity-60"
                >
                  <Avatar name={a.name} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-ink">
                      {a.name}
                      <span className="font-normal text-muted">, {a.role}</span>
                    </span>
                    <span className="block text-[13px] text-muted">{a.sees}</span>
                  </span>
                  {busy ? (
                    <Loader2 className="size-4 shrink-0 animate-spin text-ink" aria-hidden />
                  ) : (
                    <ChevronRight className="size-4 shrink-0 text-decor" aria-hidden />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </Card>
      {state.error ? (
        <div className="mt-4">
          <FormError>{state.error}</FormError>
        </div>
      ) : null}
    </form>
  );
}
