"use client";

import * as React from "react";
import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { hireEmployee, type ActionState } from "@/app/actions/core-hr";
import { Button, Card } from "@/components/ui";
import {
  Field,
  Input,
  Select,
  DateInput,
  NumberInput,
  FormGrid,
  FormError,
} from "@/components/inputs";
import { useToast } from "@/components/toast";
import { formatINR } from "@/lib/money";

type Option = { value: string; label: string };
type PositionOption = Option & { orgUnitCode: string };

const INITIAL: ActionState = {};

/**
 * §9 Tasks and steps — each step numbered with a 24px ink circle, and a live
 * summary panel on the right that stays in view while scrolling.
 */
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
          {description ? (
            <p className="mt-0.5 text-[13px] text-muted">{description}</p>
          ) : null}
        </div>
      </div>
      <div className="px-6 pb-5">{children}</div>
    </Card>
  );
}

export function HireForm({
  companies,
  areas,
  units,
  positions,
  schedules,
}: {
  companies: Option[];
  areas: Option[];
  units: Option[];
  positions: PositionOption[];
  schedules: Option[];
}) {
  const router = useRouter();
  const toast = useToast();

  const [firstName, setFirstName] = React.useState("");
  const [lastName, setLastName] = React.useState("");
  const [positionCode, setPositionCode] = React.useState(positions[0]?.value ?? "");
  const [amount, setAmount] = React.useState("");
  const [effectiveDate, setEffectiveDate] = React.useState("");

  const selectedPosition = positions.find((p) => p.value === positionCode);
  // Choosing a vacant position implies its department; the field follows it.
  const impliedUnit = selectedPosition?.orgUnitCode ?? units[0]?.value ?? "";

  const [state, formAction, pending] = useActionState(
    async (prev: ActionState, form: FormData): Promise<ActionState> => {
      const result = await hireEmployee(prev, form);
      if (result.ok && result.employeeId) {
        toast("Employee hired");
        router.push(`/core-hr/${result.employeeId}`);
      }
      return result;
    },
    INITIAL,
  );

  const amountPaise = Math.round((Number(amount) || 0) * 100);

  return (
    <form action={formAction}>
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="flex flex-col gap-6">
          <Step
            n={1}
            title="Action"
            description="What is happening, and from when. This drives which records get created."
          >
            <FormGrid columns={3}>
              <Field label="Action type" htmlFor="actionType" required>
                <Select id="actionType" name="actionType" defaultValue="Hire">
                  <option>Hire</option>
                  <option>Rehire</option>
                </Select>
              </Field>
              <Field label="Effective date" htmlFor="effectiveDate" required>
                <DateInput
                  id="effectiveDate"
                  name="effectiveDate"
                  required
                  value={effectiveDate}
                  onChange={(e) => setEffectiveDate(e.target.value)}
                />
              </Field>
              <Field label="Reason" htmlFor="reason">
                <Select id="reason" name="reason" defaultValue="New position">
                  <option>New position</option>
                  <option>Business growth</option>
                  <option>Replacement</option>
                </Select>
              </Field>
            </FormGrid>
          </Step>

          <Step
            n={2}
            title="Organisational assignment"
            description="Only vacant positions are listed. Choosing one sets the department."
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
                {/* Display only — the value is carried by the hidden field
                    below, because a disabled control is never submitted. */}
                <Input
                  id="orgUnitDisplay"
                  value={units.find((u) => u.value === impliedUnit)?.label ?? ""}
                  disabled
                  readOnly
                />
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
                <Select id="areaCode" name="areaCode" defaultValue={areas[0]?.value ?? ""}>
                  <option value="">None</option>
                  {areas.map((a) => (
                    <option key={a.value} value={a.value}>
                      {a.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Cost centre" htmlFor="costCenter" hint="Used when payroll posts to finance.">
                <Input id="costCenter" name="costCenter" placeholder="CC-IT-01" />
              </Field>
            </FormGrid>
          </Step>

          <Step n={3} title="Personal data" description="The person, as distinct from the role.">
            <FormGrid columns={2}>
              <Field label="First name" htmlFor="firstName" required>
                <Input
                  id="firstName"
                  name="firstName"
                  required
                  placeholder="Priya"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                />
              </Field>
              <Field label="Last name" htmlFor="lastName" required>
                <Input
                  id="lastName"
                  name="lastName"
                  required
                  placeholder="Sharma"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                />
              </Field>
              <Field label="Date of birth" htmlFor="dateOfBirth">
                <DateInput id="dateOfBirth" name="dateOfBirth" />
              </Field>
              <Field label="Gender" htmlFor="gender">
                <Select id="gender" name="gender" defaultValue="">
                  <option value="">Prefer not to say</option>
                  <option>Female</option>
                  <option>Male</option>
                  <option>Other</option>
                </Select>
              </Field>
            </FormGrid>
          </Step>

          <Step
            n={4}
            title="Basic pay"
            description="The starting salary. Payroll reads this, and every later change is a new dated record."
          >
            <FormGrid columns={3}>
              <Field label="Pay scale group" htmlFor="payScaleGroup">
                <Select id="payScaleGroup" name="payScaleGroup" defaultValue="L1">
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
                  placeholder="65000"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </Field>
              <Field label="Currency" htmlFor="currency">
                <Select id="currency" name="currency" defaultValue="INR">
                  <option>INR</option>
                </Select>
              </Field>
              <Field label="Work schedule" htmlFor="workScheduleCode" required>
                <Select
                  id="workScheduleCode"
                  name="workScheduleCode"
                  required
                  defaultValue={schedules[0]?.value}
                >
                  {schedules.map((w) => (
                    <option key={w.value} value={w.value}>
                      {w.label}
                    </option>
                  ))}
                </Select>
              </Field>
            </FormGrid>
          </Step>

          {state.error ? <FormError>{state.error}</FormError> : null}
        </div>

        {/* Live summary — stays in view while scrolling (§9). */}
        <div className="lg:sticky lg:top-8 lg:self-start">
          <Card>
            <div className="px-6 pt-5 pb-4">
              <h2 className="text-[15px] font-semibold text-ink">Summary</h2>
              <p className="mt-0.5 text-[13px] text-muted">
                What this action will create.
              </p>
            </div>
            <dl className="divide-y divide-soft px-6 pb-2">
              {[
                ["Name", [firstName, lastName].filter(Boolean).join(" ")],
                ["Position", selectedPosition?.label ?? ""],
                ["Starting", effectiveDate],
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
                Creates five records: action, org assignment, personal data,
                working time and basic pay.
              </p>
              <div className="mt-4">
                <Button type="submit" variant="primary" size="lg" disabled={pending} className="w-full">
                  {pending ? <Loader2 className="animate-spin" /> : null}
                  Run hire action
                </Button>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </form>
  );
}
