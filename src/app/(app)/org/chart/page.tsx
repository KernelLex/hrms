import { asc, eq } from "drizzle-orm";
import { Network, User, Waypoints } from "lucide-react";
import { db } from "@/lib/db";
import { omLevelType, omOrgUnit, omPosition } from "@/db/schema";
import { Card, PageHeader, EmptyState, Badge } from "@/components/ui";
import { OrgChartSvg } from "./svg-chart";
import { ChartViewToggle } from "./view-toggle";

/**
 * OM-08 — the org chart.
 *
 * Derived entirely from the two self-referencing hierarchies:
 * `om_org_unit.parent_code` for the org tree, and
 * `om_position.reports_to_code` for the reporting line inside each unit.
 *
 * One tree covers every level, so this screen never asks what a unit is — it
 * shows each unit's level name beside it and lets the tree speak for itself.
 *
 * A position whose manager sits in a different unit is rendered at the top of
 * its own unit rather than being hidden — otherwise a cross-team reporting
 * line would make a position disappear from the chart.
 *
 * Two views of the same read: boxes and lines, drawn client-side with pan,
 * zoom, search and collapse; and this indented list, which stays the
 * accessible one — screen readers and keyboard users get a plain nested
 * list rather than an SVG canvas. Both read the same rows, fetched once,
 * here, on the server.
 */

type Unit = typeof omOrgUnit.$inferSelect;
type Position = typeof omPosition.$inferSelect;
type Level = typeof omLevelType.$inferSelect;

function Row({
  depth,
  icon,
  name,
  code,
  meta,
  badge,
}: {
  depth: number;
  icon: React.ReactNode;
  name: string;
  code: string;
  meta?: string;
  badge?: React.ReactNode;
}) {
  return (
    <div
      className="flex items-center gap-2.5 rounded-xl py-2 pr-3 transition-colors duration-150 hover:bg-canvas"
      style={{ paddingLeft: `${12 + depth * 22}px` }}
    >
      <span className="shrink-0 text-faint [&_svg]:size-4 [&_svg]:stroke-[1.75]">
        {icon}
      </span>
      <span className="text-sm font-medium text-ink">{name}</span>
      <span className="tabular text-[13px] text-muted">{code}</span>
      {meta ? <span className="text-[13px] text-muted">{meta}</span> : null}
      {badge}
    </div>
  );
}

export default async function OrgChartPage() {
  const [levels, units, positions] = await Promise.all([
    db.select().from(omLevelType).orderBy(asc(omLevelType.rank)),
    db.select().from(omOrgUnit).where(eq(omOrgUnit.isActive, true)).orderBy(asc(omOrgUnit.code)),
    db.select().from(omPosition).orderBy(asc(omPosition.code)),
  ]);
  const level = new Map<string, Level>(levels.map((l) => [l.code, l]));
  const levelOf = (u: Unit) => level.get(u.levelTypeCode);

  const childUnits = new Map<string | null, Unit[]>();
  for (const u of units) {
    const key = u.parentCode ?? null;
    if (!childUnits.has(key)) childUnits.set(key, []);
    childUnits.get(key)!.push(u);
  }

  const unitPositions = new Map<string, Position[]>();
  for (const p of positions) {
    if (!unitPositions.has(p.orgUnitCode)) unitPositions.set(p.orgUnitCode, []);
    unitPositions.get(p.orgUnitCode)!.push(p);
  }

  const positionUnit = new Map(positions.map((p) => [p.code, p.orgUnitCode]));
  const positionTitle = new Map(positions.map((p) => [p.code, p.title]));

  function renderPositions(unitCode: string, depth: number): React.ReactNode[] {
    const inUnit = unitPositions.get(unitCode) ?? [];
    const byManager = new Map<string | null, Position[]>();

    for (const p of inUnit) {
      // Root within this department when the manager is elsewhere or absent.
      const managerInSameUnit =
        p.reportsToCode && positionUnit.get(p.reportsToCode) === unitCode;
      const key = managerInSameUnit ? p.reportsToCode! : null;
      if (!byManager.has(key)) byManager.set(key, []);
      byManager.get(key)!.push(p);
    }

    const walk = (managerCode: string | null, d: number): React.ReactNode[] =>
      (byManager.get(managerCode) ?? []).flatMap((p) => [
        <Row
          key={p.code}
          depth={d}
          icon={<User />}
          name={p.title}
          code={p.code}
          meta={
            managerCode === null && p.reportsToCode
              ? `reports to ${positionTitle.get(p.reportsToCode) ?? p.reportsToCode}`
              : undefined
          }
          badge={
            p.isVacant ? (
              <Badge tone="action">Vacant</Badge>
            ) : null
          }
        />,
        ...walk(p.code, d + 1),
      ]);

    return walk(null, depth);
  }

  function renderUnits(parent: string | null, depth: number): React.ReactNode[] {
    return (childUnits.get(parent) ?? []).flatMap((u) => [
      <Row
        key={u.code}
        depth={depth}
        icon={<Network />}
        name={u.name}
        code={u.code}
        meta={levelOf(u)?.name}
      />,
      ...renderPositions(u.code, depth + 1),
      ...renderUnits(u.code, depth + 1),
    ]);
  }

  const hasAnything = units.length > 0;

  return (
    <>
      <PageHeader
        title="Org chart"
        subtitle="Built by walking the org tree and the reporting line on each position. Read only — change the structure on the other tabs."
      />

      {!hasAnything ? (
        <Card>
          <EmptyState icon={<Waypoints />} title="Nothing to draw yet">
            Add an org unit and a position, and the chart appears here.
          </EmptyState>
        </Card>
      ) : (
        <ChartViewToggle
          chart={
            <OrgChartSvg
              units={units.map((u) => ({
                code: u.code,
                name: u.name,
                parentCode: u.parentCode,
                levelName: levelOf(u)?.name ?? u.levelTypeCode,
                levelRank: levelOf(u)?.rank ?? 0,
              }))}
              positions={positions.map((p) => ({ code: p.code, title: p.title, orgUnitCode: p.orgUnitCode, reportsToCode: p.reportsToCode, isVacant: p.isVacant }))}
            />
          }
          list={
            <Card>
              <div className="px-3 py-4">{renderUnits(null, 0)}</div>
            </Card>
          }
        />
      )}
    </>
  );
}
