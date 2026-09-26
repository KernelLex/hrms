"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { saveNotificationPrefs, type ActionState } from "@/app/actions/notifications";
import { Button } from "@/components/ui";
import { FormError } from "@/components/inputs";
import { TableScroll } from "@/components/table-scroll";
import { useToast } from "@/components/toast";

type Pref = { kind: string; label: string; description: string; inApp: boolean; email: boolean };

export function PreferencesForm({ prefs, hasEmail }: { prefs: Pref[]; hasEmail: boolean }) {
  const toast = useToast();
  const [state, action, pending] = useActionState(
    async (prev: ActionState, form: FormData): Promise<ActionState> => {
      const result = await saveNotificationPrefs(prev, form);
      if (result.ok) toast("Preferences saved");
      return result;
    },
    {},
  );

  return (
    <form action={action}>
      <TableScroll>
        <table className="w-full border-collapse text-left">
          <thead>
            <tr>
              <th scope="col" className="border-b border-line px-3 py-3 pl-6 text-[13px] font-normal text-muted">
                Notification
              </th>
              <th scope="col" className="w-24 border-b border-line px-3 py-3 text-center text-[13px] font-normal text-muted">
                Inbox
              </th>
              <th scope="col" className="w-24 border-b border-line px-3 py-3 pr-6 text-center text-[13px] font-normal text-muted">
                Email
              </th>
            </tr>
          </thead>
          <tbody>
            {prefs.map((p) => (
              <tr key={p.kind} className="border-b border-soft last:border-0">
                <td className="px-3 py-3.5 pl-6">
                  <div className="text-sm font-medium text-ink">{p.label}</div>
                  <div className="mt-0.5 text-[13px] text-muted">{p.description}</div>
                </td>
                <td className="px-3 py-3.5 text-center">
                  <input
                    type="checkbox"
                    name={`${p.kind}:inApp`}
                    defaultChecked={p.inApp}
                    aria-label={`${p.label} in the inbox`}
                    className="size-4 rounded-[4px] accent-ink"
                  />
                </td>
                <td className="px-3 py-3.5 pr-6 text-center">
                  <input
                    type="checkbox"
                    name={`${p.kind}:email`}
                    defaultChecked={p.email}
                    disabled={!hasEmail}
                    aria-label={`${p.label} by email`}
                    className="size-4 rounded-[4px] accent-ink disabled:opacity-40"
                  />
                  {/* A disabled box sends nothing; keep the choice for when an email is added. */}
                  {!hasEmail && p.email ? <input type="hidden" name={`${p.kind}:email`} value="on" /> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroll>
      {state.error ? (
        <div className="px-6 pt-4">
          <FormError>{state.error}</FormError>
        </div>
      ) : null}
      <div className="flex justify-end border-t border-soft px-6 py-4">
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : null}
          Save preferences
        </Button>
      </div>
    </form>
  );
}
