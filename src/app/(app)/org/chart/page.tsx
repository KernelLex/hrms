import { asc } from "drizzle-orm";
import { Building2, Network, User, Waypoints } from "lucide-react";
import { db } from "@/lib/db";
import { omCompany, omOrgUnit, omPosition } from "@/db/schema";
import { Card, CardHeader, PageHeader, EmptyState, Badge } from "@/components/ui";
import { OrgChartSvg } from "./svg-chart";
import { ChartViewToggle } from "./view-toggle";

/**
 * OM-08 — the org chart.
 *
 * Derived entirely from the two self-referencing hierarchies:
 * `om_org_unit.parent_code` for the department tree, and
 * `om_position.reports_to_code` for the reporting line inside each department.
 *
 * A position whose manager sits in a different department is rendered at the
 * top of its own department rather than being hidden — otherwise a cross-team
 * reporting line would make a position disappear from the chart.
 *
 * Two views of the same read: boxes and lines, drawn client-side with pan,
 * zoom, search and collapse; and this indented list, which stays the
 * accessible one — screen readers and keyboard users get a plain nested
 * list rather than an SVG canvas. Both read the same rows, fetched once,
 * here, on the server.
 */

type Unit = typeof omOrgUnit.$inferSelect;
type Position = typeof omPosition.$inferSelect;

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
  const [companies, units, positions] = await Promise.all([
    db.select().from(omCompany).orderBy(asc(omCompany.code)),
    db.select().from(omOrgUnit).orderBy(asc(omOrgUnit.code)),
    db.select().from(omPosition).orderBy(asc(omPosition.code)),
  ]);

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
      <Row key={u.code} depth={depth} icon={<Network />} name={u.name} code={u.code} />,
      ...renderPositions(u.code, depth + 1),
      ...renderUnits(u.code, depth + 1),
    ]);
  }

  const hasAnything = units.length > 0;

  return (
    <>
      <PageHeader
        title="Org chart"
        subtitle="Built by walking the department tree and the reporting line on each position. Read only — change the structure on the other tabs."
      />

      {!hasAnything ? (
        <Card>
          <EmptyState icon={<Waypoints />} title="Nothing to draw yet">
            Add a department and a position, and the chart appears here.
          </EmptyState>
        </Card>
      ) : (
        <ChartViewToggle
          chart={
            <OrgChartSvg
              companies={companies.map((c) => ({ code: c.code, name: c.name }))}
              units={units.map((u) => ({ code: u.code, name: u.name, parentCode: u.parentCode, companyCode: u.companyCode }))}
              positions={positions.map((p) => ({ code: p.code, title: p.title, orgUnitCode: p.orgUnitCode, reportsToCode: p.reportsToCode, isVacant: p.isVacant }))}
            />
          }
          list={
            <div className="flex flex-col gap-6">
              {companies.map((c) => {
                const roots = (childUnits.get(null) ?? []).filter(
                  (u) => u.companyCode === c.code,
                );
                if (roots.length === 0) return null;

                return (
                  <Card key={c.code}>
                    <CardHeader title={c.name} description={c.code} />
                    <div className="px-3 pb-4">
                      {roots.flatMap((u) => [
                        <Row
                          key={u.code}
                          depth={0}
                          icon={<Building2 />}
                          name={u.name}
                          code={u.code}
                        />,
                        ...renderPositions(u.code, 1),
                        ...renderUnits(u.code, 1),
                      ])}
                    </div>
                  </Card>
                );
              })}
            </div>
          }
        />
      )}
    </>
  );
}
