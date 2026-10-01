"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { saveRent, submitProof, type ActionState } from "@/app/actions/tax";
import { Button, Card, CardHeader } from "@/components/ui";
import { Field, Input, Select, Checkbox, FormGrid, FormError } from "@/components/inputs";
import { useToast } from "@/components/toast";

export function RentForm({ financialYear, rent }: { financialYear: string; rent?: { monthlyRent: string; landlordName: string; landlordPan: string; isMetro: boolean } }) {
  const toast = useToast();
  const [state, action, pending] = useActionState(
    async (prev: ActionState, form: FormData): Promise<ActionState> => {
      const result = await saveRent(prev, form);
      if (result.ok) toast("Rent details saved");
      return result;
    },
    {},
  );

  return (
    <Card>
      <CardHeader title="Rent, for the HRA exemption" description="The exemption is worked out as the least of three: actual HRA, rent less 10% of basic, and 50% or 40% of basic." />
      <form action={action} className="px-6 pb-5">
        <input type="hidden" name="financialYear" value={financialYear} />
        <FormGrid columns={3}>
          <Field label="Monthly rent" htmlFor="monthlyRent" required>
            <Input id="monthlyRent" name="monthlyRent" type="number" min="0" step="1" defaultValue={rent?.monthlyRent} required />
          </Field>
          <Field label="Landlord's name" htmlFor="landlordName" required>
            <Input id="landlordName" name="landlordName" defaultValue={rent?.landlordName} required />
          </Field>
          <Field label="Landlord's PAN" htmlFor="landlordPan" hint="Required once annual rent is over ₹1,00,000.">
            <Input id="landlordPan" name="landlordPan" defaultValue={rent?.landlordPan} />
          </Field>
          <Field label="City" htmlFor="isMetro">
            <Checkbox id="isMetro" name="isMetro" defaultChecked={rent?.isMetro} label="A metro city (Delhi, Mumbai, Kolkata or Chennai)" />
          </Field>
        </FormGrid>
        {state.error ? (
          <div className="mt-3">
            <FormError>{state.error}</FormError>
          </div>
        ) : null}
        <div className="mt-3">
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? <Loader2 className="animate-spin" /> : null}
            Save
          </Button>
        </div>
      </form>
    </Card>
  );
}

const SECTIONS = [
  { value: "80C", label: "Section 80C" },
  { value: "80D", label: "Section 80D" },
  { value: "HRA", label: "HRA" },
];

export function ProofForm({ financialYear }: { financialYear: string }) {
  const toast = useToast();
  const [state, action, pending] = useActionState(
    async (prev: ActionState, form: FormData): Promise<ActionState> => {
      const result = await submitProof(prev, form);
      if (result.ok) toast("Proof filed for verification");
      return result;
    },
    {},
  );

  return (
    <Card>
      <CardHeader title="File proof" description="Against what you declared — a receipt or statement HR can check." />
      <form action={action} className="px-6 pb-5">
        <input type="hidden" name="financialYear" value={financialYear} />
        <FormGrid columns={3}>
          <Field label="Section" htmlFor="section" required>
            <Select id="section" name="section" required defaultValue="">
              <option value="" disabled>
                Choose one
              </option>
              {SECTIONS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Amount this proves" htmlFor="amount" required>
            <Input id="amount" name="amount" type="number" min="1" step="1" required />
          </Field>
          <Field label="Document" htmlFor="document">
            <input id="document" name="document" type="file" className="text-[13px]" />
          </Field>
        </FormGrid>
        {state.error ? (
          <div className="mt-3">
            <FormError>{state.error}</FormError>
          </div>
        ) : null}
        <div className="mt-3">
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? <Loader2 className="animate-spin" /> : null}
            File it
          </Button>
        </div>
      </form>
    </Card>
  );
}
