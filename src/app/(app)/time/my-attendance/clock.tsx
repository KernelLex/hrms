"use client";

import { useActionState } from "react";
import { Loader2, LogIn, LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { punchNow, type ActionState } from "@/app/actions/attendance";
import { Button, Card, CardHeader } from "@/components/ui";
import { FormError } from "@/components/inputs";
import { useToast } from "@/components/toast";

/**
 * Clocking in and out from the app, for anyone not covered by a punch clock.
 * The time is always the moment the button is pressed; a time that needs
 * choosing is a correction, which goes to a manager instead.
 */
export function ClockCard({ lastIn, lastOut }: { lastIn: string | null; lastOut: string | null }) {
  const toast = useToast();
  const router = useRouter();
  const [state, action, pending] = useActionState(async (prev: ActionState, form: FormData): Promise<ActionState> => {
    const r = await punchNow(prev, form);
    if (r.ok) {
      toast(form.get("direction") === "In" ? "Clocked in" : "Clocked out");
      router.refresh();
    }
    return r;
  }, {});

  return (
    <Card>
      <CardHeader
        title="Clock in and out"
        description="Recorded at the moment you press it, the same as a punch from a clock. Today's hours are worked out from your punches overnight."
      />
      <div className="px-6 pb-5">
        <div className="flex flex-wrap items-center gap-2">
          <form action={action}>
            <input type="hidden" name="direction" value="In" />
            <Button type="submit" variant="primary" disabled={pending}>
              {pending ? <Loader2 className="animate-spin" /> : <LogIn className="size-4" />}
              Clock in
            </Button>
          </form>
          <form action={action}>
            <input type="hidden" name="direction" value="Out" />
            <Button type="submit" variant="secondary" disabled={pending}>
              {pending ? <Loader2 className="animate-spin" /> : <LogOut className="size-4" />}
              Clock out
            </Button>
          </form>
          <p className="text-[13px] text-muted">
            {lastIn || lastOut
              ? `Today: ${lastIn ? `in at ${lastIn}` : "no clock-in yet"}${lastOut ? `, out at ${lastOut}` : ""}.`
              : "Nothing recorded today yet."}
          </p>
        </div>
        {state.error ? (
          <div className="mt-3">
            <FormError>{state.error}</FormError>
          </div>
        ) : null}
      </div>
    </Card>
  );
}
