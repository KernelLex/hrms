import { cn } from "@/lib/utils";

/**
 * Progress track — DESIGN_LANGUAGE.md §9.
 *
 * Equal segments, 4px tall with pill ends and 6px gaps. Reached segments are
 * ink, unreached are `control`, and a failed one is `danger-mark`. Labels sit
 * beneath: current in ink weight 500, done in secondary, the count in muted
 * (faint fails WCAG AA at 12px), failed in danger.
 *
 * The mockup used four differently coloured pills for the same thing, which
 * carries no meaning in greyscale.
 */
export function StageTrack({
  stages,
  currentIndex,
  failed = false,
  failedLabel = "Rejected",
}: {
  stages: readonly string[];
  currentIndex: number;
  failed?: boolean;
  failedLabel?: string;
}) {
  return (
    <div className="min-w-[220px]">
      <div className="flex gap-1.5">
        {stages.map((stage, i) => {
          const reached = i <= currentIndex;
          return (
            <span
              key={stage}
              className={cn(
                "h-1 flex-1 rounded-full",
                failed && i === currentIndex
                  ? "bg-danger-mark"
                  : reached
                    ? "bg-ink"
                    : "bg-control",
              )}
            />
          );
        })}
      </div>
      <div className="mt-1.5 text-xs">
        {failed ? (
          <span className="font-medium text-danger">{failedLabel}</span>
        ) : (
          <span className="font-medium text-ink">{stages[currentIndex]}</span>
        )}
        <span className="text-muted">
          {" "}
          — {currentIndex + 1} of {stages.length}
        </span>
      </div>
    </div>
  );
}
