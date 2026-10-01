"use client";

import { useActionState } from "react";
import { CircleCheck, CircleX } from "lucide-react";
import { respondToOffer, type OfferResponseState } from "@/app/actions/careers";
import { Button } from "@/components/ui";
import { FormError } from "@/components/inputs";

/** Accept or decline, through the link only the candidate has. */
export function RespondForm({ token, status }: { token: string; status: string }) {
  const [state, action, pending] = useActionState(respondToOffer, {} as OfferResponseState);

  if (status !== "Sent" && !state.ok) {
    return <p className="text-[14px] text-muted">{status === "Expired" ? "This offer has expired." : "This offer has already been responded to."}</p>;
  }

  if (state.ok) {
    return (
      <div className="flex flex-col items-start gap-2 py-2" role="status">
        {state.accepted ? <CircleCheck className="size-7 text-ink" /> : <CircleX className="size-7 text-muted" />}
        <h3 className="text-[16px] font-semibold text-ink">{state.accepted ? "Welcome aboard" : "Thank you for letting us know"}</h3>
        <p className="text-[13px] text-muted">
          {state.accepted ? "Your acceptance is recorded, and recruitment has been told." : "Your decision is recorded. We wish you the best."}
        </p>
      </div>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="token" value={token} />
      {state.error ? <FormError>{state.error}</FormError> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" name="decision" value="accept" variant="primary" disabled={pending}>
          Accept the offer
        </Button>
        <Button type="submit" name="decision" value="decline" variant="secondary" disabled={pending}>
          Decline
        </Button>
      </div>
    </form>
  );
}
