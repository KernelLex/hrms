import { getAccess, can, roleLabel, type Access } from "@/lib/access";
import { navFor } from "@/lib/nav";
import { formatINR, formatLakh } from "@/lib/money";
import { formatDate, formatDateRange, formatMonth, todayInIndia } from "@/lib/dates";
import { formatDays } from "@/lib/engines/quota";
import { financialYearOf } from "@/lib/engines/tax";
import { listDirectReports } from "@/lib/repositories/employees";
import { hrHome, selfHome, teamHome, type SelfHome } from "@/lib/repositories/home";
import { RATING_LABELS } from "@/db/schema";
import { Card, CardHeader, FigureRow, Figure, RowLink } from "@/components/ui";
import {
  AttentionCard,
  ComingUpCard,
  Key,
  plural,
  type AttentionItem,
  type ComingUp,
} from "@/components/home";

/**
 * §8.11 Home: a muted date line, the greeting at 32px, one card of what needs
 * attention, the four figures that matter to this person, then what is coming.
 *
 * Each role opens to a different home, built only from what that person has
 * to decide or act on. A manager is also an employee, so their home carries
 * their own items alongside their team's.
 */

function greeting(name: string): string {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: "Asia/Kolkata" })
      .format(new Date()),
  );
  const part = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  return `${part}, ${name.split(" ")[0]}`;
}

function dateLine(): string {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  }).format(new Date());
}

export default async function HomePage() {
  const session = await getAccess();
  if (!session) return null;

  const today = todayInIndia();

  return (
    <>
      <div className="mb-8">
        <p className="text-[13px] text-muted">{dateLine()}</p>
        <h1 className="mt-1 text-[32px] leading-tight font-semibold tracking-[-0.025em] text-ink">
          {greeting(session.displayName)}
        </h1>
        <p className="mt-1 text-[15px] text-muted">Signed in as {roleLabel(session)}.</p>
      </div>

      {can(session, "employee.view_all") ? (
        <HrHome session={session} today={today} />
      ) : can(session, "employee.view_team") ? (
        <ManagerHome session={session} today={today} />
      ) : session.employeeId ? (
        <EmployeeHome session={session} today={today} />
      ) : (
        <WorkHome session={session} />
      )}
    </>
  );
}

/* ----------------------------------------------------------------- HR */

async function HrHome({ session, today }: { session: Access; today: string }) {
  const [h, self] = await Promise.all([
    hrHome(today),
    session.employeeId ? selfHome(session.employeeId, today) : Promise.resolve(null),
  ]);

  const items: AttentionItem[] = [];

  for (const r of h.overdueRemittances) {
    items.push({
      tone: "problem",
      href: "/payroll/posting",
      children: (
        <>
          <Key>{formatINR(r.amountPaise)} to {r.authority}</Key> was due on{" "}
          {formatDate(r.dueDate)} and is overdue.
        </>
      ),
    });
  }
  if (h.undepositedTdsPaise > 0) {
    items.push({
      tone: "problem",
      href: "/tax/register",
      children: (
        <>
          <Key>{formatINR(h.undepositedTdsPaise)} of tax deducted</Key> is not recorded as
          deposited, across {plural(h.undepositedQuarters, "quarter", "quarters")}.
        </>
      ),
    });
  }
  if (h.latestRun && h.latestRun.errorCount > 0) {
    items.push({
      tone: "problem",
      href: "/payroll/run",
      children: (
        <>
          <Key>{plural(h.latestRun.errorCount, "employee", "employees")}</Key> could not be paid
          in the {formatMonth(h.latestRun.year, h.latestRun.month)} run.
        </>
      ),
    });
  }
  if (h.missingBank.length === 1) {
    items.push({
      tone: "problem",
      href: `/core-hr/${h.missingBank[0].id}/0009`,
      children: (
        <>
          <Key>{h.missingBank[0].name}</Key> has no bank details, so payroll cannot pay them.
        </>
      ),
    });
  } else if (h.missingBank.length > 1) {
    items.push({
      tone: "problem",
      href: "/core-hr",
      children: (
        <>
          <Key>{plural(h.missingBank.length, "employee", "employees")}</Key> have no bank
          details, so payroll cannot pay them.
        </>
      ),
    });
  }
  if (h.pendingLeave > 0) {
    items.push({
      tone: "action",
      href: "/approvals?process=leave",
      children: (
        <>
          <Key>{plural(h.pendingLeave, "leave request", "leave requests")}</Key>{" "}
          {h.pendingLeave === 1 ? "is" : "are"} waiting for a decision.
        </>
      ),
    });
  }
  for (const p of h.unrunPeriods) {
    items.push({
      tone: "action",
      href: p.status === "Locked" ? "/payroll/run" : "/payroll/periods",
      children: (
        <>
          <Key>{formatMonth(p.year, p.month)} payroll</Key> has not been run
          {p.status === "Open" ? ", and the period is still open for changes." : "."}
        </>
      ),
    });
  }
  for (const r of h.dueSoonRemittances) {
    items.push({
      tone: "action",
      href: "/payroll/posting",
      children: (
        <>
          <Key>{formatINR(r.amountPaise)} to {r.authority}</Key> is due on{" "}
          {formatDate(r.dueDate)}.
        </>
      ),
    });
  }
  if (h.offered > 0) {
    items.push({
      tone: "action",
      href: "/recruitment/hire",
      children: (
        <>
          <Key>{plural(h.offered, "offered candidate", "offered candidates")}</Key>{" "}
          {h.offered === 1 ? "is" : "are"} ready to become {h.offered === 1 ? "an employee" : "employees"}.
        </>
      ),
    });
  }
  if (h.openCalibrations > 0) {
    items.push({
      tone: "action",
      href: "/performance/calibration",
      children: (
        <>
          <Key>{plural(h.openCalibrations, "rating", "ratings")}</Key>{" "}
          {h.openCalibrations === 1 ? "is" : "are"} waiting for calibration.
        </>
      ),
    });
  }
  if (h.draftIncrements > 0) {
    items.push({
      tone: "action",
      href: "/performance/increments",
      children: (
        <>
          <Key>{plural(h.draftIncrements, "increment", "increments")}</Key>{" "}
          {h.draftIncrements === 1 ? "is" : "are"} waiting for approval.
        </>
      ),
    });
  }
  if (h.approvedIncrements > 0) {
    items.push({
      tone: "action",
      href: "/performance/increments",
      children: (
        <>
          <Key>{plural(h.approvedIncrements, "approved increment", "approved increments")}</Key>{" "}
          {h.approvedIncrements === 1 ? "has" : "have"} not reached payroll yet.
        </>
      ),
    });
  }
  if (self) items.push(...selfItems(self, today));

  const run = h.latestRun;

  return (
    <>
      <AttentionCard items={items} />

      <div className="mt-6">
        <FigureRow>
          <Figure
            label="Headcount"
            value={h.headcount}
            hint="on the books"
            href="/core-hr"
          />
          <Figure
            label="Vacant positions"
            value={h.vacancies}
            hint={`of ${h.positions} positions`}
            href="/org/positions"
          />
          <Figure
            label="Last payroll"
            value={run ? formatLakh(run.netTotalPaise) : "Not run"}
            hint={
              run
                ? `${formatMonth(run.year, run.month)}, ${plural(run.employeeCount, "person", "people")} paid`
                : "no run yet"
            }
            href="/payroll/run"
          />
          <Figure
            label="Away today"
            value={h.onLeaveToday}
            hint={h.onLeaveToday === 1 ? "person on leave" : "people on leave"}
            href="/time/absences"
          />
        </FigureRow>
      </div>

      <div className="mt-6">
        <ComingUpCard
          today={today}
          description="Holidays, leave, interviews, birthdays and work anniversaries in the next two weeks."
          events={h.upcoming}
        />
      </div>
    </>
  );
}

/* ------------------------------------------------------------ manager */

async function ManagerHome({ session, today }: { session: Access; today: string }) {
  const reports = session.employeeId ? await listDirectReports(session.employeeId, today) : [];
  const [team, self] = await Promise.all([
    teamHome(
      reports.map((r) => r.id),
      today,
    ),
    session.employeeId ? selfHome(session.employeeId, today) : Promise.resolve(null),
  ]);

  const items: AttentionItem[] = [];
  if (team.pendingLeave > 0) {
    items.push({
      tone: "action",
      href: "/approvals?process=leave",
      children: (
        <>
          <Key>{plural(team.pendingLeave, "leave request", "leave requests")}</Key> from your
          team {team.pendingLeave === 1 ? "is" : "are"} waiting for you.
        </>
      ),
    });
  }
  if (team.awaitingRating > 0) {
    items.push({
      tone: "action",
      href: "/performance/ratings",
      children: (
        <>
          <Key>{plural(team.awaitingRating, "appraisal", "appraisals")}</Key>{" "}
          {team.awaitingRating === 1 ? "is" : "are"} waiting for your rating.
        </>
      ),
    });
  }
  if (self) items.push(...selfItems(self, today));

  const twoWeeks = new Date(`${today}T00:00:00Z`);
  twoWeeks.setUTCDate(twoWeeks.getUTCDate() + 13);
  const horizon = twoWeeks.toISOString().slice(0, 10);
  const upcoming: ComingUp[] = mergeEvents(team.upcoming, self?.upcoming ?? []).filter(
    (e) => e.date <= horizon,
  );

  return (
    <>
      <AttentionCard items={items} />

      <div className="mt-6">
        <FigureRow>
          <Figure
            label="Your team"
            value={team.teamSize}
            hint={team.teamSize === 1 ? "direct report" : "direct reports"}
            href="/core-hr"
          />
          <Figure
            label="Waiting on you"
            value={team.pendingLeave + team.awaitingRating}
            hint="requests and ratings"
            href="/approvals?process=leave"
          />
          <Figure
            label="Away this week"
            value={team.awayThisWeek}
            hint="from your team"
            href="/approvals?process=leave"
          />
          <LeaveFigure self={self} />
        </FigureRow>
      </div>

      <div className="mt-6">
        <ComingUpCard
          today={today}
          description="Your team's leave, birthdays and work anniversaries, and holidays, in the next two weeks."
          events={upcoming}
        />
      </div>
    </>
  );
}

/* ----------------------------------------------------------- employee */

async function EmployeeHome({ session, today }: { session: Access; today: string }) {
  const self = session.employeeId ? await selfHome(session.employeeId, today) : null;

  return (
    <>
      <AttentionCard items={self ? selfItems(self, today) : []} />

      <div className="mt-6">
        <FigureRow>
          <LeaveFigure self={self} />
          <Figure
            label="Latest net pay"
            value={self?.latestPayslip ? formatINR(self.latestPayslip.netPaise) : "—"}
            hint={
              self?.latestPayslip
                ? formatMonth(self.latestPayslip.year, self.latestPayslip.month)
                : "no payslip yet"
            }
            href={
              self?.latestPayslip
                ? `/payroll/payslip/${self.latestPayslip.id}`
                : "/payroll/my-payslips"
            }
          />
          <Figure
            label="Awaiting a decision"
            value={self?.pendingRequests ?? 0}
            hint={self?.pendingRequests === 1 ? "leave request" : "leave requests"}
            href="/time/my-leave"
          />
          <Figure
            label="Appraisal"
            value={
              self?.appraisal?.finalRating
                ? `${self.appraisal.finalRating} of 5`
                : appraisalShort(self?.appraisal?.status)
            }
            hint={
              self?.appraisal?.finalRating
                ? RATING_LABELS[self.appraisal.finalRating]
                : appraisalHint(self?.appraisal?.status)
            }
            href="/performance/mine"
          />
        </FigureRow>
      </div>

      <div className="mt-6">
        <ComingUpCard
          today={today}
          description="Holidays and your leave in the next 30 days."
          events={self?.upcoming ?? []}
        />
      </div>
    </>
  );
}

/* ------------------------------------------------------------- shared */

function LeaveFigure({ self }: { self: SelfHome | null }) {
  return (
    <Figure
      label="Annual leave left"
      value={self?.annualLeft !== null && self?.annualLeft !== undefined ? formatDays(self.annualLeft) : "—"}
      hint={
        self?.annualEntitled !== null && self?.annualEntitled !== undefined
          ? `of ${formatDays(self.annualEntitled)} days`
          : "no quota yet"
      }
      href="/time/my-leave"
    />
  );
}

/** Short enough to sit at 26px in half a phone's width. */
function appraisalShort(status: string | undefined): string {
  if (status === "Pending self review") return "Due";
  if (status === "Pending manager review") return "Sent";
  if (status === "Completed") return "Rated";
  return "—";
}

function appraisalHint(status: string | undefined): string {
  if (status === "Pending self review") return "your self review";
  if (status === "Pending manager review") return "with your manager";
  if (status === "Completed") return "awaiting calibration";
  return "no cycle open";
}

/** What an employee has to do or know about, for any role that is one. */
function selfItems(self: SelfHome, today: string): AttentionItem[] {
  const items: AttentionItem[] = [];

  if (self.appraisal?.status === "Pending self review") {
    items.push({
      tone: "action",
      href: "/performance/mine",
      children: (
        <>
          <Key>Your self review</Key> for {self.appraisal.cycleName} is waiting for you.
        </>
      ),
    });
  }
  if (!self.hasDeclaration) {
    items.push({
      tone: "action",
      href: "/tax/declarations",
      children: (
        <>
          <Key>Your tax declaration</Key> for {self.financialYear} has not been made, so tax
          is being deducted under the new regime.
        </>
      ),
    });
  }
  if (self.pendingRequests > 0) {
    items.push({
      tone: "waiting",
      href: "/time/my-leave",
      children: (
        <>
          <Key>{plural(self.pendingRequests, "leave request", "leave requests")}</Key>{" "}
          {self.pendingRequests === 1 ? "is" : "are"} waiting for your manager.
        </>
      ),
    });
  }
  for (const d of self.recentDecisions) {
    items.push({
      tone: d.status === "Approved" ? "done" : "problem",
      href: "/time/my-leave",
      children: (
        <>
          Your leave for {formatDateRange(d.fromDate, d.toDate)} was{" "}
          <Key>{d.status.toLowerCase()}</Key>.
        </>
      ),
    });
  }
  const lastYear = financialYearOf(`${Number(today.slice(0, 4)) - 1}${today.slice(4)}`);
  if (self.form16 && self.form16.financialYear === lastYear) {
    items.push({
      tone: "done",
      href: `/tax/form16/${self.form16.id}`,
      children: (
        <>
          <Key>Your Form 16</Key> for {self.form16.financialYear} is ready.
        </>
      ),
    });
  }
  return items;
}

function mergeEvents(...lists: ComingUp[][]): ComingUp[] {
  const seen = new Set<string>();
  const merged: ComingUp[] = [];
  for (const e of lists.flat()) {
    const key = `${e.date}|${e.title}|${e.detail ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(e);
  }
  return merged.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/* ------------------------------------------------------------ other roles */

/**
 * For a role HR created that has no home of its own, and no employee record
 * behind the sign-in: where their work is.
 */
function WorkHome({ session }: { session: Access }) {
  const groups = navFor(session.permissions);
  return (
    <Card>
      <CardHeader title="Your work" description="The screens your role gives you." />
      <div className="pb-3">
        {groups.flatMap((g) => g.items).map((item) => (
          <RowLink key={item.href} href={item.href}>
            <span className="text-sm font-medium text-ink">{item.label}</span>
          </RowLink>
        ))}
      </div>
    </Card>
  );
}
