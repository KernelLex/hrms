"use client";

import * as React from "react";
import { useActionState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { saveStructureComponents, type ActionState } from "@/app/actions/statutory";
import { Button, Card, CardHeader } from "@/components/ui";
import { Field, Input, Select, FormGrid, FormError } from "@/components/inputs";
import { useToast } from "@/components/toast";

type WageType = { value: string; label: string };

type Row = {
  key: number;
  wageTypeCode: string;
  componentType: "PercentOfCTC" | "PercentOfBasic" | "Fixed" | "Balancing";
  percent: string;
  fixedAmount: string;
};

const COMPONENT_TYPES: { value: Row["componentType"]; label: string }[] = [
  { value: "PercentOfCTC", label: "Percent of CTC" },
  { value: "PercentOfBasic", label: "Percent of basic" },
  { value: "Fixed", label: "Fixed amount" },
  { value: "Balancing", label: "Balancing (whatever is left)" },
];

let nextKey = 0;

export function StructureComponentsForm({
  structureCode,
  wageTypes,
  initial,
}: {
  structureCode: string;
  wageTypes: WageType[];
  initial: Row[];
}) {
  const toast = useToast();
  const [rows, setRows] = React.useState<Row[]>(initial.length > 0 ? initial : [{ key: nextKey++, wageTypeCode: "BASIC", componentType: "PercentOfCTC", percent: "", fixedAmount: "" }]);

  const [state, action, pending] = useActionState(
    async (prev: ActionState, form: FormData): Promise<ActionState> => {
      const result = await saveStructureComponents(prev, form);
      if (result.ok) toast("Components saved");
      return result;
    },
    {},
  );

  const update = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const remove = (key: number) => setRows((rs) => rs.filter((r) => r.key !== key));
  const add = () => setRows((rs) => [...rs, { key: nextKey++, wageTypeCode: wageTypes[0]?.value ?? "", componentType: "Fixed", percent: "", fixedAmount: "" }]);

  const payload = JSON.stringify(
    rows.map((r, i) => ({
      wageTypeCode: r.wageTypeCode,
      componentType: r.componentType,
      percent: r.percent || undefined,
      fixedAmount: r.fixedAmount || undefined,
      sortOrder: (i + 1) * 10,
    })),
  );

  return (
    <Card>
      <CardHeader title="Components" description="What the CTC becomes each month. Exactly one component should be Balancing — the amount left once the others are worked out." />
      <form action={action} className="px-6 pb-5">
        <input type="hidden" name="structureCode" value={structureCode} />
        <input type="hidden" name="components" value={payload} />

        <div className="flex flex-col gap-4">
          {rows.map((r) => (
            <div key={r.key} className="rounded-2xl border border-line p-4">
              <FormGrid columns={3}>
                <Field label="Wage type" htmlFor={`wt-${r.key}`} required>
                  <Select id={`wt-${r.key}`} value={r.wageTypeCode} onChange={(e) => update(r.key, { wageTypeCode: e.target.value })}>
                    {wageTypes.map((w) => (
                      <option key={w.value} value={w.value}>
                        {w.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Works out as" htmlFor={`ct-${r.key}`} required>
                  <Select id={`ct-${r.key}`} value={r.componentType} onChange={(e) => update(r.key, { componentType: e.target.value as Row["componentType"] })}>
                    {COMPONENT_TYPES.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                {r.componentType === "PercentOfCTC" || r.componentType === "PercentOfBasic" ? (
                  <Field label="Percent" htmlFor={`pct-${r.key}`} required>
                    <Input id={`pct-${r.key}`} value={r.percent} onChange={(e) => update(r.key, { percent: e.target.value })} placeholder="40" />
                  </Field>
                ) : r.componentType === "Fixed" ? (
                  <Field label="Amount, per month" htmlFor={`amt-${r.key}`} required>
                    <Input id={`amt-${r.key}`} value={r.fixedAmount} onChange={(e) => update(r.key, { fixedAmount: e.target.value })} placeholder="5000" />
                  </Field>
                ) : (
                  <div />
                )}
                <div className="flex items-end justify-end pb-0.5">
                  <Button type="button" variant="ghost" size="sm" onClick={() => remove(r.key)}>
                    <Trash2 />
                    Remove
                  </Button>
                </div>
              </FormGrid>
            </div>
          ))}
        </div>

        <div className="mt-4">
          <Button type="button" variant="secondary" size="sm" onClick={add}>
            <Plus />
            Add component
          </Button>
        </div>

        {state.error ? (
          <div className="mt-4">
            <FormError>{state.error}</FormError>
          </div>
        ) : null}

        <div className="mt-5">
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? <Loader2 className="animate-spin" /> : null}
            Save components
          </Button>
        </div>
      </form>
    </Card>
  );
}
