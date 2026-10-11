import { requirePage } from "@/lib/access";
import { count } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  omCompany,
  omLevelType,
  omJob,
  omJobFamily,
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

  const [companies, levels, jobFamilies, jobs, orgUnits, positions, lines] =
    await Promise.all([
      db.select({ n: count() }).from(omCompany),
      db.select({ n: count() }).from(omLevelType),
      db.select({ n: count() }).from(omJobFamily),
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
          levels: levels[0].n,
          jobFamilies: jobFamilies[0].n,
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
