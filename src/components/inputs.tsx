/**
 * Form controls built to HANDOVER.md §8.9.
 *
 * Every input has a visible label (§8.13). Placeholders are examples, not labels.
 * Errors appear in one block under the fields and say what to change.
 */
import * as React from "react";
import { cn } from "@/lib/utils";

const CONTROL_BASE =
  "h-10 w-full rounded-xl border border-control bg-surface px-3 text-sm text-ink " +
  "placeholder:text-faint transition-colors duration-150 " +
  "focus:border-ink focus:ring-4 focus:ring-ink/5 focus-visible:outline-none " +
  "disabled:bg-canvas disabled:text-muted";

/* ------------------------------------------------------------------- field */

export function Field({
  label,
  htmlFor,
  required,
  hint,
  className,
  children,
}: {
  label: string;
  htmlFor?: string;
  required?: boolean;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={htmlFor} className="text-[13px] font-medium text-ink-hover">
        {label}
        {required ? <span className="text-faint"> *</span> : null}
      </label>
      {children}
      {hint ? <p className="text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ inputs */

export function Input({
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(CONTROL_BASE, className)} {...props} />;
}

/** Amounts and counts line up in columns, so they use tabular figures (§8.3). */
export function NumberInput({
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type="number"
      inputMode="decimal"
      className={cn(CONTROL_BASE, "tabular", className)}
      {...props}
    />
  );
}

export function DateInput({
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type="date"
      className={cn(CONTROL_BASE, "tabular", className)}
      {...props}
    />
  );
}

export function Select({
  className,
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(CONTROL_BASE, "pr-8", className)} {...props}>
      {children}
    </select>
  );
}

export function Textarea({
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(CONTROL_BASE, "h-auto min-h-20 py-2.5", className)}
      {...props}
    />
  );
}

export function Checkbox({
  label,
  className,
  id,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <input
        id={id}
        type="checkbox"
        className={cn(
          "size-4 shrink-0 rounded-[4px] border-control text-ink accent-ink",
          className,
        )}
        {...props}
      />
      <label htmlFor={id} className="text-sm text-ink">
        {label}
      </label>
    </div>
  );
}

/* ------------------------------------------------------------- form layout */

/** One column, 16px between fields (§8.11 Forms). */
export function FormGrid({
  columns = 2,
  className,
  children,
}: {
  columns?: 1 | 2 | 3;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "grid gap-4",
        columns === 1 && "grid-cols-1",
        columns === 2 && "grid-cols-1 sm:grid-cols-2",
        columns === 3 && "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Spans every column of a FormGrid. */
export function FormFull({ children }: { children: React.ReactNode }) {
  return <div className="sm:col-span-2 lg:col-span-3">{children}</div>;
}

/** Optional fields stay folded away until asked for (§8.9). */
export function MoreDetails({
  children,
  label = "More details",
}: {
  children: React.ReactNode;
  label?: string;
}) {
  return (
    <details className="group">
      <summary className="inline-flex cursor-pointer list-none items-center text-[13px] text-muted transition-colors duration-150 hover:text-ink">
        {label}
      </summary>
      <div className="mt-4">{children}</div>
    </details>
  );
}

/* ------------------------------------------------------------------ errors */

export function FormError({ children }: { children: React.ReactNode }) {
  if (!children) return null;
  return (
    <div
      role="alert"
      className="rounded-xl bg-danger-soft px-3.5 py-3 text-[13px] text-danger-strong"
    >
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------- chips */

export function Chip({
  selected,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { selected?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cn(
        "rounded-full border px-3 py-1 text-xs font-medium transition-colors duration-150",
        selected
          ? "border-ink bg-ink text-white"
          : "border-control bg-surface text-ink-hover hover:border-faint",
        className,
      )}
      {...props}
    />
  );
}
