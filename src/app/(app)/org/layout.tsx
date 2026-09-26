import { requirePage } from "@/lib/access";
import { count } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  omCompany,
  omPersonnelArea,
  omPersonnelSubArea,
  omJob,
  omOrgUnit,
  omPosition,
  omReportingLine,
} from "@/db/schema";
import { OrgTabs } from "./tabs";

export default async function OrgLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requirePage(["org.view"], "/");

  const [companies, areas, subAreas, jobs, orgUnits, positions, lines] =
    await Promise.all([
      db.select({ n: count() }).from(omCompany),
      db.select({ n: count() }).from(omPersonnelArea),
      db.select({ n: count() }).from(omPersonnelSubArea),
      db.select({ n: count() }).from(omJob),
      db.select({ n: count() }).from(omOrgUnit),
      db.select({ n: count() }).from(omPosition),
      db.select({ n: count() }).from(omReportingLine),
    ]);

  return (
    <>
      <OrgTabs
        counts={{
          companies: companies[0].n,
          areas: areas[0].n,
          subAreas: subAreas[0].n,
          jobs: jobs[0].n,
          orgUnits: orgUnits[0].n,
          positions: positions[0].n,
          lines: lines[0].n,
        }}
      />
      {children}
    </>
  );
}
