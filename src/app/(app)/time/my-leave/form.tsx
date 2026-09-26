"use client";

import * as React from "react";
import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { submitLeaveRequest, type ActionState } from "@/app/actions/time";
import { Button, Card, CardHeader } from "@/components/ui";
import {
  Field,
  Select,
  DateInput,
  Input,
  Checkbox,
  FormGrid,
  FormError,
} from "@/components/inputs";
import { useToast } from "@/components/toast";

export function RequestLeaveForm({ types }: { types: { value: string; label: string }[] }) {
  const toast = useToast();
  const [halfDay, setHalfDay] = React.useState(false);
  const [from, setFrom] = React.useState("");

  const [state, action, pending] = useActionState(
    async (prev: ActionState, form: FormData): Promise<ActionState> => {
      const result = await submitLeaveRequest(prev, form);
      if (result.ok) {
        toast("Leave request submitted");
        setFrom("");
        setHalfDay(false);
      }
      return result;
    },
    {},
  );

  return (
    <Card>
      <CardHeader
        title="Apply for leave"
        description="Weekends and public holidays are not counted, so a Friday to Monday absence costs two days, not four."
      />
      <form action={action} className="px-6 pb-5">
        <FormGrid columns={3}>
          <Field label="Leave type" htmlFor="absenceTypeCode" required>
            <Select id="absenceTypeCode" name="absenceTypeCode" required>
              {types.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="From" htmlFor="fromDate" required>
            <DateInput
              id="fromDate"
              name="fromDate"
              required
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </Field>
          <Field
            label="To"
            htmlFor="toDate"
            required
            hint={halfDay ? "A half day covers one date." : undefined}
          >
            <DateInput
              id="toDate"
              name="toDate"
              required
              value={halfDay ? from : undefined}
              defaultValue={halfDay ? undefined : ""}
              readOnly={halfDay}
            />
          </Field>
          <div className="flex items-end pb-2">
            <Checkbox
              id="isHalfDay"
              name="isHalfDay"
              label="Half day"
              checked={halfDay}
              onChange={(e) => setHalfDay(e.target.checked)}
            />
          </div>
          <Field label="Reason" htmlFor="reason" className="sm:col-span-2">
            <Input id="reason" name="reason" placeholder="Family trip" />
          </Field>
        </FormGrid>

        {state.error ? (
          <div className="mt-4">
            <FormError>{state.error}</FormError>
          </div>
        ) : null}

        <div className="mt-4">
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? <Loader2 className="animate-spin" /> : null}
            Submit request
          </Button>
        </div>
      </form>
    </Card>
  );
}
