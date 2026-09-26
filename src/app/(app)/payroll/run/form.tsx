"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, Play, RotateCw } from "lucide-react";
import {
  startRunAction,
  startOffCycleAction,
  continueRun,
  type ActionState,
} from "@/app/actions/payroll";
import type { RunProgress } from "@/lib/engines/payroll";
import { Button, Card, CardHeader } from "@/components/ui";
import {
  Field,
  Select,
  Input,
  DateInput,
  FormGrid,
  FormError,
  Checkbox,
} from "@/components/inputs";
import { useToast } from "@/components/toast";
import { formatINR } from "@/lib/money";

type Period = { value: string; label: string; runnable: boolean };

/**
 * Drives a run batch by batch until it is done, reporting progress.
 *
 * The server calculates a few people per request, so the whole organisation
 * never has to fit inside one request's time limit. If the tab is closed the
 * run simply waits, and "Resume run" picks it up.
 */
function useRunDriver(onDone: (runId: number, p: RunProgress) => void) {
  const [progress, setProgress] = React.useState<RunProgress | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const drive = React.useCallback(
    async (runId: number) => {
      setBusy(true);
      setError(null);
      try {
        for (;;) {
          const p = await continueRun(runId);
          if ("error" in p) {
            setError(p.error);
            return;
          }
          setProgress(p);
          if (p.completed) {
            onDone(runId, p);
            return;
          }
        }
      } catch {
        setError("The connection dropped. Resume the run to carry on where it stopped.");
      } finally {
        setBusy(false);
      }
    },
    [onDone],
  );

  const start = React.useCallback(
    async (begin: () => Promise<ActionState>) => {
      setBusy(true);
      setError(null);
      setProgress(null);
      const result = await begin();
      if (result.error || !result.runId) {
        setError(result.error ?? "The run could not start.");
        setBusy(false);
        return;
      }
      await drive(result.runId);
    },
    [drive],
  );

  return { progress, error, busy, start, drive };
}

/** §10 Meters: an 8px pill, ink on a soft track. */
function RunMeter({ progress }: { progress: RunProgress }) {
  const pct = progress.planned === 0 ? 100 : Math.round((progress.done / progress.planned) * 100);
  return (
    <div className="mt-4">
      <div className="flex items-baseline justify-between text-[13px]">
        <span className="text-muted">
          {progress.completed ? "Calculated" : "Calculating"}{" "}
          <span className="tabular font-medium text-ink">
            {progress.done} of {progress.planned}
          </span>{" "}
          people
        </span>
        {progress.errors > 0 ? (
          <span className="tabular text-danger">{progress.errors} could not be paid</span>
        ) : null}
      </div>
      <div
        role="progressbar"
        aria-label="Payroll run progress"
        aria-valuemin={0}
        aria-valuemax={progress.planned}
        aria-valuenow={progress.done}
        className="mt-2 h-2 overflow-hidden rounded-full bg-soft"
      >
        <div
          className="h-full rounded-full bg-ink transition-[width] duration-150"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function RunForm({
  periods,
  selectedId,
  inProgressRunId,
}: {
  periods: Period[];
  selectedId: string;
  /** A regular run for this period that stopped part way. */
  inProgressRunId: number | null;
}) {
  const toast = useToast();
  const router = useRouter();
  const [periodId, setPeriodId] = React.useState(selectedId);
  const selected = periods.find((p) => p.value === periodId);

  const onDone = React.useCallback(
    (runId: number, p: RunProgress) => {
      toast(p.errors > 0 ? `Payroll run complete, ${p.errors} not paid` : "Payroll run complete");
      router.replace(`/payroll/run?period=${periodId}&run=${runId}`);
      router.refresh();
    },
    [periodId, router, toast],
  );
  const { progress, error, busy, start, drive } = useRunDriver(onDone);

  return (
    <Card>
      <CardHeader
        title="Period"
        description="Only a released period can be run. Running again replaces the previous regular run for that period."
      />
      <form
        className="px-6 pb-5"
        onSubmit={(e) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          void start(() => startRunAction({}, form));
        }}
      >
        <FormGrid columns={2}>
          <Field label="Payroll period" htmlFor="periodId" required>
            <Select
              id="periodId"
              name="periodId"
              value={periodId}
              disabled={busy}
              onChange={(e) => {
                setPeriodId(e.target.value);
                router.push(`/payroll/run?period=${e.target.value}`);
              }}
            >
              {periods.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </Select>
          </Field>
        </FormGrid>

        {progress ? <RunMeter progress={progress} /> : null}
        {error ? (
          <div className="mt-4">
            <FormError>{error}</FormError>
          </div>
        ) : null}

        <div className="mt-4 flex flex-wrap gap-2">
          {inProgressRunId && !busy ? (
            <Button type="button" variant="secondary" onClick={() => void drive(inProgressRunId)}>
              <RotateCw />
              Resume run
            </Button>
          ) : null}
          <Button type="submit" variant="primary" disabled={busy || !selected?.runnable}>
            {busy ? <Loader2 className="animate-spin" /> : <Play />}
            Run payroll
          </Button>
        </div>
      </form>
    </Card>
  );
}

export type OffCycleCandidate = {
  employeeId: number;
  name: string;
  number: string;
  owedPaise: number;
  payments: number;
};

export function OffCycleForm({
  periodId,
  candidates,
  primary,
  defaultPayDate,
}: {
  periodId: number;
  candidates: OffCycleCandidate[];
  /** The one primary action on the screen when the regular run is closed. */
  primary: boolean;
  defaultPayDate: string;
}) {
  const toast = useToast();
  const router = useRouter();
  const onDone = React.useCallback(
    (runId: number, p: RunProgress) => {
      toast(p.errors > 0 ? `Off-cycle run complete, ${p.errors} not paid` : "Off-cycle run complete");
      router.replace(`/payroll/run?period=${periodId}&run=${runId}`);
      router.refresh();
    },
    [periodId, router, toast],
  );
  const { progress, error, busy, start } = useRunDriver(onDone);

  return (
    <Card>
      <CardHeader
        title="Off-cycle run"
        description="Pays one-off payments still owed — a bonus agreed after the month was run, or a final settlement — without re-running the month."
      />
      <form
        className="px-6 pb-5"
        onSubmit={(e) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          form.set("periodId", String(periodId));
          void start(() => startOffCycleAction({}, form));
        }}
      >
        <fieldset>
          <legend className="text-[13px] font-medium text-ink-hover">People owed a payment</legend>
          <ul className="mt-2 divide-y divide-soft">
            {candidates.map((c) => (
              <li key={c.employeeId} className="flex items-center justify-between gap-4 py-2.5">
                <Checkbox
                  id={`oc-${c.employeeId}`}
                  name="employeeId"
                  value={String(c.employeeId)}
                  defaultChecked
                  label={`${c.name}, ${c.number}`}
                />
                <span className="tabular shrink-0 text-[13px] text-muted">
                  {formatINR(c.owedPaise)} in {c.payments} {c.payments === 1 ? "payment" : "payments"}
                </span>
              </li>
            ))}
          </ul>
        </fieldset>

        <FormGrid columns={2} className="mt-4">
          <Field label="What it is for" htmlFor="oc-reason" required>
            <Input id="oc-reason" name="reason" placeholder="Diwali bonus" required />
          </Field>
          <Field label="Pay date" htmlFor="oc-payDate" required>
            <DateInput id="oc-payDate" name="payDate" defaultValue={defaultPayDate} required />
          </Field>
        </FormGrid>

        {progress ? <RunMeter progress={progress} /> : null}
        {error ? (
          <div className="mt-4">
            <FormError>{error}</FormError>
          </div>
        ) : null}

        <div className="mt-4">
          <Button type="submit" variant={primary ? "primary" : "secondary"} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : null}
            Run off-cycle payroll
          </Button>
        </div>
      </form>
    </Card>
  );
}
