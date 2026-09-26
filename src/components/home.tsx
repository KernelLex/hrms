import * as React from "react";
import Link from "next/link";
import { ChevronRight, CalendarDays } from "lucide-react";
import { Card, CardHeader, EmptyState, type Tone } from "@/components/ui";
import { cn } from "@/lib/utils";

/**
 * The pieces of a home screen — HANDOVER.md §8.11 Home.
 *
 * "Needs attention" is a single card with one sentence per item: a status dot
 * (red for problems), the key noun in ink weight 500, a chevron at the end.
 * Below it the figures that matter to this person, then what is coming up.
 */

export type AttentionItem = {
  tone: Tone;
  href: string;
  /** One sentence. Wrap the key noun in <Key>. */
  children: React.ReactNode;
};

/** The noun a sentence is about, in ink weight 500. */
export function Key({ children }: { children: React.ReactNode }) {
  return <span className="font-medium text-ink">{children}</span>;
}

const DOT: Record<Tone, string> = {
  done: "bg-ink",
  action: "ring-[1.5px] ring-inset ring-ink",
  waiting: "ring-[1.5px] ring-inset ring-ink",
  neutral: "bg-decor",
  problem: "bg-danger-mark",
};

/** Words for the dot, so status never rests on the shape alone (§8.13). */
const TONE_LABEL: Record<Tone, string> = {
  done: "Done",
  action: "Needs action",
  waiting: "Waiting",
  neutral: "For information",
  problem: "Problem",
};

export function AttentionCard({ items }: { items: AttentionItem[] }) {
  // Problems first, then what needs action, then the rest.
  const order: Tone[] = ["problem", "action", "waiting", "done", "neutral"];
  const sorted = [...items].sort((a, b) => order.indexOf(a.tone) - order.indexOf(b.tone));

  return (
    <Card>
      <CardHeader title="Needs attention" />
      <ul className="pb-3">
        {sorted.length === 0 ? (
          <li className="mx-3 flex items-center gap-3 px-3 py-3 text-sm text-secondary">
            <span className={cn("size-2 shrink-0 rounded-full", DOT.done)} aria-hidden />
            Nothing needs your attention.
          </li>
        ) : (
          sorted.map((item, i) => (
            <li key={i}>
              <Link
                href={item.href}
                className="mx-3 flex items-center gap-3 rounded-xl px-3 py-3 transition-colors duration-150 hover:bg-canvas"
              >
                <span
                  className={cn("size-2 shrink-0 rounded-full", DOT[item.tone])}
                  aria-hidden
                />
                <span className="sr-only">{TONE_LABEL[item.tone]}: </span>
                <span className="min-w-0 flex-1 text-sm text-secondary">{item.children}</span>
                <ChevronRight className="size-4 shrink-0 text-decor" aria-hidden />
              </Link>
            </li>
          ))
        )}
      </ul>
    </Card>
  );
}

export type ComingUp = {
  date: string;
  title: string;
  detail?: string;
  href?: string;
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "June", "July", "Aug", "Sept", "Oct", "Nov", "Dec"];

function dayLabel(date: string, today: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const t = new Date(`${today}T00:00:00Z`);
  const diff = Math.round((d.getTime() - t.getTime()) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

export function ComingUpCard({
  events,
  today,
  description,
}: {
  events: ComingUp[];
  today: string;
  description: string;
}) {
  return (
    <Card>
      <CardHeader title="Coming up" description={description} />
      {events.length === 0 ? (
        <EmptyState icon={<CalendarDays />} title="Nothing scheduled">
          Holidays, leave and interviews appear here as they are booked.
        </EmptyState>
      ) : (
        <ul className="pb-3">
          {events.map((e, i) => {
            const body = (
              <>
                <span className="tabular w-24 shrink-0 text-[13px] text-muted">
                  {dayLabel(e.date, today)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink">{e.title}</span>
                  {e.detail ? (
                    <span className="block truncate text-[13px] text-muted">{e.detail}</span>
                  ) : null}
                </span>
              </>
            );
            return (
              <li key={i}>
                {e.href ? (
                  <Link
                    href={e.href}
                    className="mx-3 flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors duration-150 hover:bg-canvas"
                  >
                    {body}
                    <ChevronRight className="size-4 shrink-0 text-decor" aria-hidden />
                  </Link>
                ) : (
                  <div className="mx-3 flex items-center gap-3 px-3 py-2.5">{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/** "1 leave request", "3 leave requests". */
export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}
