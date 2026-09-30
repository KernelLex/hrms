"use client";

import * as React from "react";
import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { assignRosterAction, type ActionState } from "@/app/actions/attendance";
import { Button, Card, CardHeader } from "@/components/ui";
import { Field, Select, Input, FormGrid, FormError } from "@/components/inputs";
import { useToast } from "@/components/toast";

type Option = { value: string; label: string };

export function AssignRosterForm({ patterns, employees }: { patterns: Option[]; employees: Option[] }) {
  const toast = useToast();
  const [checked, setChecked] = React.useState<Set<string>>(new Set());
  const [state, action, pending] = useActionState(
    async (prev: ActionState, form: FormData): Promise<ActionState> => {
      const result = await assignRosterAction(prev, form);
      if (result.ok) toast("Roster generated");
      return result;
    },
    {},
  );

  const allChecked = checked.size === employees.length && employees.length > 0;
  const toggleAll = () => setChecked(allChecked ? new Set() : new Set(employees.map((e) => e.value)));
  const toggleOne = (id: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <Card>
      <CardHeader title="Assign a pattern to a team" description="Generates the roster from the date chosen — day 1 of the pattern's cycle — through the end date. Re-assigning the same team, pattern and start date writes the same roster again." />
      <form action={action} className="px-6 pb-5">
        <FormGrid columns={3}>
          <Field label="Pattern" htmlFor="patternCode" required>
            <Select id="patternCode" name="patternCode" defaultValue={patterns[0]?.value}>
              {patterns.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="From (day 1 of the cycle)" htmlFor="fromDate" required>
            <Input id="fromDate" name="fromDate" type="date" className="tabular" />
          </Field>
          <Field label="Through" htmlFor="toDate" required>
            <Input id="toDate" name="toDate" type="date" className="tabular" />
          </Field>
        </FormGrid>

        <div className="mt-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[13px] font-medium text-secondary">Team</span>
            <button type="button" onClick={toggleAll} className="text-[13px] font-medium text-ink hover:underline">
              {allChecked ? "Clear all" : "Select all"}
            </button>
          </div>
          <div className="max-h-64 overflow-y-auto rounded-md border border-line p-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {employees.map((e) => (
                <label key={e.value} className="flex items-center gap-2 text-[13px] text-ink">
                  <input
                    type="checkbox"
                    name="employeeIds"
                    value={e.value}
                    checked={checked.has(e.value)}
                    onChange={() => toggleOne(e.value)}
                    className="size-4 shrink-0 rounded-[4px] border-control text-ink accent-ink"
                  />
                  {e.label}
                </label>
              ))}
            </div>
          </div>
        </div>

        {state.error ? (
          <div className="mt-4">
            <FormError>{state.error}</FormError>
          </div>
        ) : null}

        <div className="mt-4">
          <Button type="submit" variant="primary" disabled={pending || checked.size === 0}>
            {pending ? <Loader2 className="animate-spin" /> : null}
            Generate roster
          </Button>
        </div>
      </form>
    </Card>
  );
}
