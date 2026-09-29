"use client";

import * as React from "react";
import { Minus, Plus, RotateCcw, Search } from "lucide-react";

/**
 * The drawn org chart: boxes and hairlines, laid out from the same two
 * hierarchies the indented list walks — `parent_code` for departments,
 * `reports_to_code` for positions within one. A department whose positions
 * report across department lines still shows those positions where they sit,
 * exactly as the list does.
 *
 * Search, collapse, pan and zoom are state kept only in this component; the
 * data itself is read once, server-side, and handed down as plain props.
 */

export type ChartCompany = { code: string; name: string };
export type ChartUnit = { code: string; name: string; parentCode: string | null; companyCode: string };
export type ChartPosition = {
  code: string;
  title: string;
  orgUnitCode: string;
  reportsToCode: string | null;
  isVacant: boolean;
};

type Node = {
  id: string;
  kind: "company" | "unit" | "position";
  title: string;
  code: string;
  isVacant?: boolean;
  crossReports?: string | null;
  children: Node[];
};

const BOX_W = 176;
const BOX_H = 60;
const H_GAP = 28;
const V_GAP = 56;
const MIN_SCALE = 0.3;
const MAX_SCALE = 2;

function buildTree(companies: ChartCompany[], units: ChartUnit[], positions: ChartPosition[]): Node[] {
  const childUnits = new Map<string | null, ChartUnit[]>();
  for (const u of units) {
    const key = u.parentCode ?? null;
    if (!childUnits.has(key)) childUnits.set(key, []);
    childUnits.get(key)!.push(u);
  }
  const unitPositions = new Map<string, ChartPosition[]>();
  for (const p of positions) {
    if (!unitPositions.has(p.orgUnitCode)) unitPositions.set(p.orgUnitCode, []);
    unitPositions.get(p.orgUnitCode)!.push(p);
  }
  const positionUnit = new Map(positions.map((p) => [p.code, p.orgUnitCode]));
  const positionTitle = new Map(positions.map((p) => [p.code, p.title]));

  function positionNodes(unitCode: string): Node[] {
    const inUnit = unitPositions.get(unitCode) ?? [];
    const byManager = new Map<string | null, ChartPosition[]>();
    for (const p of inUnit) {
      const managerInSameUnit = p.reportsToCode && positionUnit.get(p.reportsToCode) === unitCode;
      const key = managerInSameUnit ? p.reportsToCode! : null;
      if (!byManager.has(key)) byManager.set(key, []);
      byManager.get(key)!.push(p);
    }
    const walk = (managerCode: string | null): Node[] =>
      (byManager.get(managerCode) ?? []).map((p) => ({
        id: `pos:${p.code}`,
        kind: "position" as const,
        title: p.title,
        code: p.code,
        isVacant: p.isVacant,
        crossReports: managerCode === null && p.reportsToCode ? (positionTitle.get(p.reportsToCode) ?? p.reportsToCode) : null,
        children: walk(p.code),
      }));
    return walk(null);
  }

  function unitNodes(parent: string | null): Node[] {
    return (childUnits.get(parent) ?? []).map((u) => ({
      id: `unit:${u.code}`,
      kind: "unit" as const,
      title: u.name,
      code: u.code,
      children: [...positionNodes(u.code), ...unitNodes(u.code)],
    }));
  }

  const companyOf = new Map(units.map((u) => [u.code, u.companyCode]));
  const rootUnits = unitNodes(null);
  return companies
    .map((c) => ({
      id: `co:${c.code}`,
      kind: "company" as const,
      title: c.name,
      code: c.code,
      children: rootUnits.filter((u) => companyOf.get(u.code) === c.code),
    }))
    .filter((c) => c.children.length > 0);
}

type Positioned = { node: Node; x: number; y: number; depth: number };

/** Assigns each visible node an x by its leaves, y by its depth. */
function layout(roots: Node[], collapsed: Set<string>): { positioned: Positioned[]; edges: [Positioned, Positioned][]; width: number } {
  const positioned: Positioned[] = [];
  const edges: [Positioned, Positioned][] = [];
  let nextSlot = 0;

  function place(node: Node, depth: number): { slotX: number; self: Positioned } {
    const isOpen = !collapsed.has(node.id);
    const kids = isOpen ? node.children : [];
    let slotX: number;
    const placedKids: { slotX: number; self: Positioned }[] = [];
    if (kids.length === 0) {
      slotX = nextSlot;
      nextSlot += 1;
    } else {
      for (const k of kids) placedKids.push(place(k, depth + 1));
      slotX = (placedKids[0].slotX + placedKids[placedKids.length - 1].slotX) / 2;
    }
    const self: Positioned = { node, x: slotX * (BOX_W + H_GAP), y: depth * (BOX_H + V_GAP), depth };
    positioned.push(self);
    // Reuse the exact objects already in `positioned`, so an edge always
    // points at the pixel coordinates its box is actually drawn at.
    for (const k of placedKids) edges.push([self, k.self]);
    return { slotX, self };
  }

  // Roots (companies) laid out left to right, each its own little forest.
  for (const r of roots) place(r, 0);

  const width = positioned.length ? Math.max(...positioned.map((p) => p.x)) + BOX_W : BOX_W;
  return { positioned, edges, width };
}

function matches(node: Node, query: string): boolean {
  const q = query.toLowerCase();
  return node.title.toLowerCase().includes(q) || node.code.toLowerCase().includes(q);
}

/** Every node id on the path from a root to this one, roots' ids included. */
function ancestorsOf(roots: Node[], targetId: string): string[] {
  const path: string[] = [];
  function walk(node: Node, trail: string[]): boolean {
    if (node.id === targetId) {
      path.push(...trail);
      return true;
    }
    for (const c of node.children) if (walk(c, [...trail, node.id])) return true;
    return false;
  }
  for (const r of roots) walk(r, []);
  return path;
}

export function OrgChartSvg({ companies, units, positions }: { companies: ChartCompany[]; units: ChartUnit[]; positions: ChartPosition[] }) {
  const tree = React.useMemo(() => buildTree(companies, units, positions), [companies, units, positions]);
  const [collapsed, setCollapsed] = React.useState<Set<string>>(() => new Set());
  const [query, setQuery] = React.useState("");
  const [transform, setTransform] = React.useState({ x: 24, y: 24, scale: 0.85 });
  const svgRef = React.useRef<SVGSVGElement>(null);
  const drag = React.useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);

  const matchIds = React.useMemo(() => {
    if (!query.trim()) return new Set<string>();
    const found = new Set<string>();
    const walk = (n: Node) => {
      if (matches(n, query)) found.add(n.id);
      n.children.forEach(walk);
    };
    tree.forEach(walk);
    return found;
  }, [tree, query]);

  // A match hidden under a collapsed parent is still shown while the search
  // that found it is active — a pure override of what layout sees, not a
  // change to the user's own collapse choices, which reappear exactly as
  // left once the search is cleared.
  const effectiveCollapsed = React.useMemo(() => {
    if (matchIds.size === 0) return collapsed;
    const next = new Set(collapsed);
    for (const id of matchIds) for (const a of ancestorsOf(tree, id)) next.delete(a);
    return next;
  }, [collapsed, matchIds, tree]);

  const { positioned, edges, width } = React.useMemo(() => layout(tree, effectiveCollapsed), [tree, effectiveCollapsed]);

  // Centring reads the DOM (the SVG's current size), which only a search
  // change should trigger, not every pan, zoom or manual collapse toggle.
  React.useEffect(() => {
    if (matchIds.size === 0) return;
    const first = [...matchIds][0];
    const target = positioned.find((p) => p.node.id === first);
    const rect = svgRef.current?.getBoundingClientRect();
    if (target && rect) {
      setTransform((t) => ({
        scale: t.scale,
        x: rect.width / 2 - (target.x + BOX_W / 2) * t.scale,
        y: rect.height / 3 - (target.y + BOX_H / 2) * t.scale,
      }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchIds, tree]);

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const zoomBy = (factor: number, center?: { x: number; y: number }) => {
    setTransform((t) => {
      const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, t.scale * factor));
      if (!center) return { ...t, scale };
      // Keep the point under the cursor fixed while the scale changes.
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return { ...t, scale };
      const cx = center.x - rect.left;
      const cy = center.y - rect.top;
      const ratio = scale / t.scale;
      return { scale, x: cx - (cx - t.x) * ratio, y: cy - (cy - t.y) * ratio };
    });
  };

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1, { x: e.clientX, y: e.clientY });
  };
  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    drag.current = { startX: e.clientX, startY: e.clientY, origX: transform.x, origY: transform.y };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const dx = e.clientX - drag.current.startX;
    const dy = e.clientY - drag.current.startY;
    setTransform((t) => ({ ...t, x: drag.current!.origX + dx, y: drag.current!.origY + dy }));
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a department or position"
            className="h-9 w-full rounded-xl border border-control bg-surface pr-3 pl-9 text-sm text-ink placeholder:text-faint focus:border-ink focus:ring-4 focus:ring-ink/5 focus-visible:outline-none"
          />
        </div>
        {query && matchIds.size > 0 ? <span className="text-[13px] text-muted">{matchIds.size} match{matchIds.size === 1 ? "" : "es"}</span> : null}
        {query && matchIds.size === 0 ? <span className="text-[13px] text-muted">No match</span> : null}
        <div className="ml-auto flex gap-1.5">
          <button type="button" onClick={() => zoomBy(1 / 1.2)} aria-label="Zoom out" className="flex size-8 items-center justify-center rounded-lg border border-control text-secondary transition-colors duration-150 hover:bg-canvas">
            <Minus className="size-4" />
          </button>
          <button type="button" onClick={() => zoomBy(1.2)} aria-label="Zoom in" className="flex size-8 items-center justify-center rounded-lg border border-control text-secondary transition-colors duration-150 hover:bg-canvas">
            <Plus className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => setTransform({ x: 24, y: 24, scale: 0.85 })}
            aria-label="Reset the view"
            className="flex size-8 items-center justify-center rounded-lg border border-control text-secondary transition-colors duration-150 hover:bg-canvas"
          >
            <RotateCcw className="size-4" />
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-line bg-canvas" style={{ height: "min(70vh, 640px)" }}>
        <svg
          ref={svgRef}
          className="size-full touch-none"
          onWheel={onWheel}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
          role="img"
          aria-label="The org structure, drawn as boxes and lines. Use the indented list below for a fully accessible view."
        >
          <g transform={`translate(${transform.x} ${transform.y}) scale(${transform.scale})`}>
            {edges.map(([a, b]) => {
              const midY = a.y + BOX_H + V_GAP / 2;
              const path = `M ${a.x + BOX_W / 2} ${a.y + BOX_H} V ${midY} H ${b.x + BOX_W / 2} V ${b.y}`;
              return <path key={`${a.node.id}-${b.node.id}`} d={path} fill="none" stroke="var(--color-line)" strokeWidth={1} />;
            })}
            {positioned.map((p) => {
              const isCompany = p.node.kind === "company";
              const isUnit = p.node.kind === "unit";
              const hasChildren = p.node.children.length > 0;
              // effectiveCollapsed, not collapsed: a node the search revealed
              // shows "expanded" even though the user's own choice is untouched.
              const isCollapsed = effectiveCollapsed.has(p.node.id);
              const isMatch = matchIds.has(p.node.id);
              return (
                <g key={p.node.id} transform={`translate(${p.x} ${p.y})`}>
                  <title>
                    {p.node.title} ({p.node.code})
                    {p.node.isVacant ? " — vacant" : ""}
                  </title>
                  <rect
                    width={BOX_W}
                    height={BOX_H}
                    rx={12}
                    fill={isCompany ? "var(--color-ink)" : "var(--color-surface)"}
                    stroke={isMatch ? "var(--color-ink)" : "var(--color-line)"}
                    strokeWidth={isMatch ? 2 : 1}
                  />
                  <text x={12} y={isUnit || isCompany ? BOX_H / 2 + 4 : 24} fontSize={13} fontWeight={500} fill={isCompany ? "var(--color-surface)" : "var(--color-ink)"}>
                    {truncate(p.node.title, 20)}
                  </text>
                  {!isCompany && !isUnit ? (
                    <text x={12} y={40} fontSize={11} fill="var(--color-muted)">
                      {p.node.code}
                    </text>
                  ) : null}
                  {p.node.kind === "position" && p.node.isVacant ? (
                    <g transform="translate(12, 44)">
                      <rect width={52} height={16} rx={8} fill="var(--color-surface)" stroke="var(--color-ink)" strokeWidth={1} />
                      <text x={26} y={11.5} fontSize={10} fontWeight={500} textAnchor="middle" fill="var(--color-ink)">
                        Vacant
                      </text>
                    </g>
                  ) : null}
                  {p.node.crossReports ? (
                    <text x={12} y={53} fontSize={9.5} fill="var(--color-faint)">
                      reports to {truncate(p.node.crossReports, 18)}
                    </text>
                  ) : null}
                  {hasChildren ? (
                    <g transform={`translate(${BOX_W - 20}, 8)`} style={{ cursor: "pointer" }} onClick={() => toggle(p.node.id)}>
                      <circle r={9} cx={0} cy={0} fill={isCompany ? "var(--color-surface)" : "var(--color-canvas)"} stroke="var(--color-line)" strokeWidth={1} />
                      <text x={0} y={3.5} fontSize={12} textAnchor="middle" fill="var(--color-ink)" style={{ userSelect: "none" }}>
                        {isCollapsed ? "+" : "−"}
                      </text>
                    </g>
                  ) : null}
                </g>
              );
            })}
          </g>
        </svg>
      </div>
      <p className="text-[13px] text-muted">
        Drag to pan, scroll or pinch to zoom, and click the circle on a box to collapse what is under it. Width {Math.round(width)}px of structure, {positioned.length} boxes shown.
      </p>
    </div>
  );
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
