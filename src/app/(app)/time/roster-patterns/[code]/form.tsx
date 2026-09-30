"use client";

import * as React from "react";
import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { savePatternDays, type ActionState } from "@/app/actions/attendance";
import { Button, Card, CardHeader } from "@/components/ui";
import { Select, FormError } from "@/components/inputs";
import { useToast } from "@/components/toast";

type Shift = { value: string; label: string };

const DAY_NAMES = ["1st", "2nd", "3rd", "4th", "5th", "6th", "7th"];

export function PatternDaysForm({
  patternCode,
  cycleLengthDays,
  shifts,
  initial,
}: {
  patternCode: string;
  cycleLengthDays: number;
  shifts: Shift[];
  initial: (string | null)[];
}) {
  const toast = useToast();
  const [state, action, pending] = useActionState(
    async (prev: ActionState, form: FormData): Promise<ActionState> => {
      const result = await savePatternDays(prev, form);
      if (result.ok) toast("Pattern days saved");
      return result;
    },
    {},
  );

  return (
    <Card>
      <CardHeader
        title="This pattern's days"
        description="Which shift each day of the cycle is. Leave a day blank for a day off. Day 1 is whatever date the roster is generated from."
      />
      <form action={action} className="px-6 pb-5">
        <input type="hidden" name="patternCode" value={patternCode} />
        <input type="hidden" name="cycleLengthDays" value={cycleLengthDays} />
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: cycleLengthDays }).map((_, i) => (
            <div key={i}>
              <label className="mb-1 block text-[13px] font-medium text-secondary" htmlFor={`day_${i}`}>
                Day {i + 1}
                {i < 7 ? <span className="text-muted"> ({DAY_NAMES[i]})</span> : null}
              </label>
              <Select id={`day_${i}`} name={`day_${i}`} defaultValue={initial[i] ?? ""}>
                <option value="">Off</option>
                {shifts.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </Select>
            </div>
          ))}
        </div>

        {state.error ? (
          <div className="mt-4">
            <FormError>{state.error}</FormError>
          </div>
        ) : null}

        <div className="mt-5">
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? <Loader2 className="animate-spin" /> : null}
            Save days
          </Button>
        </div>
      </form>
    </Card>
  );
}
