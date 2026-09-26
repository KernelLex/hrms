# Project status

**Last updated:** 27 Sept 2026 · **Current phase:** 9 of 9 done. The prototype is feature-complete; what stands between it and production is in [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md).

Updated at the end of every milestone. For the plan see [BUILD_PLAN.md](BUILD_PLAN.md); for what the product does see [README.md](README.md); for what could come next see [ROADMAP.md](ROADMAP.md).

---

## At a glance

| | |
|---|---|
| Phases complete | 10 of 10 (phases 0 to 9) |
| Blueprint screens built | **38 of 38**, plus 7 added in phase 9 |
| Database tables | 63 |
| Engines | 4 of 4, plus time evaluation |
| Cross-module transactions | 2 of 2 |
| Automated tests | **103 passing**, in 15 files, `npm test` |
| UI audit | **140 of 140** role, screen and width combinations clean, `npm run audit:ui` |
| Live | https://hrms-amogh24.vercel.app |
| Pending | Cloudflare R2 — not enabled on the account. Documents are stored in the database until it is. |

---

## Infrastructure

| Service | Status | Detail |
|---|---|---|
| GitHub | working | `KernelLex/hrms`, a commit and push per phase |
| Turso | working | `hrms-kernellex.aws-us-west-2.turso.io`, migrated to 0006 and seeded |
| Vercel | working | `amogh24/hrms`, deploys on push |
| Cloudflare R2 | **pending** | Wrangler is logged in on this machine (account `9deedb0a…`, thushaarr.bsc23@rvu.edu.in), but R2 is not enabled on that account either (API error 10042). See [Blockers](#blockers). |

### Demo accounts

The sign-in page lists the three accounts; **one click signs straight in**, no password. The password form is still there, folded under "Sign in with a password", and every account's password is `demo1234`. Set `DEMO_SIGN_IN=off` to turn one-click sign-in off.

| Account | Role | Sees |
|---|---|---|
| Priya Sharma, `hr.admin` | HR administrator | the whole back office, reports and exports |
| Ravi Kumar, `ravi.kumar` | Manager and employee | their team's approvals, ratings and calendar, and their own records |
| Arjun Mehta, `arjun.mehta` | Employee | their own profile, leave, payslips, declaration, Form 16 and appraisal |

---

## Phases

| # | Phase | Status |
|---|---|---|
| 0 | Toolchain and repo | done |
| 1 | Foundation — design system, shell, auth, data layer | done |
| 2 | Org management — OM-01…08 | done |
| 3 | Core HR — CH-01…05, time-slice engine | done |
| 4 | Time and absence — TM-01…05, quota engine | done |
| 5 | Payroll — PY-01…05, payroll and tax engines | done |
| 6 | Recruitment — RC-01…05, hire conversion | done |
| 7 | Performance — PM-01…05, increment push | done |
| 8 | Tax and Form 16 — TDS-01…05 | done |
| 9 | Finish — dashboards, command menu, documents, print, states, 375px, accessibility, tests, and the known gaps | **done**, R2 pending |

---

## What phase 9 delivered

### The finish the plan asked for

- **Role dashboards.** Each role opens to its own home: one card of what needs attention (problems first, in red only when something is actually wrong — overdue remittances, undeposited tax, people payroll cannot pay), the four figures that matter to that person, and what is coming up. Every sentence links to the screen that resolves it.
- **Command menu.** Ctrl K (⌘K on a Mac) from anywhere, or the sidebar's search button. Actions first, then pages, then people once two characters are typed. HR finds anyone; a manager finds their own reports. Arrow keys, Enter and Esc, and the ARIA combobox pattern so a screen reader follows along.
- **Documents.** Resume upload on the candidates screen and employee documents on the employee record, both through one storage module that stores in the database until R2 is configured and in R2 after. Files are recognised by their content, not their name. Downloads check permission and are logged. The bank transfer file downloads as a CSV.
- **Print.** The shell and screen headers stay off paper, A4 margins, ink kept, Form 16 Part B on its own page. The payslip prints on one page; "Print or save as PDF" is the PDF path.
- **Loading, error and not-found states.** A quiet loading line that only appears if a screen is slow, an error screen that says what happened and offers "Try again", and not-found pages inside and outside the shell.
- **375px and accessibility.** An automated audit (`npm run audit:ui`) walks every screen as every role at 1280 and 375 pixels, checking for sideways scrolling and running axe for WCAG 2 A and AA. It started at 96 findings and ends at none. See [Decisions](#decisions-worth-remembering) for what that changed.
- **A real test runner.** Vitest against a fresh SQLite file, migrated and seeded on every run, so tests never touch Turso. The old `/api/health/*` harnesses are gone; their 45 checks are now tests, joined by 58 more.

### The known gaps, closed

| Gap in the phase 8 status | Now |
|---|---|
| No pagination anywhere | Employees, payroll results, bank files, absences, attendance, payments, declarations and candidates page in SQL, 50 rows at a time, with the page in the URL |
| Some lists issue a query per row | Approvals, the bank file, ledger posting, the tax register, time evaluation, quota generation, opening a cycle and generating increments each read in one statement |
| No audit trail on reads | Reads of pay, bank, tax, documents and exports go to an access log. HR sees it on each employee record; employees see who opened their records on their profile |
| Payroll runs synchronously | A run is calculated in batches of 20, each person's result written atomically, and resumes where it stopped if interrupted |
| No off-cycle payroll | Off-cycle runs pay one-off payments owed after the month was run, even after it is posted, with their own payslips, bank file and ledger posting |
| No retroactive runs | A change recorded after a month was paid — a backdated raise, late unpaid leave — is paid or recovered as arrears in the next run, once |
| No mid-period joiners | Joiners and leavers are paid for the working days they were employed; a pay change mid-month pays each rate for its own days |

### Bugs found and fixed along the way

- **Employees could open the employee list, with everyone's salary.** The page had no role check; only the navigation hid it. Now HR sees everyone, a manager sees their direct reports without pay, and an employee is sent home. Hire and mass update are HR-only pages too.
- **TDS over-deducted every month after the first.** It divided the whole year's tax by the months left without subtracting what was already deducted. It now projects the year from what has been paid, subtracts what was deducted, and spreads the rest; tax on a bonus or arrears is taken in the month it is paid.
- **No section 87A marginal relief.** Just over ₹12 lakh under the new regime, tax was ₹63,150 where the law caps it at the income above ₹12 lakh — ₹21,000 for ₹12.21 lakh.
- **The tax register counted unposted months**, and would have counted runs still in progress.
- **The ledger ignored cost centres** the README said it used.
- **A resume link could run script** in HR's browser (`javascript:` URLs). Only web addresses are accepted now.
- **Every text field showed a double focus ring**, because unlayered CSS outranks Tailwind utilities.
- **Dates were ISO strings** (`2026-09-26`) on every screen. They read "26 Sept 2026" now, and "today" is India's date, not UTC's.

### Features added beyond the plan

| Feature | Where |
|---|---|
| My profile — own record, masked bank account, documents, and who has viewed it | `/me` |
| Employee documents — offer letters, identity and address proofs | Employee record, Documents tab |
| Team calendar — who is away, day by day, as the §10 availability grid | `/time/calendar` |
| Payroll variance check — who is new or moved 10% or more since last month, and why | Run payroll |
| CSV exports — employees, payroll runs (a column per wage type), the tax register | Export buttons on each |
| Birthdays and work anniversaries | Home, Coming up |
| HR reports — headcount, cost and leave by department, attrition | `/reports` |
| One-click demo sign-in | Sign-in page |

---

## Verification

| Check | Result |
|---|---|
| `npm test` | 103 passing: time slices, quotas, payroll, tax, retro, off-cycle, batching, increments, Form 16, time evaluation, storage, exports, search, dashboards, variance, profile, reports |
| Mutation check | Six deliberate bugs in the payroll and tax engines (no marginal relief, ignoring tax already deducted, no retro, ignoring hire dates, spreading bonus tax, paying arrears twice) — each fails at least one test |
| `npm run audit:ui` | 140 of 140 clean, as all three roles at 1280 and 375 pixels |
| `npx tsc --noEmit`, `npm run lint`, `next build` | clean |
| Print | Payslip rendered to PDF through Chrome: one A4 page, no shell |

---

## Known gaps worth naming

Honest about what this prototype still does not do. The full list for production is in [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md).

- **Statutory scope is partial.** Provident fund (employee share) and income tax only: no ESI, professional tax, labour welfare fund, gratuity, employer PF or EPS, and no ECR or 24Q files in the government formats.
- **Retro sees additions, not deletions.** A month is recalculated when a record touching it is *created* after it was paid. Deleting an absence from a paid month is not noticed.
- **Retro stops at the financial year.** Arrears for last year's months are not calculated.
- **One-off payments are taxed as salary**, without relief under section 89 for arrears.
- **Employee pickers load everyone.** Forms that choose an employee from a list list them all; fine at hundreds, wrong at thousands.
- **The payroll batches are driven by the browser.** Closing the tab pauses a run until someone presses "Resume run". A queue belongs in production.
- **Local development points at production** unless you set `TURSO_DATABASE_URL=file:.local/dev.db` — there is only one Turso database.

---

## Blockers

**R2 is not enabled** on the Cloudflare account this machine is logged into, so documents are stored in the database for now. To finish it:

1. In the Cloudflare dashboard, on *Thushaarr.bsc23@rvu.edu.in's Account*, open **R2 Object Storage** and enable it (a payment method is asked for even on the free tier).
2. Create the bucket: `npx wrangler r2 bucket create hrms-documents`.
3. In **R2 → Manage API tokens**, create a token with *Object Read & Write* on that bucket. Wrangler cannot mint these.
4. Set `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` and `R2_BUCKET` in `.env.local` and in Vercel, and redeploy. New uploads go to R2; existing ones keep being read from the database.

**Rotate the Turso auth token.** It has been pasted into chat transcripts more than once.

---

## Decisions worth remembering

- **Next.js 16, not 15.** Turbopack is default, `params`/`cookies`/`headers` are async, and middleware is now `proxy.ts`. Error boundaries get `retry()`.
- **`jose` cookie, not Auth.js.** One credentials provider and three fixed roles did not justify the adapter surface.
- **One table per infotype, not a JSON blob.** Payroll needs typed, indexed, foreign-keyed salary values.
- **Money is integer paise; quotas are half-day units.** SQLite has no `DECIMAL`, and `REAL` would drift across a payroll run.
- **The database connects lazily.** Throwing at module scope failed the Vercel build while it collected page data.
- **`readEnv` strips a BOM from every environment variable.** PowerShell prepends one when piping to a native command's stdin.
- **The tax engine landed in phase 5, not 8**, because payroll needed real TDS.
- **The mockups supply features, not appearance.** See BUILD_PLAN §8.
- **Payroll reads everything about a person in one batch and writes in one atomic batch.** Two round trips per employee to Turso, however much history retro and TDS consult.
- **A replaced run's dependents are deleted explicitly**, not left to `ON DELETE CASCADE`: a local SQLite file does not enforce foreign keys unless asked, and the libsql client's connection pool gives no hook to ask.
- **Generated files are rendered, not stored.** The bank file, payslips and Form 16 are drawn from their records each time; posted records do not change, so a stored copy could only agree or be wrong.
- **`text-faint` is not used for text anyone has to read.** DESIGN_LANGUAGE.md allows it for navigation group labels, counts and stage labels, but at 12px it measures 2.6:1 and fails WCAG AA; those now use `text-muted`, which the same document's §13 requires.
- **One-click sign-in is on by default** because the demo password is printed on the page. The Server Function still refuses anything but the three seeded accounts.
