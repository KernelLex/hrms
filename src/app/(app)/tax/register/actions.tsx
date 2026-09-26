"use client";

import * as React from "react";
import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { buildRegister, saveChallan, type ActionState } from "@/app/actions/tax";
import { Button, Card, CardHeader } from "@/components/ui";
import { Dialog } from "@/components/dialog";
import { Field, Select, Input, DateInput, FormGrid, FormError } from "@/components/inputs";
import { useToast } from "@/components/toast";

export function BuildRegisterForm({
  years,
  selected,
}: {
  years: { value: string; label: string }[];
  selected: string;
}) {
  const toast = useToast();
  const router = useRouter();

  const [state, action, pending] = useActionState(
    async (prev: ActionState, form: FormData): Promise<ActionState> => {
      const result = await buildRegister(prev, form);
      if (result.ok) toast("Register built from payroll");
      return result;
    },
    {},
  );

  return (
    <Card>
      <CardHeader
        title="Build from payroll"
        description="Reads the tax actually deducted in each payroll run and totals it by quarter. Challan details already entered are kept."
      />
      <form action={action} className="px-6 pb-5">
        <FormGrid columns={3}>
          <Field label="Financial year" htmlFor="financialYear" required>
            <Select
              id="financialYear"
              name="financialYear"
              value={selected}
              onChange={(e) => router.push(`/tax/register?fy=${e.target.value}`)}
            >
              {years.map((y) => (
                <option key={y.value} value={y.value}>
                  {y.label}
                </option>
              ))}
            </Select>
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
            Build register
          </Button>
        </div>
      </form>
    </Card>
  );
}

export function ChallanButton({
  id,
  describe,
  challanBsr,
  depositDate,
  receipt24q,
}: {
  id: number;
  describe: string;
  challanBsr: string | null;
  depositDate: string | null;
  receipt24q: string | null;
}) {
  const toast = useToast();
  const [open, setOpen] = React.useState(false);

  const [state, action, pending] = useActionState(
    async (prev: ActionState, form: FormData): Promise<ActionState> => {
      const result = await saveChallan(prev, form);
      if (result.ok) {
        setOpen(false);
        toast("Challan recorded");
      }
      return result;
    },
    {},
  );

  return (
    <>
      <Button size="sm" variant={depositDate ? "ghost" : "secondary"} onClick={() => setOpen(true)}>
        {depositDate ? "Edit challan" : "Record challan"}
      </Button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Record challan"
        description={describe}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" form="challan-form" variant="primary" disabled={pending}>
              {pending ? <Loader2 className="animate-spin" /> : null}
              Save challan
            </Button>
          </>
        }
      >
        <form id="challan-form" action={action} className="flex flex-col gap-4 pb-1">
          <input type="hidden" name="id" value={id} />
          <Field
            label="Challan / BSR code"
            htmlFor="challanBsr"
            hint="From the bank receipt for the deposit."
          >
            <Input
              id="challanBsr"
              name="challanBsr"
              defaultValue={challanBsr ?? ""}
              placeholder="BSR0001234 / CIN123456"
            />
          </Field>
          <Field label="Deposit date" htmlFor="depositDate">
            <DateInput id="depositDate" name="depositDate" defaultValue={depositDate ?? ""} />
          </Field>
          <Field
            label="Form 24Q receipt"
            htmlFor="receipt24q"
            hint="The acknowledgement number from the quarterly return."
          >
            <Input
              id="receipt24q"
              name="receipt24q"
              defaultValue={receipt24q ?? ""}
              placeholder="QTRABCD1234"
            />
          </Field>
          {state.error ? <FormError>{state.error}</FormError> : null}
        </form>
      </Dialog>
    </>
  );
}
