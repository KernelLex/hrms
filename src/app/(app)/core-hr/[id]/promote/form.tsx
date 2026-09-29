"use client";

import * as React from "react";
import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { promoteEmployeeAction, type ActionState } from "@/app/actions/lifecycle";
import { Button, Card, CardHeader, CardBody } from "@/components/ui";
import { Field, Select, DateInput, NumberInput, FormGrid, FormError, Textarea } from "@/components/inputs";
import { useToast } from "@/components/toast";
import { formatINR } from "@/lib/money";

type Option = { value: string; label: string };

const INITIAL: ActionState = {};

export function PromoteForm({ employeeId, positions }: { employeeId: number; positions: Option[] }) {
  const router = useRouter();
  const toast = useToast();
  const [amount, setAmount] = React.useState("");
  const amountPaise = Math.round((Number(amount) || 0) * 100);

  const [state, formAction, pending] = useActionState(async (prev: ActionState, form: FormData): Promise<ActionState> => {
    const result = await promoteEmployeeAction(prev, form);
    if (result.ok) {
      toast("Employee promoted");
      router.push(`/core-hr/${employeeId}/career`);
    }
    return result;
  }, INITIAL);

  return (
    <form action={formAction}>
      <input type="hidden" name="employeeId" value={employeeId} />
      <Card>
        <CardHeader title="New position and pay" description="The new basic salary must be above their current one." />
        <CardBody>
          <FormGrid columns={2}>
            <Field label="Effective date" htmlFor="effectiveDate" required>
              <DateInput id="effectiveDate" name="effectiveDate" required />
            </Field>
            <Field label="Position" htmlFor="positionCode" required>
              <Select id="positionCode" name="positionCode" required defaultValue={positions[0]?.value}>
                {positions.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Pay scale group" htmlFor="payScaleGroup">
              <Select id="payScaleGroup" name="payScaleGroup" defaultValue="L2">
                {["L1", "L2", "L3", "M1", "M2"].map((g) => (
                  <option key={g}>{g}</option>
                ))}
              </Select>
            </Field>
            <Field label="New basic salary" htmlFor="amount" required hint={amountPaise > 0 ? formatINR(amountPaise) : "Per month."}>
              <NumberInput id="amount" name="amount" required min="1" step="1" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </Field>
            <input type="hidden" name="currency" value="INR" />
            <Field label="Reason" htmlFor="reason" hint="Optional.">
              <Textarea id="reason" name="reason" rows={2} />
            </Field>
          </FormGrid>
          {state.error ? <FormError>{state.error}</FormError> : null}
          <div className="mt-5 flex justify-end">
            <Button type="submit" variant="primary" disabled={pending}>
              {pending ? <Loader2 className="animate-spin" /> : null}
              Promote
            </Button>
          </div>
        </CardBody>
      </Card>
    </form>
  );
}
