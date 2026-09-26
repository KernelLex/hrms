import { count, eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { omCompany, omOrgUnit, omPosition, omJob } from "@/db/schema";
import { roleLabel } from "@/lib/nav";
import { Card, CardHeader, FigureRow, Figure, Notice, RowLink } from "@/components/ui";

/**
 * §11 Home: a muted date line, then the greeting at 32px, then the figures
 * that matter to this person.
 *
 * Each role opens to a different home. For now only the HR administrator has
 * real figures to show — the others arrive with their modules in later phases.
 */

function greeting(name: string): string {
  const hour = new Date().getHours();
  const part = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  return `${part}, ${name.split(" ")[0]}`;
}

function dateLine(): string {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date());
}

export default async function HomePage() {
  const session = await getSession();
  if (!session) return null;

  const isHr = session.roles.includes("HR_ADMIN");

  const [companies, orgUnits, positions, jobs, vacancies] = isHr
    ? await Promise.all([
        db.select({ n: count() }).from(omCompany),
        db.select({ n: count() }).from(omOrgUnit),
        db.select({ n: count() }).from(omPosition),
        db.select({ n: count() }).from(omJob),
        db.select({ n: count() }).from(omPosition).where(eq(omPosition.isVacant, true)),
      ])
    : [];

  return (
    <>
      <div className="mb-8">
        <p className="text-[13px] text-muted">{dateLine()}</p>
        <h1 className="mt-1 text-[32px] leading-tight font-semibold tracking-[-0.025em] text-ink">
          {greeting(session.displayName)}
        </h1>
        <p className="mt-1 text-[15px] text-muted">
          Signed in as {roleLabel(session.roles)}.
        </p>
      </div>

      {isHr ? (
        <>
          <FigureRow>
            <Figure label="Companies" value={companies![0].n} href="/org" />
            <Figure label="Departments" value={orgUnits![0].n} href="/org" />
            <Figure label="Positions" value={positions![0].n} href="/org" />
            <Figure
              label="Vacant positions"
              value={vacancies![0].n}
              hint={`of ${positions![0].n} total`}
              href="/org"
            />
          </FigureRow>

          <div className="mt-6">
            <Card>
              <CardHeader
                title="Where to start"
                description="Org management comes first, because every other module points at it."
              />
              <div className="pb-3">
                <RowLink href="/org">
                  <div className="text-sm font-medium text-ink">
                    Build the org structure
                  </div>
                  <div className="mt-0.5 text-[13px] text-muted">
                    {jobs![0].n} jobs and {positions![0].n} positions defined so far
                  </div>
                </RowLink>
              </div>
            </Card>
          </div>
        </>
      ) : (
        <Notice>
          Your home screen arrives with the time and payroll modules. For now,
          use the navigation to look around.
        </Notice>
      )}
    </>
  );
}
