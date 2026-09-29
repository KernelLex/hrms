"use client";

import * as React from "react";
import { List, Waypoints } from "lucide-react";

/**
 * Switches between the drawn chart and the indented list, both already
 * rendered — this only ever shows or hides one, so the accessible list is
 * never re-fetched or re-built to appear.
 */
export function ChartViewToggle({ chart, list }: { chart: React.ReactNode; list: React.ReactNode }) {
  const [view, setView] = React.useState<"chart" | "list">("chart");

  return (
    <div>
      <div role="tablist" aria-label="How to show the org chart" className="mb-4 inline-flex gap-1 rounded-xl bg-canvas p-1">
        {(
          [
            { key: "chart", label: "Chart", icon: <Waypoints className="size-4" /> },
            { key: "list", label: "List", icon: <List className="size-4" /> },
          ] as const
        ).map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={view === t.key}
            onClick={() => setView(t.key)}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors duration-150 ${
              view === t.key ? "bg-surface text-ink shadow-sm" : "text-secondary hover:text-ink"
            }`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>
      <div hidden={view !== "chart"}>{chart}</div>
      <div hidden={view !== "list"}>{list}</div>
    </div>
  );
}
