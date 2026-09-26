/**
 * Primitives built to DESIGN_LANGUAGE.md §9-§11.
 *
 * Rules these encode so screens cannot break them:
 *  - one colour (ink) plus red for problems only
 *  - sentence case, no ALL CAPS
 *  - hairline edges, never a shadow on a resting surface
 *  - status carried by shape and word, not colour alone
 */
import * as React from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ button */

type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive";
type ButtonSize = "sm" | "md" | "lg";

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-ink text-white hover:bg-ink-hover",
  secondary:
    "bg-surface text-ink ring-1 ring-inset ring-control hover:bg-canvas hover:ring-decor",
  ghost: "text-secondary hover:bg-soft hover:text-ink",
  destructive:
    "bg-surface text-danger ring-1 ring-inset ring-control hover:bg-danger-soft hover:ring-danger-line",
};

const BUTTON_SIZE: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-[13px] gap-1.5",
  md: "h-9 px-4 text-sm gap-2",
  lg: "h-11 px-5 text-[15px] gap-2",
};

const BUTTON_BASE =
  "inline-flex items-center justify-center rounded-full font-medium whitespace-nowrap " +
  "transition-colors duration-150 ease-[cubic-bezier(0.4,0,0.2,1)] " +
  "disabled:opacity-40 disabled:pointer-events-none " +
  "[&_svg]:size-4 [&_svg]:shrink-0";

export function Button({
  variant = "secondary",
  size = "md",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  return (
    <button
      className={cn(BUTTON_BASE, BUTTON_VARIANT[variant], BUTTON_SIZE[size], className)}
      {...props}
    />
  );
}

export function ButtonLink({
  variant = "secondary",
  size = "md",
  className,
  ...props
}: React.ComponentProps<typeof Link> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  return (
    <Link
      className={cn(BUTTON_BASE, BUTTON_VARIANT[variant], BUTTON_SIZE[size], className)}
      {...props}
    />
  );
}

/* -------------------------------------------------------------------- card */

export function Card({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("rounded-2xl border border-line bg-surface", className)}
      {...props}
    />
  );
}

export function CardHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-3">
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
        {description ? (
          <p className="mt-0.5 text-[13px] text-muted">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 gap-2">{actions}</div> : null}
    </div>
  );
}

export function CardBody({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-6 pb-5", className)} {...props} />;
}

/* ------------------------------------------------------------ page header */

export function PageHeader({
  back,
  title,
  subtitle,
  badge,
  actions,
}: {
  back?: { href: string; label: string };
  title: string;
  subtitle?: string;
  badge?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-8">
      {back ? (
        <Link
          href={back.href}
          className="mb-2 inline-flex items-center gap-1 text-[13px] text-muted transition-colors duration-150 hover:text-ink"
        >
          <ChevronLeft className="size-4" />
          {back.label}
        </Link>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <h1 className="text-[28px] leading-tight font-semibold tracking-[-0.02em] text-ink">
              {title}
            </h1>
            {badge}
          </div>
          {subtitle ? (
            <p className="mt-1 max-w-[670px] text-[15px] text-muted">{subtitle}</p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex shrink-0 items-center gap-2">{actions}</div>
        ) : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ status */

/**
 * §9 Status. Every tone is distinct in greyscale, and always paired with a word.
 *  done      — finished, active, confirmed
 *  action    — needs action from us
 *  waiting   — in progress, or waiting on someone else
 *  neutral   — draft, closed
 *  problem   — something is wrong
 */
export type Tone = "done" | "action" | "waiting" | "neutral" | "problem";

const BADGE_TONE: Record<Tone, string> = {
  done: "bg-ink text-white",
  action: "bg-surface text-ink ring-1 ring-ink",
  waiting: "bg-surface text-ink-hover ring-1 ring-decor",
  neutral: "bg-soft text-secondary",
  problem: "bg-surface text-danger ring-1 ring-danger-line",
};

const DOT_TONE: Record<Tone, string> = {
  done: "bg-ink",
  action: "ring-[1.5px] ring-inset ring-ink",
  waiting: "ring-[1.5px] ring-inset ring-ink",
  neutral: "bg-decor",
  problem: "bg-danger-mark",
};

export function Badge({
  tone = "neutral",
  dot = false,
  children,
}: {
  tone?: Tone;
  dot?: boolean;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium",
        BADGE_TONE[tone],
      )}
    >
      {dot ? (
        <span className={cn("size-1.5 rounded-full", DOT_TONE[tone])} />
      ) : null}
      {children}
    </span>
  );
}

/** The quiet form, for lists and tables: an 8px dot and a 13px label. */
export function Status({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 text-[13px] text-ink">
      <span className={cn("size-2 shrink-0 rounded-full", DOT_TONE[tone])} />
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------- table */

export function Table({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left">{children}</table>
    </div>
  );
}

export function Th({
  className,
  numeric,
  ...props
}: React.ThHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return (
    <th
      scope="col"
      className={cn(
        "border-b border-line px-3 py-3 text-[13px] font-normal text-muted first:pl-6 last:pr-6",
        numeric && "text-right",
        className,
      )}
      {...props}
    />
  );
}

export function Tr({
  className,
  ...props
}: React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={cn(
        "border-b border-soft transition-colors duration-150 last:border-0 hover:bg-canvas",
        className,
      )}
      {...props}
    />
  );
}

export function Td({
  className,
  numeric,
  ...props
}: React.TdHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return (
    <td
      className={cn(
        "px-3 py-3.5 text-sm text-ink first:pl-6 last:pr-6",
        numeric && "tabular text-right",
        className,
      )}
      {...props}
    />
  );
}

/** Two-line cell: main value in ink weight 500, muted line underneath. */
export function TwoLine({ value, sub }: { value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="font-medium text-ink">{value}</div>
      {sub ? <div className="mt-0.5 text-xs text-muted">{sub}</div> : null}
    </div>
  );
}

/* ---------------------------------------------------------- key-value list */

export function KeyValue({ children }: { children: React.ReactNode }) {
  return <dl className="divide-y divide-soft">{children}</dl>;
}

export function KeyValueRow({
  label,
  children,
}: {
  label: string;
  children?: React.ReactNode;
}) {
  const empty = children === null || children === undefined || children === "";
  return (
    <div className="flex items-baseline justify-between gap-4 py-3">
      <dt className="text-[13px] text-muted">{label}</dt>
      <dd className="text-right text-[13px] text-ink">
        {empty ? <span className="text-decor">&mdash;</span> : children}
      </dd>
    </div>
  );
}

/* --------------------------------------------------------------- figure row */

export function FigureRow({ children }: { children: React.ReactNode }) {
  return (
    <Card className="grid grid-cols-2 divide-x divide-y divide-line overflow-hidden sm:grid-cols-4 sm:divide-y-0">
      {children}
    </Card>
  );
}

export function Figure({
  label,
  value,
  hint,
  problem = false,
  href,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  problem?: boolean;
  href?: string;
}) {
  const body = (
    <>
      <div className="text-[13px] text-muted">{label}</div>
      <div
        className={cn(
          "tabular mt-1 text-[26px] leading-tight font-semibold tracking-[-0.02em]",
          problem ? "text-danger" : "text-ink",
        )}
      >
        {value}
      </div>
      {hint ? <div className="mt-1 text-[13px] text-muted">{hint}</div> : null}
    </>
  );

  if (href) {
    return (
      <Link
        href={href}
        className="px-6 py-5 transition-colors duration-150 hover:bg-canvas"
      >
        {body}
      </Link>
    );
  }
  return <div className="px-6 py-5">{body}</div>;
}

/* -------------------------------------------------------------------- tabs */

export function Tabs({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-6 flex gap-6 overflow-x-auto border-b border-line">
      {children}
    </div>
  );
}

export function Tab({
  href,
  active,
  count,
  children,
}: {
  href: string;
  active?: boolean;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "-mb-px flex shrink-0 items-center gap-1.5 border-b-2 py-3 text-sm whitespace-nowrap transition-colors duration-150",
        active
          ? "border-ink font-medium text-ink"
          : "border-transparent text-muted hover:text-ink",
      )}
    >
      {children}
      {count !== undefined ? (
        <span className="tabular text-faint">{count}</span>
      ) : null}
    </Link>
  );
}

/* ------------------------------------------------------------------ avatar */

export function Avatar({ name, size = 32 }: { name: string; size?: 24 | 32 }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full bg-soft font-medium text-secondary",
        size === 32 ? "size-8 text-[11px]" : "size-6 text-[10px]",
      )}
    >
      {initials}
    </span>
  );
}

/* ------------------------------------------------------------------ notice */

export function Notice({
  problem = false,
  icon,
  children,
}: {
  problem?: boolean;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-2xl px-4 py-3.5 text-sm",
        problem ? "bg-danger-soft text-danger-strong" : "bg-soft text-ink-hover",
        "[&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:mt-0.5",
      )}
    >
      {icon}
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/* ------------------------------------------------------------- empty state */

export function EmptyState({
  icon,
  title,
  children,
  action,
}: {
  icon?: React.ReactNode;
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      {icon ? (
        <div className="mb-3 text-decor [&_svg]:size-7 [&_svg]:stroke-[1.5]">
          {icon}
        </div>
      ) : null}
      <h3 className="text-[15px] font-medium text-ink">{title}</h3>
      {children ? (
        <p className="mt-1 max-w-[380px] text-[13px] text-muted">{children}</p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

/* -------------------------------------------------------------- list row */

/** A row inside a card that opens something. §9 Cards, §7 Arrows. */
export function RowLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="mx-3 flex items-center justify-between gap-4 rounded-xl px-3 py-3 transition-colors duration-150 hover:bg-canvas"
    >
      <div className="min-w-0">{children}</div>
      <ChevronRight className="size-4 shrink-0 text-decor" />
    </Link>
  );
}
