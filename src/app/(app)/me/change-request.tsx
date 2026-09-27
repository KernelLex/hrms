"use client";

import * as React from "react";
import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { cancelChange, requestChange, type ActionState } from "@/app/actions/corrections";
import { GENDERS, MARITAL_STATUSES } from "@/lib/corrections-values";
import { Button } from "@/components/ui";
import { Dialog } from "@/components/dialog";
import { DateInput, Field, FormError, FormFull, FormGrid, Input, Select, Textarea } from "@/components/inputs";
import { useToast } from "@/components/toast";

type Values = Record<string, string>;

export type CurrentRecord = {
  personal: Values;
  addresses: Record<string, Values>;
  contacts: Record<string, string>;
  bank: Values | null;
};

const CHOICES = [
  { key: "personal", label: "Personal details" },
  { key: "address:Permanent", label: "Permanent address" },
  { key: "address:Temporary", label: "Temporary address" },
  { key: "contact:Mobile phone", label: "Mobile phone" },
  { key: "contact:Email (personal)", label: "Personal email" },
  { key: "bank", label: "Bank account" },
] as const;

type Choice = (typeof CHOICES)[number]["key"];

function Fields({ choice, current, id }: { choice: Choice; current: CurrentRecord; id: string }) {
  const [section, subtype] = choice.split(":");
  const f = (name: string) => `${id}-${name}`;
  if (section === "personal") {
    const p = current.personal;
    return (
      <>
        <Field label="First name" htmlFor={f("first")} required>
          <Input id={f("first")} name="first_name" required maxLength={60} defaultValue={p.first_name} />
        </Field>
        <Field label="Last name" htmlFor={f("last")} required>
          <Input id={f("last")} name="last_name" required maxLength={60} defaultValue={p.last_name} />
        </Field>
        <Field label="Date of birth" htmlFor={f("dob")}>
          <DateInput id={f("dob")} name="date_of_birth" defaultValue={p.date_of_birth} />
        </Field>
        <Field label="Gender" htmlFor={f("gender")}>
          <Select id={f("gender")} name="gender" defaultValue={p.gender}>
            <option value="">Prefer not to say</option>
            {GENDERS.map((g) => (
              <option key={g}>{g}</option>
            ))}
          </Select>
        </Field>
        <Field label="Marital status" htmlFor={f("marital")}>
          <Select id={f("marital")} name="marital_status" defaultValue={p.marital_status}>
            <option value="">Not recorded</option>
            {MARITAL_STATUSES.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </Select>
        </Field>
        <Field label="Nationality" htmlFor={f("nationality")}>
          <Input id={f("nationality")} name="nationality" maxLength={60} defaultValue={p.nationality} />
        </Field>
      </>
    );
  }
  if (section === "address") {
    const a = current.addresses[subtype] ?? {};
    return (
      <>
        <FormFull>
          <Field label="Address" htmlFor={f("line")} required>
            <Input id={f("line")} name="line" required maxLength={300} defaultValue={a.line} placeholder="12, 4th Cross, Indiranagar" />
          </Field>
        </FormFull>
        <Field label="City" htmlFor={f("city")}>
          <Input id={f("city")} name="city" maxLength={80} defaultValue={a.city} />
        </Field>
        <Field label="State" htmlFor={f("state")}>
          <Input id={f("state")} name="state" maxLength={80} defaultValue={a.state} />
        </Field>
        <Field label="PIN code" htmlFor={f("pin")}>
          <Input id={f("pin")} name="postal_code" inputMode="numeric" maxLength={6} defaultValue={a.postal_code} />
        </Field>
        <Field label="Country" htmlFor={f("country")}>
          <Input id={f("country")} name="country" maxLength={80} defaultValue={a.country || "India"} />
        </Field>
      </>
    );
  }
  if (section === "contact") {
    const email = subtype === "Email (personal)";
    return (
      <FormFull>
        <Field label={email ? "Personal email" : "Mobile phone"} htmlFor={f("value")} required>
          <Input
            id={f("value")}
            name="value"
            required
            type={email ? "email" : "tel"}
            maxLength={200}
            defaultValue={current.contacts[subtype]}
            placeholder={email ? "name@example.com" : "+91 98765 43210"}
          />
        </Field>
      </FormFull>
    );
  }
  const b = current.bank ?? {};
  return (
    <>
      <Field label="Bank" htmlFor={f("bank")} required>
        <Input id={f("bank")} name="bank_name" required maxLength={100} defaultValue={b.bank_name} placeholder="HDFC Bank" />
      </Field>
      <Field label="IFSC" htmlFor={f("ifsc")} required hint="On your cheque book, 11 characters.">
        <Input id={f("ifsc")} name="ifsc" required maxLength={11} defaultValue={b.ifsc} placeholder="HDFC0001234" className="uppercase" />
      </Field>
      <Field label="Account number" htmlFor={f("account")} required>
        <Input id={f("account")} name="account_number" required inputMode="numeric" maxLength={18} autoComplete="off" />
      </Field>
      <Field label="Name on the account" htmlFor={f("holder")} required>
        <Input id={f("holder")} name="holder_name" required maxLength={120} defaultValue={b.holder_name} />
      </Field>
    </>
  );
}

/** "Request a change": one form for every part of the record an employee may ask to correct. */
export function ChangeRequestButton({
  current,
  today,
  preset,
  label = "Request a change",
}: {
  current: CurrentRecord;
  today: string;
  preset?: Choice;
  label?: string;
}) {
  const toast = useToast();
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [choice, setChoice] = React.useState<Choice>(preset ?? "personal");
  const id = React.useId();
  const [state, action, pending] = useActionState(async (prev: ActionState, form: FormData) => {
    const r = await requestChange(prev, form);
    if (r.ok) {
      setOpen(false);
      toast("Sent to HR for approval");
      router.refresh();
    }
    return r;
  }, {} as ActionState);
  const [section, subtype] = choice.split(":");
  const bank = section === "bank";

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        {label}
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        wide
        title={bank ? "Change your bank account" : "Request a change"}
        description={
          bank
            ? "Salaries go to the new account from the date you choose, once HR and a second approver have checked it."
            : "HR checks it before it changes. It applies from the date you choose, and your record keeps what it said before."
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" form={id} variant="primary" disabled={pending}>
              {pending ? <Loader2 className="animate-spin" /> : null}
              Send for approval
            </Button>
          </>
        }
      >
        <form id={id} action={action} className="flex flex-col gap-4 pb-1">
          <input type="hidden" name="section" value={section} />
          <input type="hidden" name="subtype" value={subtype ?? ""} />
          <FormGrid>
            {preset ? null : (
              <FormFull>
                <Field label="What to change" htmlFor={`${id}-choice`} required>
                  <Select id={`${id}-choice`} value={choice} onChange={(e) => setChoice(e.target.value as Choice)}>
                    {CHOICES.filter((c) => c.key !== "bank").map((c) => (
                      <option key={c.key} value={c.key}>
                        {c.label}
                      </option>
                    ))}
                  </Select>
                </Field>
              </FormFull>
            )}
            <Fields key={choice} choice={choice} current={current} id={id} />
            <Field label="Applies from" htmlFor={`${id}-from`} required hint={bank ? "Today or later." : "The day it became true."}>
              <DateInput id={`${id}-from`} name="effectiveDate" required defaultValue={today} min={bank ? today : undefined} />
            </Field>
            <Field
              label={bank ? "Proof of the account" : "Proof"}
              htmlFor={`${id}-evidence`}
              required={bank}
              hint={bank ? "A cancelled cheque or your passbook's first page: PDF, JPEG or PNG, up to 4 MB." : "Optional: a PDF, JPEG or PNG, up to 4 MB."}
            >
              <input
                id={`${id}-evidence`}
                name="evidence"
                type="file"
                required={bank}
                accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                className="block w-full text-sm text-ink file:mr-3 file:rounded-full file:border-0 file:bg-soft file:px-4 file:py-2 file:text-[13px] file:font-medium file:text-ink hover:file:bg-line"
              />
            </Field>
            <FormFull>
              <Field label="Note for HR" htmlFor={`${id}-note`}>
                <Textarea id={`${id}-note`} name="note" rows={2} maxLength={1000} placeholder={bank ? "Moved my salary account to HDFC." : "Moved house in August."} />
              </Field>
            </FormFull>
          </FormGrid>
          {state.error ? <FormError>{state.error}</FormError> : null}
        </form>
      </Dialog>
    </>
  );
}

export function CancelRequestButton({ id }: { id: number }) {
  const toast = useToast();
  const router = useRouter();
  const [state, action, pending] = useActionState(async (prev: ActionState, form: FormData) => {
    const r = await cancelChange(prev, form);
    if (r.ok) {
      toast("Request withdrawn");
      router.refresh();
    }
    return r;
  }, {} as ActionState);
  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <input type="hidden" name="id" value={id} />
      <Button type="submit" size="sm" variant="ghost" disabled={pending}>
        Withdraw
      </Button>
      {state.error ? <span className="text-[13px] text-danger">{state.error}</span> : null}
    </form>
  );
}
