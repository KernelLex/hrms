"use client";

import * as React from "react";
import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { massUpdate, type ActionState } from "@/app/actions/core-hr";
import { Button, Card, CardHeader, Table, Th, Tr, Td, TwoLine } from "@/components/ui";
import {
  Field,
  Select,
  Input,
  DateInput,
  FormGrid,
  FormError,
} from "@/components/inputs";
import { useToast } from "@/components/toast";

type Employee = {
  id: number;
  name: string;
  number: string;
  unit: string;
  payGroup: string;
  pay: string;
};

const FIELDS = [
  { value: "payScaleGroup", label: "Pay scale group" },
  { value: "amount", label: "Basic salary" },
  { value: "workScheduleCode", label: "Work schedule" },
];

export function MassUpdateForm({
  employees,
  schedules,
}: {
  employees: Employee[];
  schedules: { value: string; label: string }[];
}) {
  const toast = useToast();
  const [field, setField] = React.useState("payScaleGroup");
  const [selected, setSelected] = React.useState<Set<number>>(new Set());

  const [state, action, pending] = useActionState(
    async (prev: ActionState, form: FormData): Promise<ActionState> => {
      const result = await massUpdate(prev, form);
      if (result.ok) {
        toast(`Updated ${selected.size} employee${selected.size === 1 ? "" : "s"}`);
        setSelected(new Set());
      }
      return result;
    },
    {},
  );

  const toggle = (id: number) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const allSelected = employees.length > 0 && selected.size === employees.length;

  return (
    <form action={action} className="flex flex-col gap-6">
      <Card>
        <CardHeader
          title="What to change"
          description="The new value is written with the effective date below, ending whatever was valid before it."
        />
        <div className="px-6 pb-5">
          <FormGrid columns={3}>
            <Field label="Field" htmlFor="field" required>
              <Select
                id="field"
                name="field"
                value={field}
                onChange={(e) => setField(e.target.value)}
              >
                {FIELDS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </Select>
            </Field>

            <Field
              label="New value"
              htmlFor="newValue"
              required
              hint={field === "amount" ? "Per month, in rupees." : undefined}
            >
              {field === "workScheduleCode" ? (
                <Select id="newValue" name="newValue" defaultValue={schedules[0]?.value}>
                  {schedules.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </Select>
              ) : field === "payScaleGroup" ? (
                <Select id="newValue" name="newValue" defaultValue="L3">
                  {["L1", "L2", "L3", "M1", "M2"].map((g) => (
                    <option key={g}>{g}</option>
                  ))}
                </Select>
              ) : (
                <Input id="newValue" name="newValue" placeholder="75000" required />
              )}
            </Field>

            <Field label="Effective from" htmlFor="effectiveDate" required>
              <DateInput id="effectiveDate" name="effectiveDate" required />
            </Field>
          </FormGrid>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Who to change"
          description={`${selected.size} of ${employees.length} selected`}
          actions={
            <Button
              size="sm"
              variant="ghost"
              type="button"
              onClick={() =>
                setSelected(allSelected ? new Set() : new Set(employees.map((e) => e.id)))
              }
            >
              {allSelected ? "Clear all" : "Select all"}
            </Button>
          }
        />
        <Table>
          <thead>
            <tr>
              <Th>
                <span className="sr-only">Selected</span>
              </Th>
              <Th>Employee</Th>
              <Th>Department</Th>
              <Th>Pay group</Th>
              <Th numeric>Basic pay</Th>
            </tr>
          </thead>
          <tbody>
            {employees.map((e) => (
              <Tr key={e.id}>
                <Td>
                  <input
                    type="checkbox"
                    name="employeeIds"
                    value={e.id}
                    checked={selected.has(e.id)}
                    onChange={() => toggle(e.id)}
                    aria-label={`Select ${e.name}`}
                    className="size-4 rounded-[4px] border-control accent-ink"
                  />
                </Td>
                <Td>
                  <TwoLine value={e.name} sub={e.number} />
                </Td>
                <Td>
                  <span className="text-secondary">{e.unit}</span>
                </Td>
                <Td>{e.payGroup}</Td>
                <Td numeric>{e.pay}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Card>

      {state.error ? <FormError>{state.error}</FormError> : null}

      <div className="flex justify-end">
        <Button
          type="submit"
          variant="primary"
          size="lg"
          disabled={pending || selected.size === 0}
        >
          {pending ? <Loader2 className="animate-spin" /> : null}
          Apply to {selected.size} employee{selected.size === 1 ? "" : "s"}
        </Button>
      </div>
    </form>
  );
}
