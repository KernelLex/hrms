/**
 * Walks every screen as each role, at desktop and phone width, and reports
 * what DESIGN_LANGUAGE.md §16 can check mechanically:
 *
 *   - the page does not scroll sideways at 375px (tables may, inside a card);
 *   - axe finds no WCAG 2 A or AA violations;
 *   - the page rendered rather than falling into an error boundary.
 *
 *   npm run audit:ui                     against http://localhost:3000
 *   npm run audit:ui -- --shots out/     also save a screenshot of each
 *   npm run audit:ui -- --only /payroll  only routes starting with a prefix
 *   BASE_URL=https://… npm run audit:ui  against a deployment
 *
 * Drives an installed Chrome or Edge through playwright-core, so no browser
 * download is needed. Signs in through the real sign-in page with the seeded
 * demo accounts, which means the sessions carry real employee links.
 */
import fs from "node:fs";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright-core";
import { AxeBuilder } from "@axe-core/playwright";

const BASE = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const PASSWORD = "demo1234";

const args = process.argv.slice(2);
const shotsDir = flag("--shots");
const only = flag("--only");

function flag(name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

const ROLES = [
  { key: "hr", username: "hr.admin" },
  { key: "manager", username: "ravi.kumar" },
  { key: "employee", username: "arjun.mehta" },
] as const;

/** Static routes. Dynamic ones are discovered from links on list pages. */
const ROUTES = [
  "/", "/me", "/reports", "/time/calendar",
  "/org", "/org/companies", "/org/personnel-areas", "/org/sub-areas", "/org/jobs",
  "/org/departments", "/org/positions", "/org/reporting-lines", "/org/chart",
  "/core-hr", "/core-hr/hire", "/core-hr/mass-update",
  "/time", "/time/absences", "/time/attendances", "/time/quotas", "/time/evaluation",
  "/time/schedules", "/time/holidays", "/time/approvals", "/time/my-leave",
  "/payroll", "/payroll/periods", "/payroll/wage-types", "/payroll/recurring",
  "/payroll/additional", "/payroll/run", "/payroll/posting", "/payroll/my-payslips",
  "/recruitment", "/recruitment/requisitions", "/recruitment/candidates",
  "/recruitment/pipeline", "/recruitment/interviews", "/recruitment/hire",
  "/performance", "/performance/cycles", "/performance/goals", "/performance/ratings",
  "/performance/calibration", "/performance/increments", "/performance/mine",
  "/tax", "/tax/sections", "/tax/declarations", "/tax/register", "/tax/form16",
];

/** List page, and the pattern of the detail links to follow from it. */
const DISCOVER: Array<[string, RegExp]> = [
  ["/core-hr", /^\/core-hr\/\d+$/],
  ["/payroll/my-payslips", /^\/payroll\/payslip\/\d+$/],
  ["/payroll/run", /^\/payroll\/payslip\/\d+$/],
  ["/tax/form16", /^\/tax\/form16\/\d+$/],
];

const WIDTHS = [
  { name: "desktop", width: 1280, height: 900 },
  { name: "phone", width: 375, height: 812 },
] as const;

type Finding = { role: string; route: string; width: string; problem: string };

async function launch(): Promise<Browser> {
  for (const channel of ["chrome", "msedge"]) {
    try {
      return await chromium.launch({ channel });
    } catch {
      // try the next installed browser
    }
  }
  throw new Error("No installed Chrome or Edge was found for playwright-core.");
}

/**
 * Clicks the account on the sign-in page, or falls back to the password form
 * when one-click sign-in is switched off on the target.
 */
async function signIn(page: Page, username: string): Promise<void> {
  await page.goto(`${BASE}/sign-in`);
  const account = page.locator(`button[name="username"][value="${username}"]`);
  const click = (await account.count())
    ? account.click()
    : (async () => {
        await page.fill("#username", username);
        await page.fill("#password", PASSWORD);
        await page.click("button[type=submit]");
      })();
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith("/sign-in"), { timeout: 30_000 }),
    click,
  ]);
}

async function discover(page: Page): Promise<string[]> {
  const found = new Set<string>();
  for (const [list, pattern] of DISCOVER) {
    // A dev server may abort a navigation while it recompiles; a list page
    // that cannot be read just contributes no detail pages.
    const res = await page.goto(`${BASE}${list}`).catch(() => null);
    if (!res || new URL(page.url()).pathname !== list) continue;
    const hrefs = await page.$$eval("a[href]", (as) =>
      as.map((a) => new URL((a as HTMLAnchorElement).href).pathname),
    );
    const first = hrefs.find((h) => pattern.test(h));
    if (first) {
      found.add(first);
      if (first.startsWith("/core-hr/")) {
        found.add(`${first}/as-of`);
        found.add(`${first}/0008`);
        found.add(`${first}/access`);
        found.add(`${first}/documents`);
      }
    }
  }
  return [...found];
}

async function main() {
  const browser = await launch();
  const findings: Finding[] = [];
  let visited = 0;

  if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });

  for (const role of ROLES) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await signIn(page, role.username);

    const routes = [...ROUTES, ...(await discover(page))].filter(
      (r) => !only || r.startsWith(only),
    );

    for (const route of routes) {
      for (const size of WIDTHS) {
        await page.setViewportSize({ width: size.width, height: size.height });
        const res = await page.goto(`${BASE}${route}`, { waitUntil: "networkidle" });
        const landed = new URL(page.url()).pathname;

        // A role without access is redirected away; that is correct, not a finding.
        if (landed !== route) break;
        visited += 1;

        const add = (problem: string) =>
          findings.push({ role: role.key, route, width: size.name, problem });

        if (!res || res.status() >= 400) add(`HTTP ${res?.status() ?? "no response"}`);

        const broken = await page.$("[data-error-boundary]");
        if (broken) add("rendered the error boundary");

        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth,
        );
        if (overflow > 1) add(`page scrolls sideways by ${overflow}px`);

        const axe = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
          .analyze();
        for (const v of axe.violations) {
          const where = v.nodes
            .slice(0, 3)
            .map((n) => n.target.join(" "))
            .join(" | ");
          add(`axe ${v.id} (${v.impact}): ${v.help} — ${where}`);
        }

        if (shotsDir) {
          const file = `${role.key}${route.replace(/\//g, "_") || "_home"}.${size.name}.png`;
          await page.screenshot({ path: path.join(shotsDir, file), fullPage: true });
        }
      }
    }
    await context.close();
  }

  await browser.close();

  console.log(`Visited ${visited} role, route and width combinations.`);
  if (findings.length === 0) {
    console.log("No findings.");
    return;
  }
  // Group identical problems so one component bug does not print fifty times.
  const grouped = new Map<string, Finding[]>();
  for (const f of findings) {
    const list = grouped.get(f.problem) ?? [];
    list.push(f);
    grouped.set(f.problem, list);
  }
  console.log(`${findings.length} findings, ${grouped.size} distinct:\n`);
  for (const [problem, list] of grouped) {
    console.log(`- ${problem}`);
    for (const f of list.slice(0, 6)) console.log(`    ${f.role} ${f.width} ${f.route}`);
    if (list.length > 6) console.log(`    and ${list.length - 6} more`);
  }
  process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
