/**
 * Bar list — DESIGN_LANGUAGE.md §10.
 *
 * One hue: ink bars on soft tracks. Label on the left, up to 144px and
 * truncated; bar 12px tall with a 4px rounded end; the value at the tip in
 * 12px weight 500 tabular figures. The longest bar reaches 85% of the width,
 * so its value always fits. Each row reads as "label, value" to a screen
 * reader; the bars themselves are decoration.
 */
export function BarList({
  items,
  format = (n) => n.toLocaleString("en-IN"),
  empty = "Nothing to show yet.",
}: {
  items: { label: string; value: number }[];
  format?: (n: number) => string;
  empty?: string;
}) {
  if (items.length === 0) {
    return <p className="px-6 pb-5 text-[13px] text-muted">{empty}</p>;
  }
  const max = Math.max(...items.map((i) => i.value), 0);
  return (
    <ul className="flex flex-col gap-3 px-6 pb-5">
      {items.map((item) => {
        const width = max > 0 ? Math.max(0.5, (item.value / max) * 85) : 0;
        return (
          <li key={item.label} className="flex items-center gap-3">
            <span className="w-36 shrink-0 truncate text-[13px] text-secondary" title={item.label}>
              {item.label}
            </span>
            <span className="flex min-w-0 flex-1 items-center gap-2">
              <span
                aria-hidden
                className="h-3 shrink-0 rounded-r bg-ink"
                style={{ width: `${width}%` }}
              />
              <span className="tabular shrink-0 text-xs font-medium text-ink">
                <span className="sr-only">{item.label}: </span>
                {format(item.value)}
              </span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
