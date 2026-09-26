import { Loader2 } from "lucide-react";

/**
 * Shown while a screen's data loads, inside the shell so navigation stays put.
 *
 * §8.8 rules out skeleton shimmer and full-page spinners, so this is one quiet
 * line. It fades in after a short delay: most screens arrive before it would
 * appear, and a flash of "Loading" on every click is worse than nothing.
 */
export default function Loading() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex animate-[fade-in_150ms_var(--ease-standard)_350ms_both] items-center gap-2 py-2 text-[13px] text-muted"
    >
      <Loader2 className="size-4 animate-spin" aria-hidden />
      Loading
    </div>
  );
}
