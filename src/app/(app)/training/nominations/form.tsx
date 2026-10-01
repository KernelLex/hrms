"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { decideNomination, recordAttendance, type ActionState } from "@/app/actions/training";
import { Button } from "@/components/ui";
import { FormError } from "@/components/inputs";
import { useToast } from "@/components/toast";

export function DecideNominationForm({ id }: { id: number }) {
  const toast = useToast();
  const [state, action, pending] = useActionState(
    async (prev: ActionState, form: FormData): Promise<ActionState> => {
      const result = await decideNomination(prev, form);
      if (result.ok) toast("Decided");
      return result;
    },
    {},
  );

  return (
    <form action={action} className="flex flex-col gap-1">
      <input type="hidden" name="id" value={id} />
      <div className="flex gap-1.5">
        <Button type="submit" name="decision" value="Approved" size="sm" variant="secondary" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : null}
          Approve
        </Button>
        <Button type="submit" name="decision" value="Rejected" size="sm" variant="ghost" disabled={pending}>
          Reject
        </Button>
      </div>
      {state.error ? <FormError>{state.error}</FormError> : null}
    </form>
  );
}

export function AttendanceForm({ id, attended }: { id: number; attended: boolean | null }) {
  const toast = useToast();
  const [, action, pending] = useActionState(
    async (prev: ActionState, form: FormData): Promise<ActionState> => {
      const result = await recordAttendance(prev, form);
      if (result.ok) toast("Attendance recorded");
      return result;
    },
    {},
  );

  return (
    <form action={action} className="flex gap-1.5">
      <input type="hidden" name="id" value={id} />
      <Button type="submit" name="attended" value="1" size="sm" variant={attended === true ? "primary" : "ghost"} disabled={pending}>
        Attended
      </Button>
      <Button type="submit" name="attended" value="0" size="sm" variant={attended === false ? "primary" : "ghost"} disabled={pending}>
        No-show
      </Button>
    </form>
  );
}
