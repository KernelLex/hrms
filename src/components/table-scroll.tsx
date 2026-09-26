"use client";

import * as React from "react";

/**
 * The sideways-scrolling wrapper every table sits in (§9 Tables: on small
 * screens the table scrolls rather than wrapping cells).
 *
 * `relative` matters more than it looks: without it, an absolutely positioned
 * child — the `sr-only` label on an actions column — escapes the clip and
 * widens the whole page at 375px.
 *
 * A region that scrolls must be reachable from the keyboard (§13), but making
 * every table a tab stop would add dozens of useless stops on desktop. So it
 * becomes focusable only while it actually overflows.
 */
export function TableScroll({ children }: { children: React.ReactNode }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [overflows, setOverflows] = React.useState(false);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setOverflows(el.scrollWidth > el.clientWidth + 1);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className="relative overflow-x-auto"
      tabIndex={overflows ? 0 : undefined}
      role={overflows ? "region" : undefined}
      aria-label={overflows ? "Table, scrolls sideways" : undefined}
    >
      {children}
    </div>
  );
}
