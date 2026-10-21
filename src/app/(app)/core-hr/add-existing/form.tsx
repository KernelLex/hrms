"use client";

import * as React from "react";
import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { addExistingEmployeeAction, type ActionState } from "@/app/actions/core-hr";
import { Button, Card } from "@/components/ui";
import { Field, Input, Select, DateInput, NumberInput, FormGrid, FormError } from "@/components/inputs";
import { useToast } from "@/components/toast";
import { formatINR } from "@/lib/money";

type Option = { value: string; label: string };
type PositionOption = Option & { orgUnitCode: string };

const INITIAL: ActionState = {};

/** §8.9 Tasks and steps — numbered steps with a summary that stays in view. */
function Step({
  n,
  title,
  description,
  children,
}: {
  n: number;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <div className="flex items-start gap-3 px-6 pt-5 pb-3">
        <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-ink text-xs font-medium text-white">
          {n}
        </span>
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
          {description ? <p className="mt-0.5 text-[13px] text-muted">{description}</p> : null}
        </div>
      </div>
      <div className="px-6 pb-5">{children}</div>
    </Card>
  );
}

export function ExistingEmployeeForm({
  companies,
  units,
  positions,
  schedules,
}: {
  companies: Option[];
  units: Option[];
  positions: PositionOption[];
  schedules: Option[];
}) {
  const router = useRouter();
  const toast = useToast();

  const [employeeNumber, setEmployeeNumber] = React.useState("");
  const [firstName, setFirstName] = React.useState("");
  const [lastName, setLastName] = React.useState("");
  const [positionCode, setPositionCode] = React.useState(positions[0]?.value ?? "");
  const [amount, setAmount] = React.useState("");
  const [joinedOn, setJoinedOn] = React.useState("");

  const selectedPosition = positions.find((p) => p.value === positionCode);
  const impliedUnit = selectedPosition?.orgUnitCode ?? units[0]?.value ?? "";

  const [state, formAction, pending] = useActionState(
    async (prev: ActionState, form: FormData): Promise<ActionState> => {
      const result = await addExistingEmployeeAction(prev, form);
      if (result.ok && result.employeeId) {
        toast("Employee added");
        router.push(`/core-hr/${result.employeeId}`);
      }
      return result;
    },
    INITIAL,
  );

  const amountPaise = Math.round((Number(amount) || 0) * 100);

  // React resets an uncontrolled field to its `defaultValue` once the action
  // returns, so a refused form reads its defaults back from what was typed.
  // Nothing is retyped — least of all a bank account.
  const back = state.values;
  const d = (field: string, fallback = "") => back?.[field] ?? fallback;

  return (
    <form action={formAction}>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex flex-col gap-6">
          <Step
            n={1}
            title="Who they are on the payroll"
            description="Their own number and the day they actually joined, both kept as they are."
          >
            <FormGrid columns={3}>
              <Field label="Employee number" htmlFor="employeeNumber" required hint="Theirs, not a new one.">
                <Input
                  id="employeeNumber"
                  name="employeeNumber"
                  required
                  placeholder="EMP0042"
                  className="uppercase"
                  value={employeeNumber}
                  onChange={(e) => setEmployeeNumber(e.target.value)}
                />
              </Field>
              <Field label="Joined on" htmlFor="effectiveDate" required hint="The real date, however long ago.">
                <DateInput
                  id="effectiveDate"
                  name="effectiveDate"
                  required
                  value={joinedOn}
                  onChange={(e) => setJoinedOn(e.target.value)}
                />
              </Field>
              <Field
                label="Previous number"
                htmlFor="previousPersonnelNumber"
                hint="What the old system called them, if different."
              >
                <Input id="previousPersonnelNumber" name="previousPersonnelNumber" placeholder="10045" defaultValue={d("previousPersonnelNumber")} />
              </Field>
            </FormGrid>
          </Step>

          <Step
            n={2}
            title="Organisational assignment"
            description="One position holds one person, so only vacant ones are listed. Choosing one sets the department."
          >
            <FormGrid columns={2}>
              <Field label="Position" htmlFor="positionCode" required>
                <Select
                  id="positionCode"
                  name="positionCode"
                  required
                  value={positionCode}
                  onChange={(e) => setPositionCode(e.target.value)}
                >
                  {positions.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Department" htmlFor="orgUnitDisplay" hint="Set by the position.">
                {/* Display only — the hidden field carries it, because a
                    disabled control is never submitted. */}
                <Input id="orgUnitDisplay" value={units.find((u) => u.value === impliedUnit)?.label ?? ""} disabled readOnly />
              </Field>
              <input type="hidden" name="orgUnitCode" value={impliedUnit} />
              <Field label="Company" htmlFor="companyCode" required>
                <Select id="companyCode" name="companyCode" required defaultValue={d("companyCode", companies[0]?.value)}>
                  {companies.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Cost centre" htmlFor="costCenter" hint="Used when payroll posts to finance.">
                <Input id="costCenter" name="costCenter" placeholder="CC-IT-01" defaultValue={d("costCenter")} />
              </Field>
            </FormGrid>
          </Step>

          <Step n={3} title="Personal data" description="The person, as distinct from the role.">
            <FormGrid columns={3}>
              <Field label="First name" htmlFor="firstName" required>
                <Input
                  id="firstName"
                  name="firstName"
                  required
                  placeholder="Meera"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                />
              </Field>
              <Field label="Last name" htmlFor="lastName" required>
                <Input
                  id="lastName"
                  name="lastName"
                  required
                  placeholder="Nair"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                />
              </Field>
              <Field label="Date of birth" htmlFor="dateOfBirth">
                <DateInput id="dateOfBirth" name="dateOfBirth" defaultValue={d("dateOfBirth")} />
              </Field>
              <Field label="Gender" htmlFor="gender">
                <Select id="gender" name="gender" defaultValue={d("gender")}>
                  <option value="">Prefer not to say</option>
                  <option>Female</option>
                  <option>Male</option>
                  <option>Other</option>
                </Select>
              </Field>
              <Field label="Marital status" htmlFor="maritalStatus">
                <Select id="maritalStatus" name="maritalStatus" defaultValue={d("maritalStatus")}>
                  <option value="">Not recorded</option>
                  <option>Single</option>
                  <option>Married</option>
                  <option>Divorced</option>
                  <option>Widowed</option>
                </Select>
              </Field>
              <Field label="Nationality" htmlFor="nationality">
                <Input id="nationality" name="nationality" placeholder="Indian" defaultValue={d("nationality")} />
              </Field>
              <Field label="Work email" htmlFor="workEmail" className="sm:col-span-2">
                <Input id="workEmail" name="workEmail" type="email" placeholder="meera.nair@acme.example" defaultValue={d("workEmail")} />
              </Field>
            </FormGrid>
          </Step>

          <Step
            n={4}
            title="Pay and working time"
            description="What they earn today. Every later change is a new dated record on top of this one."
          >
            <FormGrid columns={3}>
              <Field label="Pay scale group" htmlFor="payScaleGroup">
                <Select id="payScaleGroup" name="payScaleGroup" defaultValue={d("payScaleGroup", "L1")}>
                  {["L1", "L2", "L3", "M1", "M2"].map((g) => (
                    <option key={g}>{g}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Basic salary" htmlFor="amount" required hint="Per month.">
                <NumberInput
                  id="amount"
                  name="amount"
                  required
                  min="1"
                  step="1"
                  placeholder="68000"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </Field>
              <Field label="Currency" htmlFor="currency">
                <Select id="currency" name="currency" defaultValue={d("currency", "INR")}>
                  <option>INR</option>
                </Select>
              </Field>
              <Field label="Work schedule" htmlFor="workScheduleCode" required>
                <Select id="workScheduleCode" name="workScheduleCode" required defaultValue={d("workScheduleCode", schedules[0]?.value)}>
                  {schedules.map((w) => (
                    <option key={w.value} value={w.value}>
                      {w.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Weekly hours" htmlFor="weeklyHours">
                <NumberInput id="weeklyHours" name="weeklyHours" min="1" max="100" step="1" defaultValue={d("weeklyHours", "40")} />
              </Field>
              <Field label="Employment %" htmlFor="employmentPercent" hint="Less than 100 for part time.">
                <NumberInput id="employmentPercent" name="employmentPercent" min="1" max="100" step="1" defaultValue={d("employmentPercent", "100")} />
              </Field>
            </FormGrid>
          </Step>

          <Step
            n={5}
            title="Bank and statutory details"
            description="What the first payroll run needs to actually pay them. Leave any of it empty and file it later on their record."
          >
            <FormGrid columns={3}>
              <Field label="Bank name" htmlFor="bankName">
                <Input id="bankName" name="bankName" placeholder="State Bank of India" defaultValue={d("bankName")} />
              </Field>
              <Field label="Account number" htmlFor="accountNumber">
                <Input id="accountNumber" name="accountNumber" placeholder="30123456789" defaultValue={d("accountNumber")} />
              </Field>
              <Field label="IFSC" htmlFor="ifsc">
                <Input id="ifsc" name="ifsc" placeholder="SBIN0001234" className="uppercase" defaultValue={d("ifsc")} />
              </Field>
              <Field label="PAN" htmlFor="pan" hint="Needed for Form 16 and the 24Q return.">
                <Input id="pan" name="pan" placeholder="ABCPR1234K" className="uppercase" defaultValue={d("pan")} />
              </Field>
              <Field label="UAN" htmlFor="uan" hint="12 digits.">
                <Input id="uan" name="uan" placeholder="100123456789" defaultValue={d("uan")} />
              </Field>
              <Field label="ESI number" htmlFor="esiNumber" hint="Empty above the wage ceiling.">
                <Input id="esiNumber" name="esiNumber" defaultValue={d("esiNumber")} />
              </Field>
              <Field
                label="Professional tax state"
                htmlFor="professionalTaxState"
                hint="Matches a state on the statutory rates screen."
              >
                <Input id="professionalTaxState" name="professionalTaxState" placeholder="KARNATAKA" className="uppercase" defaultValue={d("professionalTaxState")} />
              </Field>
            </FormGrid>
          </Step>

          {state.error ? <FormError>{state.error}</FormError> : null}
        </div>

        {/* Live summary — stays in view while scrolling (§8.9). */}
        <div className="lg:sticky lg:top-8 lg:self-start">
          <Card>
            <div className="px-6 pt-5 pb-4">
              <h2 className="text-[15px] font-semibold text-ink">Summary</h2>
              <p className="mt-0.5 text-[13px] text-muted">What this will put on record.</p>
            </div>
            <dl className="divide-y divide-soft px-6 pb-2">
              {[
                ["Number", employeeNumber.toUpperCase()],
                ["Name", [firstName, lastName].filter(Boolean).join(" ")],
                ["Position", selectedPosition?.label ?? ""],
                ["Joined", joinedOn],
              ].map(([label, value]) => (
                <div key={label} className="flex items-baseline justify-between gap-4 py-3">
                  <dt className="text-[13px] text-muted">{label}</dt>
                  <dd className="truncate text-right text-[13px] text-ink">
                    {value ? value : <span className="text-decor">&mdash;</span>}
                  </dd>
                </div>
              ))}
            </dl>
            <div className="px-6 pb-5">
              <div className="text-[13px] text-muted">Basic pay</div>
              <div className="tabular mt-1 text-[26px] leading-tight font-semibold tracking-[-0.02em] text-ink">
                {amountPaise > 0 ? formatINR(amountPaise) : "—"}
              </div>
              <p className="mt-3 text-[13px] text-muted">
                No onboarding checklist and no probation review: they were inducted long before this
                system arrived.
              </p>
              <div className="mt-4">
                <Button type="submit" variant="primary" size="lg" disabled={pending} className="w-full">
                  {pending ? <Loader2 className="animate-spin" /> : null}
                  Add employee
                </Button>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </form>
  );
}
