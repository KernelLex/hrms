"use client";

import { useActionState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { saveReportSchedule, deleteReportSchedule, type ActionState } from "@/app/actions/reports";
import { REPORT_LABEL } from "@/lib/reports-values";
import { Button } from "@/components/ui";
import { Field, Select, Input, FormError, FormGrid } from "@/components/inputs";
import { useToast } from "@/components/toast";

export function ScheduleReportForm({ reportNames }: { reportNames: string[] }) {
  const toast = useToast();
  const [state, action, pending] = useActionState(
    async (prev: ActionState, form: FormData): Promise<ActionState> => {
      const result = await saveReportSchedule(prev, form);
      if (result.ok) toast("Report scheduled");
      return result;
    },
    {},
  );

  return (
    <form action={action} className="flex flex-col gap-4">
      <FormGrid>
        <Field label="Report" htmlFor="reportName" required>
          <Select id="reportName" name="reportName" required defaultValue="">
            <option value="">Choose a report</option>
            {reportNames.map((n) => (
              <option key={n} value={n}>
                {REPORT_LABEL[n] ?? n}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Recipients" htmlFor="recipients" required hint="Comma-separated email addresses.">
          <Input id="recipients" name="recipients" required placeholder="hr@example.com, finance@example.com" />
        </Field>
      </FormGrid>
      {state.error ? <FormError>{state.error}</FormError> : null}
      <div>
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : null}
          Schedule this report
        </Button>
      </div>
    </form>
  );
}

export function DeleteScheduleButton({ id }: { id: number }) {
  const toast = useToast();
  const [, action, pending] = useActionState(
    async (prev: ActionState, form: FormData): Promise<ActionState> => {
      const result = await deleteReportSchedule(prev, form);
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
