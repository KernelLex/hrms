"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { saveRent, submitProof, type ActionState } from "@/app/actions/tax";
import { Button, Card, CardHeader } from "@/components/ui";
import { Field, Input, Select, Checkbox, FormGrid, FormError } from "@/components/inputs";
import { useToast } from "@/components/toast";

export function RentForm({
  financialYear,
  rent,
  exemption,
}: {
  financialYear: string;
  rent?: { monthlyRent: string; landlordName: string; landlordPan: string; isMetro: boolean; accommodationType: string };
  /** What the three-way minimum makes of it, in rupees, or null with no rent on record. */
  exemption?: string | null;
}) {
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
      <CardHeader
        title="Rent, for the HRA exemption"
        description="The exemption is worked out as the least of three: the HRA you actually receive, your rent over 10% of basic, and half of basic in a metro or two fifths elsewhere. You do not type the figure — this is where it comes from."
      />
      {exemption ? (
        <div className="mx-6 mb-4 rounded-xl bg-canvas px-4 py-3">
          <div className="text-[13px] text-muted">Your HRA exemption for {financialYear}</div>
          <div className="tabular mt-0.5 text-[22px] leading-tight font-semibold tracking-[-0.02em] text-ink">{exemption}</div>
        </div>
      ) : null}
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
          <Field label="Accommodation" htmlFor="accommodationType">
            <Select id="accommodationType" name="accommodationType" defaultValue={rent?.accommodationType ?? "Rented"}>
              <option>Rented</option>
              <option>Own house</option>
              <option>Company leased</option>
            </Select>
          </Field>
          <Field label="City" htmlFor="isMetro" hint="Set from your address; correct it if it is wrong.">
            <Checkbox id="isMetro" name="isMetro" defaultChecked={rent?.isMetro} label="A metro city — half of basic rather than two fifths" />
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

export function ProofForm({ financialYear, sections }: { financialYear: string; sections: { value: string; label: string }[] }) {
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
              {sections.map((s) => (
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
