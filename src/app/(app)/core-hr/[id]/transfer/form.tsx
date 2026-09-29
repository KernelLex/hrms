"use client";

import * as React from "react";
import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { transferEmployeeAction, type ActionState } from "@/app/actions/lifecycle";
import { Button, Card, CardHeader, CardBody } from "@/components/ui";
import { Field, Input, Select, DateInput, FormGrid, FormError, Textarea } from "@/components/inputs";
import { useToast } from "@/components/toast";

type Option = { value: string; label: string };
type PositionOption = Option & { orgUnitCode: string };

const INITIAL: ActionState = {};

export function TransferForm({
  employeeId,
  companies,
  areas,
  units,
  positions,
}: {
  employeeId: number;
  companies: Option[];
  areas: Option[];
  units: Option[];
  positions: PositionOption[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [positionCode, setPositionCode] = React.useState(positions[0]?.value ?? "");
  const impliedUnit = positions.find((p) => p.value === positionCode)?.orgUnitCode ?? units[0]?.value ?? "";

  const [state, formAction, pending] = useActionState(async (prev: ActionState, form: FormData): Promise<ActionState> => {
    const result = await transferEmployeeAction(prev, form);
    if (result.ok) {
      toast("Employee transferred");
      router.push(`/core-hr/${employeeId}/career`);
    }
    return result;
  }, INITIAL);

  return (
    <form action={formAction}>
      <input type="hidden" name="employeeId" value={employeeId} />
      <Card>
        <CardHeader title="New assignment" description="Only vacant positions are listed. Choosing one sets the department." />
        <CardBody>
          <FormGrid columns={2}>
            <Field label="Effective date" htmlFor="effectiveDate" required>
              <DateInput id="effectiveDate" name="effectiveDate" required />
            </Field>
            <Field label="Position" htmlFor="positionCode" required>
              <Select id="positionCode" name="positionCode" required value={positionCode} onChange={(e) => setPositionCode(e.target.value)}>
                {positions.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Department" htmlFor="orgUnitDisplay" hint="Set by the position.">
              <Input id="orgUnitDisplay" value={units.find((u) => u.value === impliedUnit)?.label ?? ""} disabled readOnly />
            </Field>
            <input type="hidden" name="orgUnitCode" value={impliedUnit} />
            <Field label="Company" htmlFor="companyCode" required>
              <Select id="companyCode" name="companyCode" required defaultValue={companies[0]?.value}>
                {companies.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Personnel area" htmlFor="areaCode">
              <Select id="areaCode" name="areaCode" defaultValue="">
                <option value="">None</option>
                {areas.map((a) => (
                  <option key={a.value} value={a.value}>
                    {a.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Cost centre" htmlFor="costCenter">
              <Input id="costCenter" name="costCenter" placeholder="CC-IT-01" />
            </Field>
            <Field label="Reason" htmlFor="reason" hint="Optional.">
              <Textarea id="reason" name="reason" rows={2} />
            </Field>
          </FormGrid>
          {state.error ? <FormError>{state.error}</FormError> : null}
          <div className="mt-5 flex justify-end">
            <Button type="submit" variant="primary" disabled={pending}>
              {pending ? <Loader2 className="animate-spin" /> : null}
              Transfer
            </Button>
          </div>
        </CardBody>
      </Card>
    </form>
  );
}
