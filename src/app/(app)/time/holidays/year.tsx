"use client";

import * as React from "react";
import { useActionState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Loader2, Plus, Trash2, CopyPlus } from "lucide-react";
import {
  saveHolidayYear,
  deleteHolidayYear,
  copyHolidayYear,
  saveHoliday,
  deleteHoliday,
  type ActionState,
} from "@/app/actions/time";
import { Button, Card, CardHeader } from "@/components/ui";
import { Dialog } from "@/components/dialog";
import { Field, Input, Select, DateInput, NumberInput, Checkbox, FormGrid, FormError } from "@/components/inputs";
import { useToast } from "@/components/toast";

const INITIAL: ActionState = {};

/** Which calendar, and which of its years, this screen is showing. */
export function YearPicker({
  calendars,
  years,
  calendarCode,
  year,
}: {
  calendars: { value: string; label: string }[];
  years: number[];
  calendarCode: string;
  year: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const thisYear = new Date().getFullYear();

  // Years that exist, plus the next two, so a year can be opened before it
  // has anything on it.
  const offered = [...new Set([...years, thisYear, thisYear + 1, thisYear + 2])].sort((a, b) => a - b);

  const go = (next: { calendar?: string; year?: number }) =>
    router.push(`${pathname}?calendar=${next.calendar ?? calendarCode}&year=${next.year ?? year}`);

  return (
    <Card>
      <div className="flex flex-wrap items-end gap-4 px-6 py-4">
        <Field label="Calendar" htmlFor="pick-calendar">
          <Select id="pick-calendar" value={calendarCode} onChange={(e) => go({ calendar: e.target.value })}>
            {calendars.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Year" htmlFor="pick-year">
          <Select id="pick-year" value={String(year)} onChange={(e) => go({ year: Number(e.target.value) })}>
            {offered.map((y) => (
              <option key={y} value={y}>
                {y}
                {years.includes(y) ? "" : " — not opened"}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </Card>
  );
}

/** The year's cap, and whether people can see it yet. */
export function YearSettings({
  calendarCode,
  year,
  open,
}: {
  calendarCode: string;
  year: number;
  open: { totalAllowance: number; isPublished: boolean } | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [state, action, pending] = useActionState(async (prev: ActionState, form: FormData) => {
    const result = await saveHolidayYear(prev, form);
    if (result.ok) {
      toast(open ? "Year updated" : "Year opened");
      router.refresh();
    }
    return result;
  }, INITIAL);

  const [removing, setRemoving] = React.useState(false);
  const [removeState, removeAction, removing_] = useActionState(async (prev: ActionState, form: FormData) => {
    const result = await deleteHolidayYear(prev, form);
    if (result.ok) {
      setRemoving(false);
      toast("Year removed");
      router.refresh();
    }
    return result;
  }, INITIAL);

  return (
    <>
      <form action={action} className="flex flex-wrap items-end gap-4">
        <input type="hidden" name="calendarCode" value={calendarCode} />
        <input type="hidden" name="year" value={year} />
        <Field
          label="Days off this year"
          htmlFor="totalAllowance"
          hint="Fixed and chosen together."
        >
          <NumberInput
            id="totalAllowance"
            name="totalAllowance"
            min="0"
            max="60"
            step="1"
            defaultValue={String(open?.totalAllowance ?? 12)}
          />
        </Field>
        <div className="pb-2">
          <Checkbox id="isPublished" name="isPublished" label="Published" defaultChecked={open?.isPublished ?? false} />
        </div>
        <div className="pb-1">
          <Button type="submit" variant={open ? "secondary" : "primary"} disabled={pending}>
            {pending ? <Loader2 className="animate-spin" /> : null}
            {open ? "Save year" : `Open ${year}`}
          </Button>
        </div>
        {open ? (
          <div className="pb-1">
            <Button type="button" variant="ghost" onClick={() => setRemoving(true)}>
              <Trash2 />
              Remove year
            </Button>
          </div>
        ) : null}
      </form>
      {state.error ? (
        <div className="mt-3">
          <FormError>{state.error}</FormError>
        </div>
      ) : null}

      <Dialog
        open={removing}
        onClose={() => setRemoving(false)}
        title={`Remove ${year}?`}
        description="A year can only be removed once nothing is listed on it."
        footer={
          <>
            <Button variant="ghost" onClick={() => setRemoving(false)} disabled={removing_}>
              Cancel
            </Button>
            <Button type="submit" form="remove-year" variant="destructive" disabled={removing_}>
              {removing_ ? <Loader2 className="animate-spin" /> : null}
              Remove year
            </Button>
          </>
        }
      >
        <form id="remove-year" action={removeAction} className="pb-1">
          <input type="hidden" name="calendarCode" value={calendarCode} />
          <input type="hidden" name="year" value={year} />
          {removeState.error ? <FormError>{removeState.error}</FormError> : null}
        </form>
      </Dialog>
    </>
  );
}

/** One more day on this year's list. */
export function NewHoliday({ calendarCode, year }: { calendarCode: string; year: number }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = React.useState(false);
  const [state, action, pending] = useActionState(async (prev: ActionState, form: FormData) => {
    const result = await saveHoliday(prev, form);
    if (result.ok) {
      setOpen(false);
      toast("Holiday added");
      router.refresh();
    }
    return result;
  }, INITIAL);

  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>
        <Plus />
        New holiday
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={`New holiday in ${year}`}
        description="A fixed holiday closes the company; an optional one is a working day until somebody chooses it."
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" form="new-holiday" variant="primary" disabled={pending}>
              {pending ? <Loader2 className="animate-spin" /> : null}
              Save holiday
            </Button>
          </>
        }
      >
        <form id="new-holiday" action={action} className="flex flex-col gap-4 pb-1">
          <input type="hidden" name="calendarCode" value={calendarCode} />
          <FormGrid columns={2}>
            <Field label="Date" htmlFor="date" required hint={`Inside ${year}.`}>
              <DateInput id="date" name="date" required defaultValue={`${year}-01-01`} />
            </Field>
            <Field label="Holiday name" htmlFor="name" required>
              <Input id="name" name="name" required placeholder="Gandhi Jayanti" />
            </Field>
          </FormGrid>
          <Checkbox id="isOptional" name="isOptional" label="Optional — people choose this one for themselves" />
          {state.error ? <FormError>{state.error}</FormError> : null}
        </form>
      </Dialog>
    </>
  );
}

export function DeleteHoliday({ id, describe }: { id: number; describe: string }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = React.useState(false);
  const [state, action, pending] = useActionState(async (prev: ActionState, form: FormData) => {
    const result = await deleteHoliday(prev, form);
    if (result.ok) {
      setOpen(false);
      toast("Holiday removed");
      router.refresh();
    }
    return result;
  }, INITIAL);

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)} aria-label={`Remove ${describe}`}>
        <Trash2 />
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Remove this holiday?"
        description={describe}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" form={`remove-holiday-${id}`} variant="destructive" disabled={pending}>
              {pending ? <Loader2 className="animate-spin" /> : null}
              Remove holiday
            </Button>
          </>
        }
      >
        <form id={`remove-holiday-${id}`} action={action} className="pb-1">
          <input type="hidden" name="id" value={id} />
          {state.error ? <FormError>{state.error}</FormError> : null}
        </form>
      </Dialog>
    </>
  );
}

/** Most of a year's list is last year's list, a year later. */
export function CopyLastYear({ calendarCode, year, years }: { calendarCode: string; year: number; years: number[] }) {
  const router = useRouter();
  const toast = useToast();
  const sources = years.filter((y) => y !== year);
  const [state, action, pending] = useActionState(async (prev: ActionState, form: FormData) => {
    const result = await copyHolidayYear(prev, form);
    if (result.ok) {
      toast("Days copied");
      router.refresh();
    }
    return result;
  }, INITIAL);

  if (sources.length === 0) return null;

  return (
    <Card>
      <CardHeader
        title="Copy another year"
        description="The same names on the same dates, a year apart. Days already on this year are left alone, and festivals that move are corrected by hand afterwards."
      />
      <form action={action} className="flex flex-wrap items-end gap-4 px-6 pb-6">
        <input type="hidden" name="calendarCode" value={calendarCode} />
        <input type="hidden" name="year" value={year} />
        <Field label="Copy from" htmlFor="fromYear">
          <Select id="fromYear" name="fromYear" defaultValue={String(sources[sources.length - 1])}>
            {sources.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </Select>
        </Field>
        <div className="pb-1">
          <Button type="submit" variant="secondary" disabled={pending}>
            {pending ? <Loader2 className="animate-spin" /> : <CopyPlus />}
            Copy into {year}
          </Button>
        </div>
        {state.error ? <FormError>{state.error}</FormError> : null}
      </form>
    </Card>
  );
}
