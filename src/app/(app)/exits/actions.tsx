"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { revokeExit, settleExitAction, waiveNoticeAction, type ActionState } from "@/app/actions/exits";
import { Button } from "@/components/ui";
import { useToast } from "@/components/toast";

export function ExitAdminActions({ id, name, status, noticeWaived }: { id: number; name: string; status: string; noticeWaived: boolean }) {
  const toast = useToast();
  const [revokeState, revokeAction, revokePending] = useActionState(
    async (prev: ActionState, form: FormData): Promise<ActionState> => {
      const result = await revokeExit(prev, form);
      if (result.ok) toast(`${name} is staying — the exit is cancelled`);
      return result;
    },
    {},
  );
  const [settleState, settleAction, settlePending] = useActionState(
    async (prev: ActionState, form: FormData): Promise<ActionState> => {
      const result = await settleExitAction(prev, form);
      if (result.ok) toast(`${name}'s settlement is paid`);
      return result;
    },
    {},
  );
  const [waiveState, waiveAction, waivePending] = useActionState(
    async (prev: ActionState, form: FormData): Promise<ActionState> => {
      const result = await waiveNoticeAction(prev, form);
      if (result.ok) toast(noticeWaived ? "Notice shortfall will be recovered" : "Notice shortfall waived");
      return result;
    },
    {},
  );

  if (status !== "Approved") return null;

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex justify-end gap-1">
        <form action={waiveAction} className="inline">
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="waived" value={noticeWaived ? "false" : "true"} />
          <Button type="submit" size="sm" variant="ghost" disabled={waivePending}>
            {waivePending ? <Loader2 className="animate-spin" /> : null}
            {noticeWaived ? "Recover notice" : "Waive notice"}
          </Button>
        </form>
        {/* Before the last day, an exit can still be taken back: nothing has
            been written to the record or paid yet. */}
        <form action={revokeAction} className="inline">
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="reason" value="Cancelled before the last day; the employee is staying." />
          <Button type="submit" size="sm" variant="ghost" disabled={revokePending}>
            {revokePending ? <Loader2 className="animate-spin" /> : null}
            Cancel exit
          </Button>
        </form>
        <form action={settleAction} className="inline">
          <input type="hidden" name="id" value={id} />
          <Button type="submit" size="sm" variant="primary" disabled={settlePending}>
            {settlePending ? <Loader2 className="animate-spin" /> : null}
            Settle now
          </Button>
        </form>
      </div>
      {settleState.error ? <div className="text-[13px] text-danger">{settleState.error}</div> : null}
      {waiveState.error ? <div className="text-[13px] text-danger">{waiveState.error}</div> : null}
      {revokeState.error ? <div className="text-[13px] text-danger">{revokeState.error}</div> : null}
    </div>
  );
}
