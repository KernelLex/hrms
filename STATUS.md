# Project status

**Last updated:** 27 Sept 2026 · **Current phase:** 10 done — notifications, background jobs, the change log and CI. Next is phase 11, permissions and approvals.

Updated at the end of every phase. The original build, phases 0 to 9, is in [BUILD_PLAN.md](BUILD_PLAN.md); the extended build, phases 10 to 25, in [build_plan_extended_features.md](build_plan_extended_features.md). What the product does is in [README.md](README.md), what could come next in [ROADMAP.md](ROADMAP.md), and what stands between it and production in [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md).

---

## At a glance

| | |
|---|---|
| Phases complete | 0 to 9 (the original build) and **10** of the extended plan; Part A runs to 24 |
| Blueprint screens built | **38 of 38**, plus 7 added in phase 9 and 6 in phase 10 |
| Database tables | 69 |
| Engines | 4 of 4, plus time evaluation and the job runner |
| Cross-module transactions | 2 of 2 |
| Automated tests | **134 passing**, in 18 files, `npm test` |
| UI audit | **156 of 156** role, screen and width combinations clean, `npm run audit:ui` |
| CI | GitHub Actions on every push: typecheck, lint, tests, build, UI audit |
| Live | https://hrms-amogh24.vercel.app |
| Pending | Cloudflare R2 — not enabled on the account. Documents are stored in the database until it is. |

---

## Infrastructure

| Service | Status | Detail |
|---|---|---|
| GitHub | working | `KernelLex/hrms`, a commit and push per phase; Actions runs CI on every push |
| Turso | working | `hrms-kernellex.aws-us-west-2.turso.io`, migrated to 0007 and seeded |
| Vercel | working | `amogh24/hrms`, deploys on push; Vercel Cron calls `/api/cron/tick` daily |
| Email | **recording only** | No provider connected: emails are written to the outbox and readable there, not sent. Phase 25. |
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

The extended plan, [build_plan_extended_features.md](build_plan_extended_features.md):

| # | Phase | Status |
|---|---|---|
| 10 | Notifications, jobs, the change log and CI | **done** |
| 11 | Permissions and approvals | next |
| 12 | The API and the link to the client's ERP | planned |
| 13 – 24 | Self-service, Core HR, organisation, leave, attendance, statutory payroll, loans and claims, exits, tax, recruitment, talent, analytics | planned |
| 25 | Outside input: the ERP go-live, email delivery, R2, e-signature and the rest | waits on you and the client |

---

## What phase 10 delivered

### Notifications

- **An inbox behind a bell.** The bell sits at the top of the sidebar, and in the phone's top bar, with the unread count as an ink pill. Opening a notification marks it read and goes to what it is about; "Mark all as read" clears the lot.
- **Five notices, to the right person.** A manager hears when someone who reports to them asks for leave; the employee hears when it is decided; everyone paid hears when the month is posted and their payslip is ready (or at once, for an off-cycle run); everyone with a self review due hears when a cycle opens, and weekly after that; and each person hears when calibration makes their rating final.
- **Preferences.** Per kind, in the inbox, by email, both or neither — Notifications → Preferences, linked from My profile.
- **Exactly once.** The notification and its email are written with the change that caused them, keyed by the event and the person, so a retried job or a replayed event tells nobody twice. Tested.
- **An outbox.** Every email is built in the design language, with a plain-text version, queued, and delivered by a job through a pluggable transport. Until a provider is connected the transport records each message instead of sending it, and HR reads it on the **Outbox** screen exactly as it would arrive, in a sandboxed frame.

### Background jobs

- **A job queue in the database**, with no outside service: a dedupe key per piece of work, a conditional claim so two workers never run one job, a stale lock taken over after five minutes, and retries at a growing gap up to an hour before a job is marked failed.
- **Work runs after the response**, eight seconds at a time, and the runner hands off to a fresh invocation of itself with a signed, short-lived request while work remains. A daily Vercel Cron tick queues the scheduled work — weekly self-review reminders, housekeeping — and picks up anything left behind.
- **Payroll runs are jobs.** Starting a run returns at once; the run is calculated a batch at a time on the server and finishes with the tab closed. The run screen only watches, and "Resume run" puts a stalled run back in the queue. The last known gap from phase 9 is closed.

### The change log

- **Every write records who made it and what changed**, field by field, before and after: the time-slice engine, hiring and conversion, leave, attendance, quotas, schedules and holidays, the org structure, payroll periods, payments, runs, bank files, ledger postings and remittances, performance, recruitment, tax, and documents. Nothing is logged for a save that changes nothing; bank account numbers are masked.
- **A change and its entry commit together** wherever the change is a transaction — the time-slice engine, hiring, conversion and leave decisions.
- **In words.** A new salary reads "Basic pay from 1 Apr 2025 — Amount ₹65,000 → ₹72,000"; the record it replaced reads "Basic pay closed".
- **Where to see it.** A **Change log** tab on every employee record, next to the access log, and an organisation-wide **Change log** for HR, filtered by what changed, who changed it and dates in India time.
- Deletions are recorded too, which phase 12's API needs for its deletion feed and retro needs to notice a deleted absence.

### Continuous integration

GitHub Actions runs on every push and pull request: typecheck, lint, the 134 tests, a production build, then the built app is started on a fresh local database and `npm run audit:ui` walks every screen as every role at both widths. Any failure fails the run.

### Fixed on the way

- **A manager could decide anyone's leave, including their own**, by calling the Server Function directly: the screen only listed their reports. HR decides any request; a manager only their own reports; nobody their own.
- **Two approvals at once could both succeed**, and each take the days. A decision is now one transaction: a conditional claim on the request, a conditional quota update that cannot overdraw, the absence, the change-log entries and the notification. Tested, including two requests racing for the same days.
- **The quota engine read, changed and wrote back** the balance; it is a single conditional update now.

### Phase 9, in brief

Role dashboards, the command menu, documents, print, loading and error states, 375px and accessibility, the test runner, pagination, the access log, batched and off-cycle payroll, retro and mid-month joiners, and seven features beyond the plan. The detail is in the git history and in [ROADMAP.md](ROADMAP.md).

---

## Verification

| Check | Result |
|---|---|
| `npm test` | 134 passing: time slices, quotas, payroll, tax, retro, off-cycle, batching, increments, Form 16, time evaluation, storage, exports, search, dashboards, variance, profile, reports, and now notifications, leave decisions, the job queue, background payroll, the change log and its wording |
| Mutation check | Six deliberate bugs in the payroll and tax engines (no marginal relief, ignoring tax already deducted, no retro, ignoring hire dates, spreading bonus tax, paying arrears twice) — each fails at least one test |
| `npm run audit:ui` | 156 of 156 clean, as all three roles at 1280 and 375 pixels, including the inbox, preferences, change logs and outbox |
| `npx tsc --noEmit`, `npm run lint`, `next build` | clean |
| CI | the same checks, on GitHub Actions, on every push |
| Print | Payslip rendered to PDF through Chrome: one A4 page, no shell |

---

## Known gaps worth naming

Honest about what this prototype still does not do. The full list for production is in [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md).

- **Statutory scope is partial.** Provident fund (employee share) and income tax only: no ESI, professional tax, labour welfare fund, gratuity, employer PF or EPS, and no ECR or 24Q files in the government formats.
- **Retro sees additions, not deletions.** A month is recalculated when a record touching it is *created* after it was paid. Deleting an absence from a paid month is not noticed.
- **Retro stops at the financial year.** Arrears for last year's months are not calculated.
- **One-off payments are taxed as salary**, without relief under section 89 for arrears.
- **Employee pickers load everyone.** Forms that choose an employee from a list list them all; fine at hundreds, wrong at thousands.
- **Email is recorded, not sent.** Until a provider is connected (phase 25), notifications reach the inbox and the outbox only.
- **The scheduled tick is daily.** Work queued by a request runs straight away and keeps itself going; only the weekly reminders and the sweep wait for the day's tick. The tick accepts any caller until `CRON_SECRET` is set — harmless, since it only runs work already queued.
- **The change log starts now.** Changes made before phase 10 are not in it; the dated history and `created_by` columns still show them.
- **Local development points at production** unless you set `TURSO_DATABASE_URL=file:.local/dev.db` — there is only one Turso database.

---

## Blockers

**R2 is not enabled** on the Cloudflare account this machine is logged into, so documents are stored in the database for now. To finish it:

1. In the Cloudflare dashboard, on *Thushaarr.bsc23@rvu.edu.in's Account*, open **R2 Object Storage** and enable it (a payment method is asked for even on the free tier).
2. Create the bucket: `npx wrangler r2 bucket create hrms-documents`.
3. In **R2 → Manage API tokens**, create a token with *Object Read & Write* on that bucket. Wrangler cannot mint these.
4. Set `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` and `R2_BUCKET` in `.env.local` and in Vercel, and redeploy. New uploads go to R2; existing ones keep being read from the database.

**Rotate the Turso auth token.** It has been pasted into chat transcripts more than once.

**Everything else that needs you or the client** — the ERP go-live, email delivery, R2, e-signature, devices, scheduling frequency, government format checks and a compliance review — is gathered in phase 25 of [build_plan_extended_features.md](build_plan_extended_features.md).

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
- **Jobs live in the database, not a queue service.** No account or key is needed and it works on any host; a queue service can replace the runner later without changing a caller.
- **A notification is written with its cause.** In the same transaction where there is one, so there is never a notice about a change that did not happen, and keyed per event and person, so there is never a second.
- **The change log keeps only what changed**, with column names as the database has them, and is rendered into sentences at the edge — the same way money is paise until it is displayed.
- **Tests work the job queue themselves.** `kickJobs` does nothing under Vitest; a test calls `processJobs()` when it wants work done, so no background job races it for SQLite's one writer.
