# HRMS — handover

**Last updated:** 7 Oct 2026 · **Current phase:** 24 of 25 done, plus the first round of client feedback on the prototype (§11). All of Part A is done; what is left is phase 25, which waits on the client and on outside services — and the client's own open decisions, now listed in README's "What we need from you".

**Live:** https://hrms-amogh24.vercel.app · **Repository:** `github.com/KernelLex/hrms` (branch `main`) · **Continuous integration:** GitHub Actions on every push

This is the one document for this project. It says what the software is, how it is built, what it looks like, where it stands, what is left, and what stands between it and production. A developer who reads it should be able to work on any part of the system without first reading the code or anything else.

---

## Contents

1. [How to use this document](#1-how-to-use-this-document)
2. [What this is](#2-what-this-is)
3. [Where it stands](#3-where-it-stands)
4. [Getting started](#4-getting-started)
5. [How it is built](#5-how-it-is-built)
6. [Screens and who sees them](#6-screens-and-who-sees-them)
7. [Conventions, gotchas and decisions](#7-conventions-gotchas-and-decisions)
8. [Design language](#8-design-language)
9. [What is left](#9-what-is-left)
10. [Production readiness](#10-production-readiness)
11. [History](#11-history)

---

## 1. How to use this document

- **It replaces every other document** the project had: the product README, the status report, the build plan, the roadmap, the production-readiness list, the design language and the plan for phases 10 to 25. Their content is all here. `AGENTS.md` / `CLAUDE.md` are instructions for coding assistants, not project documentation.
- **`README.md` is for the client**, not developers: the software's features in plain language, how to try it, a short "Coming next" list, and what it does not cover yet. Update it in the same commit whenever a phase adds or changes a feature, moving shipped items out of "Coming next". No dates or phase numbers in it.
- **`API.md` is the one other document**, and it has a different reader: the developers of a system that connects to the HRMS, starting with the client's ERP. It is the guide to the API; its reference section is generated from the code, and a test fails when it falls behind (§7.1).
- **Section references** in code comments point here. `HANDOVER.md §8.9` means section 8.9, the design language's components. The original blueprint and HTML mockups in `HR MODULE/` are kept as reference for features, not for appearance (see §6.3).
- **Keep it current as part of the work, not after it.** At the end of every phase, in the same commit:
  - rewrite §3 (where it stands) — the date, the figures, the phase table, the known gaps;
  - move the finished phase from §9 into §11 (history), noting where the build differed from the plan;
  - update §4 to §8 wherever the phase changed setup, architecture, screens, conventions or design;
  - update §10 — close what the phase closed, add what it revealed.
  - update `README.md` with any feature the phase added or changed, in the client's language.
- **Collaborating.** Propose a change to the plan by editing §9 in a pull request; record a decision in §7.3 with the reason; record anything that needs someone outside the team in phase 25 (§9.6). No timelines or effort estimates: this document says what and why, not how long.
- **Commits** are made as `tfthushaar`, and carry no co-author or tool attribution lines.

---

## 2. What this is

The HR module of an ERP. It holds the organisation's structure, the people in it, and the four things a company has to get right every month: pay them, track their time, hire their replacements, and account for their tax. It is modelled on how SAP HCM organises the same problem, and built to be operated by people who have never used SAP.

It is a **module of the ERP the client is building in-house**. The two systems will exchange data in both directions through an API (phase 12 onwards, §9.2): this module sends people, organisation, time, payroll and the payroll journal; the ERP sends back what it owns — accounts, cost centres, payment confirmations, earnings and deductions that start on its side. There are no connectors to third-party ERPs; the client's ERP is the only one.

It is a **working prototype** of an Indian company's HR back office — Indian payroll, Indian income tax, rupees, Indian dates — deployed and usable, with a demo organisation (Acme Manufacturing) seeded.

### 2.1 Who uses it

- **HR administrators** run the back office: build the org structure, hire and transfer people, maintain employee records, run payroll, produce statutory returns, and decide who can do what.
- **Managers** approve their team's leave, rate their team's performance, and recommend increments.
- **Employees** see what the company holds about them, apply for leave, watch their balances, read their payslips, declare their tax investments and download their Form 16.
- **Roles HR creates** — a recruiter who sees candidates but no pay, an auditor who reads but cannot change. Roles are sets of permissions (§5.6), so each gets exactly the screens its permissions allow.

Each role opens to its own home screen, showing only what that person has to decide or act on: one card of what needs attention, the four figures that matter to them, and what is coming up.

### 2.2 What it covers

**Org management.** Companies, personnel areas and sub-areas, jobs, departments and positions, each with validity dates, so the structure has a history. Positions carry reporting lines, so the org chart is derived from data, not drawn.

**Core HR.** Every fact about a person is a dated record (an *infotype*, in SAP's word), not a field that gets overwritten. Employees ask for corrections to their own record, which HR approves — a bank change with proof and a second approver — and the change is written from the day it applies. Change someone's salary and the old figure is closed off, not destroyed, so you can ask what anyone's pay, position or address was on any past date. Hiring is a guided action: the records are created together or not at all. HR files each person's documents on their record. Every read of pay, bank, tax and documents is logged, and every change is logged with its value before and after.

**Time and absence.** Leave types, annual entitlements, and requests that go through a configurable approval flow — by default the employee's reporting manager; longer leave can add HR. The balance moves on approval, and unpaid leave reaches payroll as a deduction. Attendance, overtime, work schedules, public holidays and a team calendar sit alongside.

**Payroll.** A period opens, locks for processing and is posted. The run works gross to net — basic pay for the days each person was employed, allowances, recurring and one-off payments, unpaid-leave proration, arrears, provident fund and tax — and produces a payslip that itemises every line with the year to date, on screen and as a PDF, emailed to each person password-protected when the month is posted. It handles joiners, leavers and mid-month raises by the day; pays arrears once when a paid month's inputs change; spreads tax across the year; runs off-cycle payments; and flags everyone new or whose pay moved 10% before posting. Runs are background jobs, so they finish with the screen closed. Downstream: the bank transfer file, the ledger journal by cost centre, and the statutory remittances.

**Recruitment.** A requisition opens hiring for a vacant position and describes the role — title, description, qualifications, skills, experience, type, place, a budget HR alone sees, and the hiring manager. Published, it appears on a public **careers site** where candidates apply with their resume, no account needed; duplicates are caught by email or phone. Each application is **screened** — the profile rejected, or taken to interview — then goes through as many **interview rounds** as it needs, each with its own interviewer, date, time, place and notes, until the candidate is **approved or rejected**. Interviewers are told when they are asked, see their rounds under My interviews, record their own notes against the role's own **scorecard** where it has one, and can download a calendar invite for the round; the candidate gets a confirmation email. An approved candidate is made a formal **offer** — a CTC breakdown, a joining date and an expiry, built into a letter — sent to a link only they have; accepting or declining there records the time and converts them into an employee through the same hiring action Core HR uses, with nothing retyped. Any employee can **refer** someone for an open role, earning a bonus once the hire is still with us after a qualifying period. **Analytics** show time to hire, time in each stage, source effectiveness, offer acceptance and drop-off by stage.

**Performance and increments.** An annual cycle: goals, self and manager ratings, calibration, and increments that become the next basic-pay record payroll reads.

**Tax and Form 16.** Declarations under both regimes, the quarterly register of tax deducted and deposited, and both parts of Form 16, which reconcile against each other. Section 87A includes the new regime's marginal relief.

**Reports.** Headcount, payroll cost and leave by department, attrition, and CSV exports.

**On phones.** Every screen works at phone width, and the app installs to a phone's home screen; it keeps only its own code on the device, never anyone's data.

**Platform.** Notifications in an inbox and by email (recorded in an outbox until a provider is connected), background jobs, a change log of every write, permissions and roles HR edits, and an approval engine with delegation and escalation.

**Integration.** A versioned REST API (`/api/v1`) through which the client's ERP, and any other system HR connects, reads people, organisation, time and payroll; writes what it owns; hears about every change through signed webhooks or a pull feed; and reports back what it booked and paid. HR manages connected systems, record ownership, sync issues and a reconciliation of every journal on the Integrations screens.

### 2.3 How the modules connect

The value is in the seams:

- A hire in **recruitment** creates the employee in **core HR**.
- An approved unpaid leave in **time** becomes a deduction in **payroll**.
- An approved increment in **performance** becomes the basic pay **payroll** reads next month.
- Tax deducted by **payroll** becomes the register that **Form 16** is built from.
- Payroll results post to the **finance** ledger by the cost centre on each employee's org assignment, and go to the **client's ERP**, which books the journal, pays the salaries and says so (§9.2).
- Every change, in any module, becomes an **event** the ERP can receive (§9.3).

---

## 3. Where it stands

### 3.1 At a glance

| | |
|---|---|
| Phases complete | 0 to 9 (the original build), 10 to 24 of the extended plan — all of Part A. Part B is 25. |
| Screens | 38 of 38 from the blueprint, plus 7 added in phase 9, 6 in phase 10, 6 in phase 11, and 16 in phase 12: six Integrations screens, the public API reference and error pages, and eight for the recruitment workflow, including the public careers site; phase 13 added the corrections inbox, request forms and an offline page; phase 14 added 6: the Career tab, transfer and promotion wizards, My tasks, Probation due and Letter templates; phase 15 added 4: headcount requests, and the import wizard's upload, report and list screens — plus the org chart redrawn as boxes and lines, with the indented list kept beside it as the accessible view; phase 16 added Holiday calendars and Leave policies; phase 17 added 6: Shifts, Roster patterns (with each pattern's own day-grid detail), Roster, Today's board, Devices and My attendance; phase 18 added 5: Salary structures (with each structure's own components detail), Statutory rates, GL mapping, a CTC tab and a Statutory details tab on the employee record; phase 19 added 6: Loans and claims administration (with claim categories and the benchmark rate), claim approval with bills side by side, My loans and My claims; phase 20 added 3: the exit board, Resign, and the settlement statement; phase 21 added a Proof verification tab, and extended the declaration (rent, proof filing, the regime comparison) and Form 16 (12BA, Section 89 relief) screens rather than adding new ones; phase 22 added 3: Recruitment analytics, "Refer someone" and the candidate's own public offer page, and extended the interview round (scorecards, a calendar-invite link) and application (the offer form, its real status) screens; phase 23 added 7: 360 feedback, Improvement plans, and five Training screens (catalogue, nominations, budgets, compliance, my training), and extended My appraisal with check-ins and feedback replies; phase 24 added no new screen, extending Reports with the trend, leave liability and "Schedule this report" |
| Database tables | 160, in 26 migrations (0000 to 0025) |
| Engines | Time-slice, quota, leave policy, payroll, tax, time evaluation, attendance, statutory, loans, exits; plus the job runner, the approval engine and the import engine |
| Permissions | 37, in ten groups; 3 built-in roles, and Recruiter and Finance as examples of roles HR can create |
| Integration API | 75 endpoints under `/api/v1`, 40 event types, 18 scopes. The guide for integrators is `API.md`; the live reference is `/developers`. |
| Automated tests | **405** in 43 files (`npm test`), including an authorisation matrix over every Server Function and route, contract tests over every API endpoint, and the mock ERP's whole scenario — a couple of timing-sensitive ones (job retry backoff, a rate-limit window) occasionally flake under full-suite load and pass alone; none of them are recruitment's, performance's or analytics' |
| UI audit | **Clean** (`npm run audit:ui`): every screen, as four people at 1280 and 375 pixels |
| CI | Typecheck, lint, tests, production build, UI audit and the mock ERP over HTTP on every push |
| Pending on others | Cloudflare R2 (not enabled on the account), email delivery (no provider chosen), and the rest of phase 25 |

### 3.2 Phases

| # | Phase | Status |
|---|---|---|
| 0 | Toolchain and repository | done |
| 1 | Foundation: design system, shell, auth, data layer | done |
| 2 | Org management (OM-01…08) | done |
| 3 | Core HR (CH-01…05), time-slice engine | done |
| 4 | Time and absence (TM-01…05), quota engine | done |
| 5 | Payroll (PY-01…05), payroll and tax engines | done |
| 6 | Recruitment (RC-01…05), hire conversion | done |
| 7 | Performance (PM-01…05), increment push | done |
| 8 | Tax and Form 16 (TDS-01…05) | done |
| 9 | Finish: dashboards, command menu, documents, print, states, phones, accessibility, tests, known gaps | done (R2 pending) |
| 10 | Notifications, background jobs, the change log and CI | done |
| 11 | Permissions and approvals | done |
| 12 | Integration API and the two-way ERP link, with the recruitment workflow reworked | done |
| 13 | Self-service and payslips | done |
| 14 | Joining, moving and letters | done |
| 15 | Org and data tools | done |
| 16 | Leave policies | done |
| 17 | Attendance and shifts | done |
| 18 | Salary structures and statutory payroll | done |
| 19 | Loans and reimbursements | done |
| 20 | Exit and full and final settlement | done |
| 21 | Tax completeness | done |
| 22 | Recruitment | done |
| 23 | Performance and learning | done |
| 24 | Analytics | done |
| 25 | Outside input: the ERP go-live, email, R2, e-signature and the rest | **next** — waits on you and the client (§9.6) |

### 3.3 Infrastructure

| Service | Status | Detail |
|---|---|---|
| GitHub | working | `KernelLex/hrms`; Actions runs CI on every push and pull request |
| Turso | working, prototype only | `hrms-kernellex.aws-us-west-2.turso.io`, migrated to 0025 and seeded. **The production database is MySQL** — Turso is the prototype's convenience, and the move happens once the prototype phase is signed off (§9.6). One database: production and the demo are the same (§10). |
| Vercel | working | Project `amogh24/hrms`; deploys `main` on push; Vercel Cron calls `/api/cron/tick` daily |
| Email | recording only | No provider connected: every email is written to the outbox and readable on the Outbox screen, not sent |
| Cloudflare R2 | pending | Not enabled on the Cloudflare account (API error 10042). Documents are stored in the database until it is (§5.8). |

### 3.4 Demo accounts

The sign-in page lists five accounts; **one click signs straight in**. The password form is folded under "Sign in with a password"; every password is `demo1234`. Set `DEMO_SIGN_IN=off` to remove one-click sign-in.

| Account | Role | Sees |
|---|---|---|
| Priya Sharma, `hr.admin` | HR administrator | The whole back office, reports, exports, roles and approval flows |
| Ravi Kumar, `ravi.kumar` | Manager and employee | Their team's approvals, ratings and calendar, their own records, and the interviews they are asked to take |
| Arjun Mehta, `arjun.mehta` | Employee | Their own profile, leave, payslips, declaration, Form 16 and appraisal, a culture round to take under Interviews to take, an address change waiting for HR, and 5% voluntary PF on his statutory details |
| Neha Iyer, `neha.iyer` | Recruiter (a role HR created) | Requisitions, applications, interviews and candidates — and no pay anywhere |
| Deepa Rao, `deepa.rao` | Finance (a role HR created) | Payroll, statutory rates, tax, reports and the outbox — and no employee records, no roles |

The careers site, `/careers`, needs no account: the demo's HR executive role is published there. The API reference at `/developers` is public too.

### 3.5 Verification

| Check | Result |
|---|---|
| `npm test` | 405: the seed re-run twice on an already-seeded database, checked for duplicates, corrections (dated writes, two approvers, refusals, the API), payslips (year to date against the year's payslips, one protected email per person, resend, downloads), the installable app, time slices, quotas, leave policies and their ledger, compensatory off, leave encashment, shifts, rosters, attendance finalisation and regularisation, payroll, statutory PF/ESI/professional tax/LWF (including ESI's contribution-period continuation and Maharashtra's February rule), employer contributions reaching the ledger and never net pay, cost-centre splits, the CTC breakdown against a hand calculation, the ECR file's field format, tax, retro, off-cycle, batching, increments, Form 16, time evaluation, storage, exports, search, dashboards, variance, profile, reports, notifications, jobs, the change log, permissions, approvals, the recruitment workflow and careers page, onboarding checklists and tasks, transfers and promotions through the time-slice engine, probation confirm/extend/end, letters (merge, PDF, immutability), headcount requests through their approval to a vacant position recruitment can hire against, bulk import (dry run, confirm, batching 5,000 employees, re-importing a file writing nothing twice), opening balances reducing a projected month's TDS, an EMI schedule closing at zero with the last instalment absorbing rounding, a prepayment rescheduling the remainder at the same EMI, the concessional-loan perquisite value, a claim refused over its category's limit and paid once approved — on screen or sent in already approved by the API, gratuity under the 240-day rule, a full and final settlement paying salary to the last day, leave, a notice shortfall, gratuity and a loan together in one off-cycle run, sign-in disabled on the last day, the HRA three-way minimum for metro and non-metro, a regime comparison matching `annualTaxFor`'s own computation, section 89 relief as Form 10E works it out, the 24Q file's field order, a proof window capping an unverified amount to what was actually verified, a scorecard required before a round's notes are saved, an offer accepted through its link converting to an employee with its onboarding tasks, a referral bonus paid once after its qualifying period and forfeited if the hire does not stay, duplicate candidates caught by phone, recruitment analytics against hand counts, a goal check-in from either side and its weekly reminder, peer feedback hidden until three have answered, an improvement plan opened, checked in on and closed, a nomination refused once it would take a department over its training budget for the year, a certification's expiry warning sent once to its holder and manager, the headcount trend against an independent as-of count, leave liability against a hand calculation composed from the same primitives encashment itself uses, and a scheduled report landing with the right attachment, the API (every endpoint against its schema, tokens, scopes, address and rate limits, company limits, idempotency, errors, the OpenAPI document, the guided-actions endpoint and its events, imports needing the scope that matches what is being imported), the mock ERP's scenario in-process with webhook retries, parking and replay, signatures, pay never shown without its scope, and the authorisation matrix |
| Mutation checks | Six deliberate bugs in the payroll and tax engines each fail a test; the outbox regression test fails on the old per-minute delivery key; the authorisation matrix fails when one Server Function's check is loosened; removing ESI's contribution-period continuation check fails the statutory engine's own test |
| `npm run audit:ui` | clean: every screen as HR, manager, employee and recruiter at 1280 and 375 pixels, the careers site and the API error page, with axe (WCAG 2 A and AA) and a sideways-scroll check |
| `npm run sandbox` | The mock ERP's 21 steps against a running app over HTTP, receiving real signed webhooks: 21 of 21 |
| `API.md` | Its reference is generated from the endpoint definitions; a test fails when it is stale |
| `npx tsc --noEmit`, `npm run lint`, `next build` | clean |
| CI | all of the above on GitHub Actions, on every push |

### 3.6 Known gaps

Honest about what the software does not do yet. What production needs is in §10.

- **There is no screen for creating users.** The seed makes the demo accounts, and HR gives out roles on the Roles screen; nobody can be *created* through the UI. Deliberately left: the client's own feedback says user management should be the ERP's or shared with it, and building a second place to create people before single sign-on is decided would be the wrong thing to own (§9.6).
- **One organisation, one address.** Companies, personnel areas and departments live inside one deployment and one database. A company's own hostname (`company1.hr.example`) with its own data is not built, and is an architectural decision rather than a setting (§9.6).
- **Statutory bonus is not calculated.** Provident fund (including the employer's share and voluntary contributions), ESI, professional tax, the labour welfare fund, gratuity and income tax are; the Payment of Bonus Act is not.
- **Retro sees additions, not deletions,** and stops at the financial year. The change log now records deletions, which phase 21 uses.
- **Employee pickers load everyone.** Fine at hundreds, wrong at thousands.
- **Scope on screens covers employee records only.** A role limited to some companies sees only their people on the employee list, record, search, documents and export; payroll, time, tax and performance screens are organisation-wide for anyone holding their permission. API clients, by contrast, are held to their companies on every resource.
- **The service layer holds what the API writes** — hiring, employee fields, absences, one-off and recurring payments, remittance payments, cost centres, accounts, acknowledgements and payment confirmations. Other Server Functions keep their logic until their module is next worked on.
- **Ownership is enforced in the API, not yet on HR's screens.** A field HR hands to the ERP is refused to the HRMS through the API's rules, but HR's own forms do not yet show it read-only as "Managed in the ERP".
- **Webhook retries wait for work.** A delivery that failed is retried when the next request runs the queue, or at the daily tick; on a plan with a frequent tick it is on the minute (§10).
- **Payslip emails wait in the outbox** like every email until a provider is connected; the Outbox screen opens each one's PDF as it would be sent. The PDF's password is the first four letters of the first name and the day and month of birth, because PANs are not held (phase 21).
- **Only payslips are PDFs.** Form 16 and letters still print from the browser (phases 14 and 21).
- **A resume is stored, not read.** A candidate types their own name, phone and details; nothing is extracted from the document.
- **Interview slots are not proposed to the candidate.** HR schedules a fixed time directly; the invite is attached to the candidate's confirmation email and downloadable by the interviewer. Letting the candidate pick from several offered times is not built. The careers site is protected by a hidden field and a daily limit per address until Turnstile (phase 25).
- **Only leave uses the approval engine.** Salary changes, payroll release and the bank file do not yet need a second person (§10).
- **Email is recorded, not sent,** until a provider is connected (phase 25).
- **The scheduled tick is daily.** Work queued by a request runs at once and keeps itself going; only weekly reminders, escalation and the sweep wait for the day's tick. The tick accepts any caller until `CRON_SECRET` is set — harmless, since it only runs work already queued.
- **The change log starts at phase 10.** Earlier changes show in the dated history and `created_by` columns.
- **Local development points at production** unless `TURSO_DATABASE_URL=file:.local/dev.db` is set (§4.3). There is one Turso database.
- **The demo has no posted payroll month**, so payslips and Form 16 are empty in it until someone runs and posts one. The seed cannot do it: the payroll engine is `server-only` and the seed runs under plain `tsx` (§7.2). Both empty states now say what to do instead.

### 3.7 Blockers

- **R2 is not enabled** on the Cloudflare account. To finish it: enable R2 Object Storage in the dashboard (a payment method is asked for even on the free tier); `npx wrangler r2 bucket create hrms-documents`; create an API token with *Object Read & Write* on that bucket under R2 → Manage API tokens; set `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` and `R2_BUCKET` in `.env.local` and Vercel, and redeploy. New uploads go to R2; existing ones keep being read from the database.
- **Rotate the Turso auth token.** It has been pasted into chat transcripts more than once.

---

## 4. Getting started

### 4.1 What you need

- **Node.js 22 or 24** and npm. **Git.** A **Chrome or Edge** install for the UI audit (it drives the installed browser; nothing is downloaded).
- For deploying: push access to `github.com/KernelLex/hrms`; the Vercel project `amogh24/hrms`; the Turso database; later a Cloudflare account with R2. All have free tiers that cover the prototype.
- The **Turso CLI has no Windows build**; the dashboard does everything it would (create databases, mint tokens), and the app, migrations and seed talk to Turso over HTTPS from Node.

### 4.2 Environment variables

Copy `.env.example` to `.env.local` (never commit it):

| Variable | What |
|---|---|
| `TURSO_DATABASE_URL` | `libsql://…turso.io` for Turso, or `file:./.local/dev.db` for a local file |
| `TURSO_AUTH_TOKEN` | The Turso token; empty for a local file |
| `AUTH_SECRET` | Signs session cookies and the job runner's hand-off. `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
| `DEMO_SIGN_IN` | `off` removes one-click demo sign-in |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | All four set: new documents go to R2. Any empty: documents are stored in the database. |
| `APP_URL` | Where links in emails point; Vercel supplies the production URL, so set it only elsewhere |
| `CRON_SECRET` | When set, `/api/cron/tick` refuses calls without it (Vercel Cron sends it) |
| `SANDBOX_CLIENT_SECRET` | Local and CI only. When set, the seed creates the sandbox API clients `cl_mock_erp` (secret: this value) and `cl_sandbox_hr` (this value plus `-hr`). **Never set in production**, where HR registers each client and sees its secret once. |

A value already in the environment wins over `.env.local`, for Next.js and the scripts alike.

### 4.3 Running it

```bash
npm ci
TURSO_DATABASE_URL=file:.local/dev.db npm run db:reset   # migrate and seed a local database
TURSO_DATABASE_URL=file:.local/dev.db npx next dev       # the app against it, on localhost:3000
```

Work that changes data should always run against a local file: `.env.local` points at the one Turso database, which is also the live demo.

To work on the API, seed the local database with the sandbox clients and run the mock ERP against it:

```bash
export TURSO_DATABASE_URL=file:.local/dev.db SANDBOX_CLIENT_SECRET=any-long-value
npm run db:reset && npm run dev     # then, in another terminal with the same two variables:
npm run sandbox
```

| Command | Does |
|---|---|
| `npm run dev` | Development server |
| `npm run build`, `npm start` | Production build and server |
| `npm run db:generate` | Generates a migration from schema changes (`drizzle-kit generate`). **Read the SQL** before applying it (§7.2). |
| `npm run db:migrate` | Applies pending migrations to whatever `TURSO_DATABASE_URL` names |
| `npm run db:seed` / `db:reset` | Seeds the demo organisation / migrates then seeds. The seed is idempotent. |
| `npm test` | Vitest on a fresh SQLite file (`.vitest/test.db`), migrated and seeded each run; never touches Turso |
| `npm run audit:ui` | Walks every screen as four people at two widths against `BASE_URL` (default `http://localhost:3000`); `-- --only /payroll` for one area, `-- --shots out/` to save screenshots |
| `npm run sandbox` | Runs the mock ERP (`tools/mock-erp`) against `HRMS_URL` (default `http://localhost:3000`), receiving webhooks on port 4010. The database must be seeded with `SANDBOX_CLIENT_SECRET` set, and the same value exported. |
| `npm run api:docs` | Regenerates the reference section of `API.md` from the endpoint definitions. Run it whenever an endpoint, scope, event type or error code changes. |
| `npx tsc --noEmit`, `npm run lint` | Typecheck (run `npx next typegen` first on a clean checkout) and lint |

### 4.4 Deploying

- **Push to `main`.** Vercel deploys; CI runs typecheck, lint, tests, build, the UI audit and the mock ERP (`.github/workflows/ci.yml`).
- **Migrations are applied by hand before the push that needs them:** `npm run db:migrate` with `.env.local` pointing at Turso. A deploy whose code reads a table the database does not have yet fails on every page that reads it (§10 has moving this into the pipeline).
- `vercel.json` schedules the daily tick at 00:30 UTC (06:00 in India).

### 4.5 Working on Windows

The project was built on Windows 11 with Git Bash as the shell for scripts.

- **PowerShell 5.1 writes a byte-order mark** with `Set-Content -Encoding utf8`; in `.env.local` it silently hides the first variable. Write files without a BOM; `readEnv` strips one defensively.
- **Git Bash rewrites arguments that look like paths** (`/admin` becomes `C:/Program Files/Git/admin`). Prefix with `MSYS_NO_PATHCONV=1`, as in `MSYS_NO_PATHCONV=1 npm run audit:ui -- --only /admin`.
- **Without administrator rights**, Node, Git and the GitHub CLI were installed from their portable archives into the user's folder and added to the user PATH; winget could not be used.

---

## 5. How it is built

### 5.1 Stack

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js 16, App Router, TypeScript, React 19 | Server Components query the database directly; one codebase, one deploy. Next 16 renamed middleware to `proxy.ts`, made `params`, `cookies` and `headers` async, and gives error boundaries `retry()`. **Read `node_modules/next/dist/docs/` before relying on older Next.js knowledge.** |
| Styling | Tailwind CSS 4 | The design tokens (§8.15) map straight onto it |
| Type and icons | Geist through `next/font`; `lucide-react` | Named in the design language |
| Database | Turso (libSQL, which is SQLite) through `@libsql/client` | HTTP transport, so serverless functions need no connection pool |
| Queries | Drizzle ORM and drizzle-kit | Typed queries; migrations are plain SQL files, committed and reviewed |
| Documents | Cloudflare R2 through `aws4fetch`, or the database until R2 is enabled | Presigned downloads, no egress fees, no SDK weight |
| PDFs | `@cantoo/pdf-lib`, drawn directly | Pure JavaScript, fast in a serverless job, and it encrypts (AES-256) for password-protected payslips (§7.3) |
| Auth | A `jose`-signed session cookie; permissions read from the database per request | One credentials provider and seeded users do not need Auth.js |
| Validation | zod | The same schemas validate API requests, shape responses and generate the OpenAPI document |
| API reference | Scalar, loaded from jsDelivr on `/developers` | Renders the generated OpenAPI 3.1 document; no account |
| Hosting | Vercel | Push to deploy, preview URLs on branches, Cron for the daily tick |
| Tests | Vitest | Engines, repositories and Server Functions against a real schema in a local file |
| UI audit | `playwright-core` and `@axe-core/playwright` | Every screen, role and width, with WCAG checks |

### 5.2 Repository layout

```
hrms/
  HANDOVER.md                this document
  API.md                     the guide for developers of connected systems; its reference is generated
  README.md                  for the client: every feature in plain language
  AGENTS.md, CLAUDE.md       instructions for coding assistants
  HR MODULE/                 the original blueprint and HTML mockups (features only, §6.3)
  .github/workflows/ci.yml   the full check on every push
  vercel.json                the daily cron tick
  drizzle.config.ts          migrations out of src/db/schema into src/db/migrations
  vitest.config.mts          the test runner, pointed at .vitest/test.db
  scripts/
    ui-audit.ts              npm run audit:ui
    api-docs.ts              npm run api:docs
    dev-session.ts           a signed session cookie for scripted checks
  public/sw.js, offline.html the installed app's service worker and offline page
  tools/mock-erp/            the mock ERP: erp.ts (a client written from API.md), scenario.ts, run.ts
  tests/                     npm test; support/ holds global setup (migrate + seed), mocks and fixtures
  src/
    proxy.ts                 optimistic sign-in redirect only; real checks are on the server
    db/
      schema/                one file per module: security, org, personnel, time, payroll, tax,
                             recruitment, performance, app, workflow; re-exported by index.ts
      migrations/            generated SQL, committed; hand-written parts marked in the file
      seed/                  the demo organisation (index.ts) and npm run db:seed (run.ts)
      migrate.ts, load-env.ts
    app/
      sign-in/               outside the shell; one-click demo accounts
      careers/               outside the shell, public: open roles and applying
      manifest.ts, icon.tsx, apple-icon.tsx   what makes the app installable
      developers/            public: the API reference (Scalar) and /developers/errors
      (app)/                 everything behind the shell, one folder per area:
        page.tsx             the role-aware home
        me/ reports/ inbox/ approvals/ change-log/ outbox/ admin/
        org/ core-hr/ time/ payroll/ recruitment/ performance/ tax/
      api/                   health, documents, exports, the bank file, jobs/kick, cron/tick;
                             v1/[...path] hands every API call to the one router in lib/api
      actions/               Server Functions, one file per module
    components/              the design system in React: ui, inputs, shell, dialog, toast,
                             command menu, tables, charts, documents, payslip, form16, change log
    lib/
      auth.ts access.ts permissions.ts   session, permission checks, the permission catalogue
      db.ts env.ts money.ts dates.ts csv.ts
      nav.ts commands.ts     sidebar and command menu, filtered by permission
      change-log.ts change-format.ts access-log.ts
      notifications.ts email.ts storage.ts demo.ts document-kinds.ts
      jobs/                  queue.ts, handlers.ts, runner.ts
      api/                   the integration API: router.ts, clients.ts (tokens), events.ts (events and
                             webhooks), openapi.ts, reference.ts (API.md), format.ts, problem.ts,
                             scopes.ts, sandbox.ts, resources/ (the endpoint definitions)
      services/              business rules the screens and the API share: people, records, integration,
                             corrections
      documents/             payslip-pdf.ts: the payslip drawn as a PDF
      payslip-mail.ts, payslip-password.ts, email-attachments.ts   payslips by email
      corrections-values.ts  what an employee may ask to change, and its names
      recruitment.ts, recruitment-values.ts   recruitment's shared rules, and its fixed lists
      workflow/              engine.ts, processes.ts, leave.ts, completions.ts, adopt.ts
      engines/               timeslice.ts, quota.ts, payroll.ts, tax.ts, time-evaluation.ts
      repositories/          hand-written SQL reads: employees, home, profile, calendar, reports,
                             variance, change-log, access, integrations, recruitment, payslips
```

### 5.3 SQLite rules

Turso is SQLite. Getting any of these wrong produces wrong numbers or a schema that does not build.

1. **No schemas.** Tables carry a module prefix: `om_company`, `pa_employee`, `py_payroll_run`.
2. **Money is `INTEGER` paise, never `REAL`.** ₹72,000.00 is stored as `7200000`, converted only at the edge, through `src/lib/money.ts`.
3. **Dates are `TEXT` `YYYY-MM-DD`**; `9999-12-31` means open-ended; timestamps are ISO 8601 UTC. Formatting happens only in `src/lib/dates.ts`, in India time.
4. **Booleans are `INTEGER` 0/1.** **Quotas are half-day units**, so a half day is exact.
5. **No stored procedures**: engines are TypeScript in transactions (`client.transaction("write")` or `client.batch()`).
6. **Upserts are `INSERT … ON CONFLICT DO UPDATE`.** Partial and unique indexes work.
7. **Foreign keys** are enforced on Turso; a local file does not enforce them on every pooled connection, so code deletes dependents explicitly rather than relying on cascades.

### 5.4 Data model

160 tables. Every infotype table carries the same time-slice columns: `employee_id, valid_from, valid_to, seq, created_by, created_at`. One table per infotype, as SAP has PA0001, PA0002, PA0008 — never a JSON blob, because payroll must read basic pay as a typed, indexed value.

| Prefix | Tables |
|---|---|
| `om_` | company, personnel_area, personnel_sub_area, job, org_unit, position, reporting_line, cost_centre (sent by the ERP), headcount_request |
| `pa_` | employee; change_request (a correction an employee asked for, and its approval); checklist, checklist_item, checklist_template, task, letter, letter_template; exit, exit_interview; infotypes it0000_action, it0001_org_assignment, it0002_personal_data, it0006_address, it0007_planned_working_time, it0008_basic_pay, it0009_bank_details, it0011_statutory_details (UAN, ESI number, professional tax state, voluntary PF percentage), it0019_monitoring (probation), it0021_family_member, it0105_communication |
| `pt_` | absence_type, attendance_type, quota_type, it2001_absence, it2002_attendance, it2006_absence_quota (a running total; `quota_ledger` is the source of truth), leave_request, leave_policy, quota_ledger, comp_off, work_schedule_rule, holiday (`is_optional`: a festival nobody has to take), holiday_calendar (`optional_allowance`: how many of them one person may), time_evaluation_result, shift, roster_pattern, roster_pattern_day, roster, device, punch, attendance_day, regularisation |
| `py_` | wage_type, payroll_period, it0014_recurring_payment, it0015_additional_payment, opening_balance, payroll_run, run_member, payroll_result, payroll_result_line, bank_transfer_file, bank_transfer_line (with the ERP's payment confirmation), gl_posting, gl_posting_line, statutory_remittance, gl_account (sent by the ERP), salary_structure, salary_structure_component, employee_ctc, cost_split, gl_mapping, pf_rate, esi_rate, professional_tax_slab, lwf_rate, tax_constant, loan, loan_schedule, loan_prepayment, loan_benchmark_rate, claim_category, claim_category_limit, claim, claim_line, settlement, settlement_line |
| `rc_` | requisition (the role as candidates read it, and whether it is published), candidate, application (channel, screening, the decision and the offer), application_stage_history, interview (each round: interviewer, time, place, status, rating, recommendation, notes), hire_conversion, scorecard_template, scorecard, offer (CTC, structure, joining date, expiry, the letter, status, token), referral (referrer, candidate, bonus, qualifying days, status) |
| `pm_` | appraisal_template, appraisal_cycle, goal, appraisal, calibration, increment_recommendation, goal_checkin, feedback_request, feedback (360 feedback, kept behind its own anonymity threshold for peer answers), pip, pip_checkin |
| `ld_` | course, session, nomination, department_budget, certification (issuer, dates, its document, a once-only expiry reminder), certification_requirement (which job needs which certificate) |
| `tds_` | section_master, tax_slab, employee_declaration, deduction_register, form16, proof_window, proof, rent, perquisite, arrears_relief |
| `sec_` | app_user, role, user_role, permission, role_permission, role_scope |
| `rp_` | snapshot (month, measure, dimension, value — the trend's own source), schedule (report, recipients, frequency, format, last run) |
| `app_` | document (registry of stored files) and document_content (bytes when stored in the database), access_log (who read whose records), change_log (who changed what, before and after), notification and notification_pref, outbox (every message waiting to go), job and job_run, import and import_row (bulk loads) |
| `wf_` | flow and step (versioned approval routes), request, assignee, action (each decision, on whose behalf), delegation |
| `int_` | client and client_secret (connected systems), request_log, idempotency, external_ref (the ERP's ids against ours), ownership, ack (what the ERP booked or refused), sync_issue, event (the feed), webhook (subscriptions) |

`app_cursor` holds how far the event feed has read the change log.

Two tables the mockups lack but the features need: `py_payroll_result_line` (the per-wage-type detail a payslip renders) and `tds_tax_slab` (slabs per regime and year, so Form 16 Part B is computed, not typed in).

### 5.5 Engines

The line between a prototype and a clickable mockup; everything else is forms over tables.

1. **Time slices** (`engines/timeslice.ts`). Writing an infotype closes, trims, splits or replaces whatever it overlaps, in one transaction (`saveTimeSlice`, or `writeTimeSlice` inside a transaction the caller owns, such as an approval's), and logs each step to the change log in the same transaction. `readAsOf(table, employee, date)` answers "what was true then"; the as-of screen and every salary lookup use it. Addresses and contacts are sliced per type, so a new permanent address closes only the old permanent one. A new slice records the values it replaced, so the change log reads "₹65,000 → ₹72,000".
2. **Quotas** (`engines/quota.ts`). Working days against each employee's own holiday calendar, resolved by their personnel area; balances in half-day units, moved by `postLedger` — the one place either the ledger (`pt_quota_ledger`) or its running-total summary is written, so a balance equals its ledger's sum by construction. Single conditional updates mean two approvals at once cannot overdraw. The sandwich rule pulls in the non-working days a request abuts, where the governing policy asks for it.
3. **Leave policy** (`engines/leave-policy.ts`). What `pt_leave_policy` turns into ledger entries: `accrueForPeriod` grants a month's or a year's entitlement, pro-rated for a joiner where the policy says to, guarded against granting the same period twice; `runYearEnd` closes a year out against the policy governing it, capped carry-forward and lapse each their own entry; `forecastBalance` projects monthly accrual to a future date; `earnCompOff`, `consumeCompOff` (oldest-expiring first, splitting a grant) and `expireCompOffs`; `encashLeave` prices a day at basic pay over the month's working days and queues an IT0015 payment.
4. **Payroll** (`engines/payroll.ts`). Basic pay per working day employed against the employee's own calendar, slice by slice, less unpaid days; percentage allowances; recurring and one-off payments (an encashment among them); arrears for posted months whose inputs changed after they were paid; employee PF, employer PF/EPS/EDLI/admin charge, ESI (both sides), professional tax, the labour welfare fund (both sides) and TDS; net. Employer PF, ESI and LWF post as a new wage-type kind, `EmployerContribution` — on the payslip, excluded from gross, deductions and net by the same filter that already separated Earning from Deduction. `startRun` fixes who is in a run; `processRunBatch` calculates twenty at a time, each person's reads in one batch and writes in one atomic batch. Regular and off-cycle runs; each one-off paid exactly once. TDS projects the year from what has been paid, subtracts what was deducted, spreads the rest, and takes tax on a one-off in the month it is paid. Missing bank details produce the error row PY-03 shows. `computeCtcBreakdown`/`previewCtc` turn an annual CTC and a salary structure into basic, the automatic allowances basic drives, employer PF and a balancing allowance — two passes, since ESI eligibility depends on gross and gross depends on the balancing line.
5. **Tax** (`engines/tax.ts`). Slabs by regime and year; the standard deduction, the 87A rebate (with the new regime's marginal relief) and the 4% cess now read from `py_tax_constant` (`constantsFor`/`constantsForYear`), the same dated-row pattern the slabs already used, rather than literals — `computeAnnualTaxWith` takes them as an explicit argument, so every existing caller keeps working unchanged. Feeds monthly TDS and Form 16 Part B, so Part B reconciles with Part A. `compareRegimes` runs both regimes on the same figures through this same computation, so a declaration screen's comparison can never disagree with what a month's TDS actually takes. `hraExemption` is section 10(13A)'s own three-way minimum — actual HRA, rent less 10% of basic, 50% or 40% of basic by city — and `section89Relief` is the Form 10E arithmetic: the extra tax arrears cost in the year paid, less what they would have cost in the year they relate to, never negative. `effectiveDeclarationAmounts` is where proof verification meets payroll: while a `tds_proof_window` is open, or none exists yet for the year, a declaration's three figures are used exactly as declared; once closed, each is capped to no more than what `tds_proof` actually verified for that section — `loadFacts` (the same function every payroll calculation already reads its facts through) and Form 16 generation both call it, so what was deducted and what the certificate claims can never disagree. `engines/tax-returns.ts` writes the 24Q file's two annexures — challan and deductee detail every quarter, the full salary computation only in the fourth — caret-separated, the same "best-effort published format" spirit as the ECR file.
6. **Time evaluation** (`engines/time-evaluation.ts`). Turns absences and attendance into a period's paid days and overtime for payroll, against each employee's own holiday calendar.
7. **Attendance** (`engines/attendance.ts`). `generateRoster` applies a pattern to a team from a chosen start date; `runDailyAttendance` turns a batch of rostered days' punches into `pt_attendance_day` rows — first in, last out, a late mark past the shift's grace period, overtime past its length, a night shift read from its own start to its own end rather than one calendar day — everything read once for the whole batch. Overtime is paid at double the hourly rate as an IT0015 payment, the same table leave encashment uses. `finalizeAttendanceDay` re-runs the same logic for one employee's one day, reading and writing through the caller's own transaction so an approved regularisation's punches are visible to it immediately.
8. **Statutory** (`engines/statutory.ts`). Dated PF, ESI, professional tax and labour welfare fund rates, each read once per payroll batch and applied per employee rather than queried per employee — `pfContribution` and `esiContribution` are pure functions over an already-loaded rate; `professionalTaxFromSlabs` and `lwfDueFromRates` the same, over every state's rows loaded once. ESI eligibility locks in for a whole contribution period (April–September, October–March): once a payslip shows an ESI line earlier in the same period, it continues even past a raise that would otherwise put gross over the ceiling. `generateEcrText` writes EPFO's published pipe-delimited ("#~#") ECR format, eleven fields a member — a best-effort implementation of the public format; validating an actual file against EPFO's own tools is phase 25.
9. **Loans** (`engines/loans.ts`). `computeEmi` (standard reducing-balance formula, 0% dividing the principal evenly) and `generateSchedule` turn an approved loan into its full instalment table at once — each instalment's interest on the balance it opened the month with, the rest recovering principal, the last instalment absorbing whatever rounding left the others short so the balance closes at exactly zero. `prepayLoan` reduces the balance immediately and regenerates every instalment not yet queued onto payroll from the smaller balance at the same EMI, so a prepayment shortens how many instalments are left rather than their size; a prepayment that clears the balance closes the loan. `monthlyPerquisite` is rule 3(7)(i): nothing below the ₹20,000 aggregate-principal exemption or once the loan's own rate meets the dated benchmark rate (`benchmarkRateFor`), otherwise the rate gap on the opening balance, every month, for phase 21's Form 12BA. `queueDueLoanInstallments`, run by the daily job, queues each due instalment onto the same `py_it0015_additional_payment` one-off-payment rail leave encashment and overtime already use — so payroll itself needed no change to deduct it exactly once — and closes the loan once the last one is queued; `recoverLoanAtExit` does the same in one lump sum, for a final settlement. Claims need less machinery of their own: `engines/claims.ts` queues an approved claim's payment on the wage type its category's taxability picks, the one step a decision inside HRMS and a claim arriving already approved from the ERP both take; `services/claims.ts` checks a submission against its category's limit for the employee's own grade, by the same most-specific-match precedent the leave policy engine uses for its own overrides.
10. **Exits** (`engines/exits.ts`). Two pieces of pure maths a settlement needs. `gratuityYears` counts completed years from the hire date, plus one more if at least 240 days have passed in the year after the last completed one — the same figure section 2A's own definition of a year of "continuous service" uses, which courts have read into section 4(1)'s five-year eligibility the same way, so four years and 240 days is treated as five. `computeGratuity` is then 15/26 of the last basic for each of those years, capped at ₹20 lakh — for anyone outside government service, also its own tax exemption, so the amount paid is exactly the amount exempt. `noticeShortfallDays` and `noticePayPaise` price what notice was not served, at the monthly basic over a flat 30-day month. `services/exits.ts` does the rest: the termination itself through the time-slice engine, sign-in disabled by the same `sec_app_user.is_active` flag signing in already checks, an offboarding checklist (`startOffboarding` in `services/checklist.ts`, the same shape `startOnboarding` writes, against the "offboarding" template), every component queued onto `py_it0015_additional_payment`, and one off-cycle run — needing a period already locked for running, the same as any other off-cycle pay — that pays them all together. The statement (`py_settlement`, `py_settlement_line`) is assembled afterwards by reading back what the run actually paid, a deduction's amount negated so the statement reads as a recovery.

### 5.6 Platform services

**Sessions and permissions** (`auth.ts`, `access.ts`, `permissions.ts`). The cookie says who is signed in. **What they may do is read from the database on every request** (once per request through React's `cache`): their roles, those roles' permissions, and any scope. So a change on the roles screen applies without anyone signing out.

- Every Server Function calls `requirePermission(...)` (all of), `requireAnyPermission(...)` (any of) or `requireAccess()` (signed in, for things that act on the person's own data or decide by the data). Refusal throws `PermissionError` ("You do not have permission to do that."). Pages call `requirePage([...], redirectTo)`. Routes return 403.
- **Never check a role**, only a permission. The sidebar and command menu are filtered by permission too (`nav.ts`, `commands.ts`).
- **Scope.** A role can be limited to companies or personnel areas (`sec_role_scope`); a person sees every employee if any of their employee-seeing roles is unscoped, otherwise the union. `inScope()` and `scopeCondition()` apply it; today on the employee list, record, search, documents and export.
- **Sensitive fields** have their own permissions: `pay.view` hides the pay column, the basic-pay tab and pay on the as-of view; `bank.view` hides bank details; changing either needs the permission too.
- **The last administrator.** Any change that would leave no active person holding `access.manage` is refused.
- **The authorisation matrix** (`tests/authorisation.test.ts`) calls every Server Function and route as HR, a manager, an employee, a recruiter and someone with no role, and fails if anything lets in someone it should not — or if a new Server Function has no row.

The catalogue (`src/lib/permissions.ts`; the migration keeps `sec_permission` identical, and a test checks it):

| Group | Permissions (sensitive ones marked *) | HR | Manager | Employee | Recruiter |
|---|---|---|---|---|---|
| Organisation | `org.view`, `org.edit` | both | — | — | — |
| People | `employee.view_all`, `employee.view_team`, `employee.edit`, `employee.documents`, `pay.view`*, `bank.view`* | all but view_team | view_team | — | — |
| Time and leave | `time.manage`, `time.team_calendar`, `leave.decide_any` | all | team_calendar | — | — |
| Payroll | `payroll.view`*, `payroll.setup`, `payroll.run`, `payroll.post` | all | — | — | — |
| Tax | `tax.manage` | yes | — | — | — |
| Recruitment | `recruitment.manage`, `recruitment.hire`*, `recruitment.interview` | all | interview | interview | manage, interview |
| Performance | `performance.manage`*, `performance.rate_team`, `performance.rate_any`, `training.manage` | manage, rate_any, training.manage | rate_team | — | — |
| Reports and records | `reports.view`*, `audit.view` | both | — | — | — |
| Administration | `access.manage`, `integrations.manage`* | both | — | — | — |
| Self-service | `self.profile`, `self.leave`, `self.pay`, `self.tax`, `self.appraisal`, `self.attendance`, `self.loans`, `self.claims`, `self.exit`, `self.training` | all | all | all | — |

Deciding leave is not a permission: it follows the approval flow.

**The approval engine** (`workflow/`). A **flow** is a process's approval route (leave today; corrections, claims and exits later), **versioned** — saving makes a new version and requests keep the one they started on. A **step** says who approves (the reporting manager, their manager, anyone holding a role, or a named person), when it applies (only above so many working days — the first step always applies), and after how many days HR is added (escalation). `planRequest` resolves the first step before the caller's transaction and `writeRequest` writes it inside, so a request and its place on the flow commit together. `decide` checks authority — an assignee, a delegate standing in for one today (the action records **on whose behalf**), or someone with the process's override permission (`leave.decide_any`) — and nobody decides their own request. Deciding is one transaction: a conditional claim on the request, the action, then the next step's assignees and notification, or the process's completion (for leave: the leave request, the quota, the absence, the change-log entries and the employee's notification). A step that resolves to nobody goes to HR. `escalateOverdue` runs daily. **Delegation** ("While I am away" on My profile) hands someone's approvals to another person between two dates. Leave that was pending before the engine existed was adopted onto it by migration 0008.

**Corrections** are the engine's second process. By default HR approves every one, and a bank change adds the employee's reporting manager as a second step — a yes-or-no condition ("only for bank account changes"). The process requires **different people at each step**: whoever approved one step cannot approve the next, and if nobody else could, the first approval is refused with the reason rather than left stuck. The completion writes the change through the time-slice engine from its effective date, inside the deciding transaction, with "Requested by …; approved by … and …" in the change log, and tells the employee.

**Background jobs** (`jobs/`). A queue in the database, needing no outside service. Enqueueing is an insert that can join the caller's transaction; a dedupe key makes the same work a no-op; claiming is one conditional update, so two workers never run one job; a job whose worker died is taken over after five minutes; failures retry after 30 seconds, then 1, 2, 4 minutes and so on up to an hour, then stop as failed. Jobs run in `after()` once the response has gone, eight seconds at a time, and the runner hands off to a fresh invocation of itself with a signed, short-lived request (`/api/jobs/kick`) while work remains. The daily tick (`/api/cron/tick`) queues the scheduled work — weekly self-review reminders, escalation, stranded payroll runs and emails, housekeeping. Handlers: `outbox.deliver`, `webhooks.deliver`, `payroll.run`, `payslips.notify` (publishes a run's payslips: marks and logs each, tells each person in the app, and — where the period emails payslips — queues their protected PDF instead of the plain notice email), `self_review.notify`, `daily`. Each pass of the runner first turns new change-log entries into events. The daily job also drops API call logs after 30 days and idempotency keys after 7.

**The change log** (`change-log.ts`, `change-format.ts`). Every write records who made it (a person, the system, or an API client), the entity, the employee it is about, and only the fields that changed, before and after; nothing for a save that changes nothing; account numbers masked. Inside a transaction use `changeStatement`; around a plain write use `audited()` (reads before and after), `recordCreated()` or `recordDeleted()` (log the rows an insert or delete returned). `describeChange` renders entries as sentences: "Basic pay from 1 Apr 2025 — Amount ₹65,000 → ₹72,000".

**Notifications and email** (`notifications.ts`, `email.ts`). A notification and its email are written with the change that caused them, keyed by event and person, so a retried event tells nobody twice. Each person chooses per kind: inbox, email, both or neither. Kinds today: leave asked for, leave decided, approval waiting (a later step, an escalation, or a delegation), payslip ready, self review due, rating final, a change request decided, an interview to take, and a careers-page application (for whoever runs recruitment). An email can carry attachments described in `app_outbox.attachments` — what to make, not the bytes — rendered when sent or opened on the Outbox screen, so the outbox never holds anyone's pay. Email is built once in the design language with a plain-text version, queued in `app_outbox`, and delivered by the `outbox.deliver` job through a pluggable transport that records messages until phase 25 connects a provider. The Outbox screen shows every message as it would arrive, in a sandboxed frame.

**Documents** (`storage.ts`). One module stores files in R2 when configured and in the database otherwise, recognises them by content rather than name, and serves downloads through a route that checks permission and logs the read. A candidate's files open for whoever runs recruitment and for the people asked to interview that candidate. Payslips and Form 16 are never stored: they are rendered from their records each time. A payslip's PDF (`documents/payslip-pdf.ts`) is drawn from the same `getPayslip` read as the page, so the two cannot disagree.

**The access log** (`access-log.ts`). Reads of pay, bank, tax, documents and exports are logged; HR sees them per employee, and employees see who opened their records. Reads through the API are logged against the client.

**The integration API** (`lib/api/`, `lib/services/`; the contract itself is in `API.md`).

- **One router.** `app/api/v1/[...path]/route.ts` hands every call to `createRouter(ENDPOINTS)`. Each endpoint is a definition — method, path, the scopes it needs and the ones that add fields, zod schemas for query, body and response, whether it is idempotent or has an ETag, an example, and a handler. The router does the rest in one place: the bearer token, the client's address allowlist, the rate limit (`RateLimit-*` headers, `429`), scopes (`403 insufficient_scope`), validation (`400`, `422` with each field), idempotency (`int_idempotency`: a replay answers with the stored response), RFC 9457 problems whose `type` links to `/developers/errors`, `X-Request-Id`, and the request log. The OpenAPI document (`/api/v1/openapi.json`), the contract tests and `API.md`'s reference are generated from the same list, so none of them can drift.
- **Clients and tokens** (`clients.ts`). HR registers a system on the Integrations screen and sees its secret once; secrets are stored hashed, and a rotation keeps the old one working for 24 hours. The token endpoint issues one-hour JWTs signed from `AUTH_SECRET`; a token carries at most the client's current scopes, so removing a scope or suspending the client takes effect at once.
- **Sensitive fields** are absent, not empty, without `pay:read` or `bank:read` — in responses and in events alike.
- **The service layer** (`services/`). What the API writes — a hire, employee fields, absences, payments, cost centres, accounts, acknowledgements, confirmations — goes through the same functions HR's screens call, with the same validation and change log; the change log records the client as the actor.
- **Ownership and ids.** `int_ownership` says which system owns each record type, and for employees each field; the API refuses writes to what the HRMS owns (`owned_by_hrms`). `int_external_ref` keeps the ERP's own id for any record, so the ERP can look records up by its keys.
- **Events** (`events.ts`). Each runner pass reads the change log past a cursor (`app_cursor`) and turns entries into CloudEvents in `int_event`, numbered in sequence and marked with the client that caused them. Webhook subscribers get a row in the outbox per event (never their own changes, unless they ask), delivered by the `webhooks.deliver` job with a Standard Webhooks signature, retried with backoff and parked after ten failures for HR to replay. `GET /events` serves the same events as a feed.
- **What comes back.** Acknowledgements of journals (`int_ack`) show on the posting screen and in the reconciliation report; payment confirmations mark each salary paid or failed; anything that cannot be applied — a payment for someone not in the batch — becomes a sync issue HR retries or discards.
- **The sandbox** (`sandbox.ts`). With `SANDBOX_CLIENT_SECRET` set, the seed creates two clients with known secrets, for the mock ERP, CI and local work.

### 5.7 Cross-module transactions

- **Hiring and conversion** create the employee and their action, org assignment, personal data, working time and basic pay, and mark the position filled — one transaction, with the change-log entries in it.
- **Increment push** writes a new basic-pay slice the next payroll run reads.
- **A leave decision** claims the request, moves the quota, writes the absence and tells the employee — one transaction.
- **A careers-page application** finds or creates the candidate by email, stores the resume (removing a new candidate again if the upload fails), creates the application with its history, and in one batch logs it, tells the recruiters and queues the candidate's acknowledgement.

---

## 6. Screens and who sees them

### 6.1 Inventory

The blueprint defines 38 screens (with 18 nested tabs, 51 form surfaces). What each area holds, and the permission that opens it:

| Area | Screens | Opened by |
|---|---|---|
| Home | Role-aware: needs attention, four figures, coming up | signed in |
| My profile | Own record, masked bank account, documents, who has viewed it, notifications link, "While I am away"; "Request a change" for personal details, addresses and contacts, "Change bank account", and their change requests with withdraw | `self.profile` |
| Notifications | Inbox, preferences | signed in |
| Approvals | One inbox across processes, a tab per process with counts, recently decided; corrections side by side — on record and asked for, changed fields first — with the proof | signed in (shows what is waiting for them) |
| Org structure | Companies, personnel areas, sub-areas, jobs, departments, positions, reporting lines, org chart (OM-01…08) | `org.view` to see, `org.edit` to change |
| Employees | Search and list (CH-04); hire (CH-01); record with a tab per infotype (CH-02), as-of view (CH-03), documents, change log, access log; mass update (CH-05) | `employee.view_all` (a manager's team list: `employee.view_team`); pay and bank tabs need `pay.view` / `bank.view`; logs need `audit.view` |
| Exits | The exit board (clearance progress, settlement, settle now); Resign, with the settlement statement and the exit interview once settled | `employee.edit`; `self.exit` |
| Time | Absences, attendance, quotas, time evaluation, schedules, holidays and whether each is optional (TM-01…05); team calendar; my leave, with the optional holidays to take; my attendance, with clocking in and out | `time.manage`; `time.team_calendar`; `self.leave`; `self.attendance` |
| Payroll | Periods (with "email payslips" per period), wage types, salary structures (with each structure's own components), statutory rates (PF, ESI, professional tax, LWF, income-tax constants), GL mapping, recurring and one-off payments, run (with variance check and off-cycle), payslip with year to date, Download PDF and Email again, bank file, ledger (with its own CSV download) and remittances with ECR (PY-01…05); my payslips; a CTC tab and cost splits on the employee record | `payroll.view`, `payroll.setup`, `payroll.run`, `payroll.post`; `self.pay` |
| Money | Loans and claims administration (claim categories, the benchmark rate), approval with bills side by side; my loans (ask, prepay progress, schedule); my claims (submit with bills, withdraw) | `payroll.setup`; `self.loans`, `self.claims` |
| Tax | Sections and slabs, declarations (rent, proof filing, the regime comparison), proof verification and windows, register (with 24Q download), Form 16 (with 12BA and Section 89 relief) (TDS-01…05) | `tax.manage`; own declaration, proof and Form 16 with `self.tax` |
| Recruitment | Requisitions (list, open, detail with its applications and the role as candidates read it, edit, publish); applications by stage; each application's page — screening, interview rounds, the decision, the CTC offer with its real status, history; interviews upcoming and past; candidates with resumes; conversion (RC-01…05); recruitment analytics (time to hire, time in stage, sources, offer acceptance, drop-off); scorecards, the criteria each job's interviewers rate | `recruitment.manage`; conversion and an over-band offer need `recruitment.hire` |
| Interviews to take | The rounds someone is asked to take; each round's page, with the candidate, the role, the role's own scorecard if it has one, a "Download invite" link, and the notes form | `recruitment.interview` |
| Refer someone | A form to refer a candidate for an open role, and the referrals you have made with their status | `self.profile` |
| Careers site | Open roles and the form to apply; the candidate's own offer page, reached only through their link | public |
| Integrations | Connected systems (connect, settings, secrets, webhook deliveries with replay, recent calls), record ownership, sync issues, reconciliation | `integrations.manage` |
| API reference | `/developers` (the OpenAPI document in Scalar) and `/developers/errors` | public |
| Performance | Cycles, goals, ratings, calibration, increments (PM-01…05); 360 feedback (ask, and the aggregate once it is safe to show); improvement plans (open, check in, close); my appraisal with goal check-ins and feedback replies | `performance.manage`; `performance.rate_team` / `rate_any`; `self.appraisal` |
| Training | Catalogue (courses and sessions); nominations, decided against the department's budget for the year; budgets; certification compliance (who is missing what their job requires); my training (nominate, my certifications) | `training.manage`; `self.training` |
| Reports | Headcount, cost, leave, attrition; a 24-month headcount trend; leave liability; "Schedule this report", emailed on the 1st; CSV exports | `reports.view` |
| Change log, Outbox | Organisation-wide change log with filters; every email as it would be sent | `audit.view` |
| Access and approvals | Roles and permissions (list, new, edit with members and scope); approval flows (per process, edit as a new version) | `access.manage` |

Also: the sign-in page, a loading line that appears only if a screen is slow, an error screen with "Try again", and not-found pages inside and outside the shell. The command menu (Ctrl K / ⌘K) reaches every screen the person may open, their actions, and — for those who may see employees — people.

### 6.2 Print

The shell and screen headers stay off paper; A4 margins; ink kept. The payslip prints on one page and downloads as a one-page PDF; Form 16 Part B prints on its own page.

**Installed on a phone**, the app opens full screen from the home screen (the manifest, icons and `public/sw.js`). The service worker keeps only the app's code; offline, it shows `/offline.html`.

### 6.3 The mockups versus the design language

The HTML mockups in `HR MODULE/` define **features**; the design language (§8) defines **appearance**, and where they disagree the design language wins:

| Mockup does | Built instead |
|---|---|
| Green accent on chips, buttons, badges, rows | Ink. One colour, no second accent |
| UPPERCASE headings, letter-spaced kickers | Sentence case, 15px/600 card titles |
| A coloured pill on every table row | An 8px dot and a 13px label; badges only beside a page title |
| Amber "VACANT", green "Active", coloured stages | Status by shape and word, legible in greyscale |
| Dark sidebar | White, 240px, hairline edge |
| Four equal buttons per form | One primary; the rest secondary, ghost or destructive |
| `alert()` on every action | A toast: ink pill, bottom centre, past tense |
| Form and grid on one page with "Edit selected" | A list with a dialog per record |

The hire wizard uses numbered steps with a live summary panel; balance cards are a figure row; the rating distribution is a bar list; the pipeline is a progress track; the org tree is a hairline tree; payslips and Form 16 follow the printed-document pattern. Red appears only where earned: missing bank details, overdue remittances, a negative Form 16 balance. No employee photos: initials on a soft circle.

---

## 7. Conventions, gotchas and decisions

### 7.1 Conventions

- **Commits** describe the change, are made as `tfthushaar`, and carry **no** co-author or tool attribution.
- **Money** crosses no boundary as a float: paise in, a formatted string out, one helper.
- **Every write to employee master data goes through the time-slice engine**, never a bare insert.
- **Every write records a change-log entry**: through the engine, `changeStatement` in a transaction, or `audited()` / `recordCreated()` / `recordDeleted()`.
- **Every Server Function, route and page checks a permission** — never a role — and every new one gets a row in the authorisation matrix.
- **Anything slow, or anything that tells someone something, is a job or an outbox row** written with the change, never work the user waits for.
- **Hand-written SQL reads live in `src/lib/repositories/`.** A list that grows with headcount is paged in SQL (50 rows, page in the URL), never sliced in JavaScript.
- **Dates** are formatted by `src/lib/dates.ts` only: "26 Sept 2026", "2:30 pm", India time. **Copy** follows §8.12: sentence case, verb-plus-object buttons, no emojis.
- **Tests** come with every engine and repository change, and a test that cannot fail is not a test: break the code and watch it fail.
- **The API keeps up with the screens.** A change that alters what the API reads or writes updates its endpoint definitions, events, `API.md` guide and generated reference (`npm run api:docs`) in the same change; the reference test fails otherwise. Within `v1`, changes are additions only.
- **Before pushing:** `npx tsc --noEmit`, `npm run lint`, `npm test`, and `npm run audit:ui` against a running server. CI runs the same, and the mock ERP.
- **Every phase ends** with the migration read and applied to production, the tests and audit green, this document updated (§1), a commit, a push, CI green and the Vercel deployment green.

### 7.2 Gotchas

- **`.onConflictDoNothing()` guards nothing without a matching unique index.** Three repeating infotypes (`pa_it0006_address`, `pa_it0105_communication`, `pa_it0021_family_member`) have none, because HR may legitimately record more than one of a type; the seed relied on it anyway, and every re-run of `db:seed` against the same database — which every phase since 9 has done — silently duplicated every seeded row in production. Fixed by checking before inserting (migration 0012 cleans up what had already accumulated); `tests/seed.test.ts` re-seeds twice and asserts no duplicates.
- **drizzle-kit drops `ON DELETE` from `ALTER TABLE … ADD COLUMN … REFERENCES`** (migration 0006 restores it by hand), and its snapshot must match the schema exactly — regenerate rather than hand-edit a migration's DDL. Data statements appended by hand are marked in the file (0008).
- **Index names are global in SQLite.** Two tables cannot both have `ix_request_status`; prefix new indexes with their table's module.
- **A local SQLite file does not enforce foreign keys** on every pooled connection: delete dependents explicitly.
- **`tsx` cannot resolve extensionless re-exports in `.mts`** — standalone scripts are `.ts`.
- **Unlayered CSS beats every Tailwind utility**; base rules go in `@layer base`.
- **An `sr-only` label can widen the page** inside a table wrapper that is not `position: relative`; `TableScroll` is relative.
- **A grid with no column template grows to its content**: use `grid-cols-1` and `minmax(0,1fr)`.
- **Spanning more columns than a grid has adds columns.** `col-span-3` in a two-column grid makes a third; `FormFull` uses `col-span-full`. The audit cannot see this: nothing overflows, the form is just wrong.
- **A "use server" file may only export async functions**, and every one is a public endpoint: never export a helper from it (two unguarded ones were found and removed in phase 11). Shared constants go in plain modules.
- **`after()` needs a request.** Tests replace it with an immediate call and replace `kickJobs` with nothing; a test works the queue itself with `processJobs()`, so no job races it for SQLite's one writer.
- **The test session** is HR unless a test calls `actAs(session)` (`tests/support/people.ts`); permissions come from the test database, so create people with real roles.
- **Route types are generated.** A clean checkout needs `npx next typegen` before `tsc` (CI does this).
- **Vercel Hobby runs cron at most once a day**; the runner keeps itself going between ticks.
- **A disabled checkbox is not submitted**: a form that disables one must send its value another way.
- **axe waits forever on a frame that cannot run scripts**; the audit excludes the outbox's sandboxed email preview.
- **Constants from a `"use client"` module reach server components as references, not values.** Shared lists (such as `recruitment-values.ts`) live in plain modules both sides import.
- **Page files export only what Next.js expects** (the component, `metadata`, route config); anything else fails the build.
- **A page that reads the database without cookies or headers is prerendered at build time** — against a database CI has not created yet. The public careers pages say `export const dynamic = "force-dynamic"`.
- **Schema files are loaded by drizzle-kit and the seed outside Next.js:** import with relative paths, not `@/`.
- **The careers action is public by design** — the one Server Function anyone may call — so it trusts nothing: content-checked resume, a hidden field for bots, a daily limit per address hash.
- **Icons come from `icon.tsx`** (`/icon/192`, `/icon/512`, `/icon/maskable`) and `apple-icon.tsx`; the manifest names those paths. The proxy lets them, the manifest, `sw.js` and `offline.html` through without a session, or a signed-out phone could not install the app.
- **The service worker must never store a page or an API answer**: they hold pay and bank details. A test checks it stores only `/_next/static` files and icons.
- **A Server Function's check belongs in the function.** A page that only hides a button protects nothing: an employee could once read everyone's salary on a list page with no check, and a manager could decide or set goals for people outside their team by calling the function directly.

### 7.3 Decisions worth remembering

- **Next.js 16, not 15**; **`jose` cookie, not Auth.js**; **one table per infotype**.
- **Money in paise, quotas in half days**: SQLite has no decimal, and `REAL` drifts.
- **The database connects lazily**: connecting at module scope failed the Vercel build while it collected page data.
- **Payroll reads each person in one batch and writes in one atomic batch**, two round trips per employee however much history it consults.
- **Generated files are rendered, not stored**: posted records do not change, so a stored copy could only agree or be wrong.
- **`text-faint` is not used for text people must read**: at 12px it measures 2.6 : 1. Where §8 puts group labels, tab counts and upcoming stage labels in `text-faint`, the build uses `text-muted`, as §8.13 requires.
- **Jobs live in the database**, not a queue service: no account needed, works on any host, replaceable later without changing callers.
- **A notification is written with its cause**, in the same transaction where there is one, and keyed per event and person.
- **The change log keeps only what changed**, with column names as the database has them, rendered into sentences at the edge.
- **Permissions, not roles, everywhere**, read per request; roles are data HR edits. Three built-in roles keep exactly their old rights.
- **Approval flows are versioned**; a request never changes route mid-way.
- **One-click demo sign-in is on by default** because the demo password is printed on the page; the Server Function refuses anything but the seeded demo accounts.
- **Built as decided in phase 12**: REST with webhooks and a pull feed; OAuth client credentials issued here; CloudEvents signed to the Standard Webhooks specification; OpenAPI generated from zod; Scalar for documentation. Still ahead: PDFs by printing the existing HTML (phase 13).
- **One list of endpoint definitions** drives the router, the OpenAPI document, the contract tests and `API.md`'s reference.
- **Events come from the change log**, read by a cursor, rather than each module emitting its own: every logged write becomes an event, and the client that caused it is known, so no system hears its own change back.
- **Recruitment's stages are Applied, Interviewing, Selected, Offered and Hired.** Screened and Interviewed became one stage, Interviewing, because the rounds now say what happened; a rejection keeps the stage it reached. Approving needs at least one round with notes and none still scheduled.
- **PDFs are drawn with pdf-lib, not printed by a headless browser** (§9.4's first choice, decided without the planned spike): a browser is too heavy to start in a serverless job making one PDF per employee, and password protection needs a PDF library anyway. The standard PDF fonts cannot draw ₹, so PDF amounts are plain numbers "in Indian rupees".
- **Emailed payslips are protected with AES-256**; the password is the first four letters of the first name and the day and month of birth (ARJU2108), or the employee number without a date of birth. Downloads while signed in are not protected.
- **Year to date comes from stored lines**, never recalculated: the payslips of the financial year the employee could see (a posted month, or an off-cycle payment) up to this one, plus this one.
- **A correction needs different people at each step**, and a bank change two steps by default.
- **Interview notes are private to the HRMS**, and an interviewer's page shows only their own round, so each judges independently; recruiters see every round on the application.

---

## 8. Design language

The visual and interaction language of this product. It was adopted from Reklama, a product built the same way, and is written so the same style can be rebuilt on any platform. Every value here is what this codebase implements, with one deliberate departure: text people must read is never `text-faint` (§7.3). New screens pass the checklist in §8.16; the UI audit checks what can be checked mechanically.

The style in one sentence: **near-black ink on white, separated by hairlines, with one clear action per screen and red reserved for problems.**

### 8.1 Principles

1. **Ink is the brand.** There is one colour: near-black ink on white. Hierarchy comes from size, weight, grey value and space, never from hue.
2. **Red means something is wrong.** Red is the only other colour. It marks overdue money, errors and destructive actions. It is never decoration and never a way to say "important".
3. **Hairlines, not shadows.** Surfaces are separated by 1px lines and a slight difference between page and panel. Shadows appear only on things that float above the page.
4. **One clear next step.** A screen has at most one filled (primary) button. Everything else is quieter.
5. **Quiet by default, detail on demand.** Show what is needed to decide or act. Put the rest behind "More details", a tab or the next page.
6. **Words do the work.** Sentence case, plain verbs, exact numbers. No emojis, no exclamation marks.

### 8.2 Colour

#### Tokens

All greys are pure neutral (zero chroma). Do not substitute warm or cool greys.

| Token | Hex | Used for |
|---|---|---|
| `ink` | `#171717` | Headings, primary text, primary buttons, active states, filled status, chart bars, focus ring, text selection |
| `ink-hover` | `#404040` | Hover on ink fills; field labels; notice text |
| `text-secondary` | `#525252` | Supporting copy in lists, inactive navigation, avatar initials |
| `text-muted` | `#737373` | Subtitles, labels, metadata, table headers. The lightest grey allowed for text people must read |
| `text-faint` | `#a1a1a1` | Placeholders, counts, timestamps, inactive icons, navigation group labels. Supplementary text only |
| `decor` | `#d4d4d4` | Empty-state icons, row chevrons, the dash for an empty value, hovered control borders |
| `control` | `#e5e5e5` | Input borders, secondary-button ring, unfilled progress segments, timeline connector |
| `line` | `#ebebeb` | Card edges, page and section dividers, table header rule |
| `soft` | `#f5f5f5` | Row dividers inside cards, selected navigation item, chip and segmented tracks, avatars, notices, board columns |
| `canvas` | `#fafafa` | Page background, hover on white rows |
| `surface` | `#ffffff` | Cards, dialogs, inputs, sidebar |
| `danger` | `#e7000b` | Error text, overdue values, destructive button text, error toast |
| `danger-mark` | `#fb2c36` | Problem dots, failed progress segments |
| `danger-strong` | `#c10007` | Text inside red message boxes |
| `danger-soft` | `#fef2f2` | Background of error messages and problem notices, destructive-button hover |
| `danger-line` | `#ffc9c9` | Ring on red badges and on hovered destructive buttons |

#### Rules

- **No second accent.** Success is ink, not green. Information is grey, not blue. Attention is an ink outline, not amber.
- **Status is carried by shape and words, not colour.** Filled, outlined, hatched and grey are distinct in greyscale and for colour-blind users. Always pair the mark with a word.
- **Red always comes with words**, for example "₹8.2 L overdue", never a red dot alone with no explanation nearby.
- **Imagery:** placeholders are greyscale. Real photos are shown as they are, inside a hairline frame, and never tinted.

#### Contrast, measured

| Pair | Ratio | Verdict |
|---|---|---|
| `ink` on white | 17.9 : 1 | Any text |
| `text-secondary` on white | 7.8 : 1 | Any text |
| `text-muted` on white | 4.7 : 1 | Body text (passes WCAG AA) |
| `text-muted` on `canvas` | 4.5 : 1 | Body text, just passes |
| `text-faint` on white | 2.6 : 1 | Never for text people need; only counts, placeholders, timestamps next to a label |
| `danger` on white | 4.8 : 1 | Text |
| `danger-strong` on `danger-soft` | 5.9 : 1 | Text |
| `ink-hover` on `soft` | 9.5 : 1 | Text |

### 8.3 Typography

- **Typeface:** [Geist](https://vercel.com/font), free under the SIL Open Font License and available on Google Fonts. Fallback is the system UI font: SF Pro on Apple, Segoe UI on Windows, Roboto on Android.
- **Features:** `font-feature-settings: "ss01", "cv11"` everywhere. Base letter-spacing is `-0.005em`, and larger sizes are tightened further (see the scale below).
- **Weights:** 400 regular, 500 medium, 600 semibold. Nothing heavier. Emphasis inside a sentence is weight 500 in ink, never bold, italic or underline.
- **Numbers:** use tabular figures (`font-variant-numeric: tabular-nums`) for every amount, count and date that sits in a column or changes. Right-align amounts.
- **Casing:** sentence case for everything, including titles, buttons, tabs, labels, menu items and table headers. No ALL CAPS, no Title Case, no small-caps eyebrow labels.

#### Scale

| Role | Size | Weight | Tracking | Colour |
|---|---|---|---|---|
| Display (home greeting) | 32px | 600 | -0.025em | ink |
| Page title | 28px | 600 | -0.02em | ink |
| Headline figure | 26px | 600 | -0.02em | ink, or `danger` for a problem |
| Dialog title | 17px | 600 | -0.01em | ink |
| Card or section title | 15px | 600 | default | ink |
| Lead text (page subtitle) | 15px | 400 | default | muted |
| Body | 14px | 400 | default | ink or secondary |
| Small (labels, metadata, descriptions, table headers) | 13px | 400, or 500 for field labels | default | muted, labels `#404040` |
| Caption (badges, hints, legends, stage labels, group labels) | 12px | 400 or 500 | default | muted or faint |
| Micro (keyboard hints, avatar initials, count badges, calendar months) | 11px | 400 or 500 | default | varies |
| Data labels (calendar day numbers) | 9–10px | 400 | default | faint; inside data graphics only |

Titles and figures use a line height of about 1.25; body text uses about 1.5. Keep subtitles under about 670px wide and empty-state text under about 380px.

### 8.4 Space and layout

- **Base unit: 4px.** The steps in use are 4, 6, 8, 12, 16, 20, 24, 32, 40 and 48.
- **App frame:**
  - fixed sidebar 240px wide on screens 1024px and wider;
  - content column up to 1180px, centred;
  - side padding 20px on phones, 32px from 640px, 48px from 1024px;
  - top padding 32px, or 48px on desktop.
- **Rhythm:**
  - 32px from the page header to the content;
  - 24–40px between major blocks;
  - 24px gutter between cards;
  - 16px between form fields.
- **Grids:**
  - detail pages have a main column and a side column, roughly 3 : 2 or 2 : 1;
  - figure rows are 4 across on desktop and 2 across on phones.
- **Breakpoints:** 640px and 1024px. Below 1024px the sidebar becomes a drawer and a top bar appears (see Phones in §8.11).
- **Density:**
  - text controls 40px tall;
  - list rows about 48px;
  - navigation rows 36px.
  - Prefer fewer, roomier rows to dense grids.

### 8.5 Shape

| Radius | Used on |
|---|---|
| 3px | Data cells (availability calendar) |
| 4–6px | Legend swatches, keyboard hints |
| 8px | Navigation items, icon buttons, brand mark |
| 12px | Inputs, selects, the search field, hoverable list rows, board cards, command-menu rows, inline error boxes |
| 16px | Cards, panels, notices, board columns, the command menu, screenshots |
| 24px | Dialogs |
| Full (pill) | Buttons, badges, chips, segmented controls, toasts, avatars, status dots, progress segments, count badges |

Larger surfaces get larger radii. Anything you press that carries text is a pill.

### 8.6 Depth and surfaces

There are three levels:
- **page:** `canvas`;
- **resting surface:** white with a 1px `line` edge;
- **floating surface:** white with a shadow.

| Element | Treatment |
|---|---|
| Cards and panels | 1px `line`, no shadow, ever |
| Dialogs | Shadow `0 25px 50px -12px rgb(0 0 0 / 0.10)`; scrim `rgb(0 0 0 / 0.32)` |
| Command menu | Shadow `0 25px 50px -12px rgb(0 0 0 / 0.25)` plus a 1px ring at 5% black; scrim 25% black |
| Toasts | Shadow `0 10px 15px -3px rgb(0 0 0 / 0.10)` |
| Mobile drawer | Large shadow; scrim 30% black |
| Draggable cards | 1px ring at 4% black; on hover `0 2px 12px rgb(0 0 0 / 0.06)` |
| Sticky top bar | White at 85% opacity with a 24px background blur, hairline underneath |

Never give a resting surface both a border and a shadow.

### 8.7 Icons

- **Set:** an outline icon set on a 24px grid with round caps and joins. The product uses [Lucide](https://lucide.dev).
- **Stroke:** 1.75 at every size, or 1.5 for large empty-state icons.
- **Sizes:**
  - 16px in buttons and inline;
  - 18px in navigation;
  - 15px in timeline markers;
  - 20px in the mobile top bar;
  - 28px in empty states.
- **Colour:** icons take the colour of their text. Inactive navigation icons are `text-faint`, and active ones are ink. Icons are never coloured and never sit on coloured tiles.
- **Icon-only buttons** are reserved for universally known actions: close, menu, search, sign out. Each one has an accessible name and a tooltip.
- **Arrows:**
  - a chevron at the end of a row means the row opens something;
  - a trailing arrow appears only on a button that moves a workflow to its next step;
  - never add arrows to text links.

### 8.8 Motion

- **Hover and state changes:** 150ms colour transitions, easing `cubic-bezier(0.4, 0, 0.2, 1)`.
- **Dialog entrance:**
  - 180ms, easing `cubic-bezier(0.2, 0.8, 0.2, 1)`;
  - from opacity 0, 8px lower, at 98.5% scale.
- **Toasts:** appear immediately and leave after 3.5 seconds.
- **Loading:** a small spinner inside the button that was pressed, and the button is disabled. No skeleton shimmer and no full-page spinners for actions.
- **Avoid:** bounce, parallax, looping animation and anything decorative.
- **Reduced motion (recommended):** when the user has asked for less motion, drop the dialog rise and keep only the fade.

### 8.9 Components

#### Buttons

| Variant | Resting | Hover | Use |
|---|---|---|---|
| Primary | Ink fill, white text | `#404040` fill | The one main action on a screen or in a dialog |
| Secondary | White, ink text, 1px inset `control` ring | `canvas` fill, `decor` ring | Other actions |
| Ghost | No fill, `text-secondary` text | `soft` fill, ink text | Cancel, tertiary and toolbar actions |
| Destructive | White, `danger` text, 1px inset `control` ring | `danger-soft` fill, `danger-line` ring | Delete, cancel a booking, mark as lost |

| Size | Height | Side padding | Text |
|---|---|---|---|
| Small | 32px | 12px | 13px |
| Medium (default) | 36px | 16px | 14px |
| Large | 44px | 20px | 15px |

**Common to all sizes:**
- pill shape and weight 500;
- a 16px icon at stroke 1.75, with a 6–8px gap;
- the label never wraps;
- 40% opacity when disabled.

**Rules:**
- **At most one primary button per screen.** A dialog counts as its own screen.
- **Labels are a verb plus its object:** "Send quote", "Record payment", "Add screen".
- **Dialog footers** are right-aligned, with Cancel as a ghost button before the primary button.

#### Text fields and selects

- **Box:**
  - 40px tall, 12px radius, white;
  - 1px `control` border, 12px side padding;
  - 14px ink text, `text-faint` placeholder.
- **Focus:** the border turns ink, with a 4px ring of ink at 5% opacity.
- **Disabled:** `canvas` fill and muted text.
- **Labels and hints:**
  - the label sits above the field, 13px weight 500 in `#404040`, with a 6px gap;
  - a required field gets a grey asterisk after its label;
  - a hint goes below the field, 12px muted.
- **Errors** appear in one block under the fields:
  - `danger-soft` fill, 12px radius, 13px `danger-strong` text;
  - the message says what to change.
- **Offer choices instead of typing:**
  - chips for common answers above a free-text box;
  - a segmented control for 2–4 exclusive options;
  - presets next to date fields.
- **Keep optional fields folded away** under "More details".

#### Chips

- **Resting:**
  - pill shape, 1px `control` border, white;
  - 12px weight 500 text in `#404040`;
  - 4px × 12px padding.
- **Hover:** the border turns `text-faint`.
- **Selected:** ink fill, ink border and white text.

#### Segmented control

- **Track:** a `soft` pill with 4px padding.
- **Options:** pills of 13px weight 500 text, with 6px × 14px padding.
- **Selected option:** white with a small shadow and ink text. Unselected options use `text-secondary`.

#### Cards

- **Card:** white, with a 1px `line` edge and a 16px radius.
- **Header:**
  - padding of 24px at the sides, 20px on top and 12px below;
  - title 15px weight 600;
  - optional description 13px muted;
  - small action buttons aligned right.
- **Rows inside a card** are inset 12px and have a 12px radius, with a `canvas` fill on hover.

#### Figure row

- **One card split into equal cells by hairlines:** 4 across on desktop, 2 on phones.
- **Each cell:**
  - 24px × 20px padding;
  - label 13px muted, then value 26px weight 600, then hint 13px muted.
- **A cell can be a link**, filled with `canvas` on hover.
- **The value turns `danger` only for a problem**, such as money overdue.

#### Tables

- **Header:**
  - 13px weight 400, muted, sentence case;
  - 12px vertical padding;
  - a `line` rule underneath and no fill.
- **Rows:**
  - 14px text with 14px vertical padding;
  - `soft` dividers, with no divider after the last row;
  - `canvas` fill on hover.
- **Alignment:**
  - the first and last cells have 24px outer padding, so they line up with the card header;
  - amounts are right-aligned with tabular figures.
- **Two-line cells:** the main value is ink weight 500, with a muted 12–13px line underneath (a code or a place).
- **On small screens** the table scrolls sideways rather than wrapping cells.

#### Key–value list

- **Label and value:** the label sits left in 13px muted, and the value sits right in 13px ink.
- **Rows:** 12px vertical padding with `soft` dividers.
- **Empty values** show a `decor` dash.

#### Status

| Meaning | Badge | Dot (8px) |
|---|---|---|
| Done, active or confirmed | Ink fill, white text | Filled ink |
| Needs action from us | White, ink text, 1px ink ring | 1.5px ink ring |
| In progress or waiting on someone else | White, `#404040` text, 1px `decor` ring | 1.5px ink ring |
| Neutral, draft or closed | `soft` fill, `text-secondary` text | `decor` fill |
| Problem | White, `danger` text, `danger-line` ring | `danger-mark` fill |

- **Badge:** pill shape, 12px weight 500, 2px × 8px padding, with an optional 6px dot.
- **Where each form goes:**
  - in lists and tables, use the quiet form: an 8px dot and a 13px label;
  - keep badges for the single status beside a page title.

#### Progress track (stages)

- **Segments:** a row of equal segments, 4px tall with pill ends and 6px gaps.
  - Reached: ink.
  - Not reached: `control`.
  - Failed: `danger-mark`.
- **Labels:** 12px, under each segment.
  - Current: ink, weight 500.
  - Done: `text-secondary`.
  - Upcoming: `text-faint`.
  - Failed: `danger`, weight 500.
- **Summary line:** a 13px muted line sits above the track, such as "Stage **Negotiation**".
- **Moving stages:** when the user may change the stage, each segment is a button, and hovering an upcoming segment darkens it to `text-faint`.

#### Tabs

- **Layout:** a row sitting on a `line` rule, with items of 14px text, 12px vertical padding and 24px gaps.
- **States:**
  - active: ink, weight 500, with a 2px ink underline that covers the rule;
  - inactive: muted, turning ink on hover.
- **Counts** follow the label in `text-faint`.

#### Sidebar navigation

- **Frame:** white, 240px wide, with a hairline on the right.
- **Top:**
  - the brand mark and name, with 20px padding;
  - below them a search button: 36px tall, `soft` fill, 12px radius, reading "Search", with a keyboard hint on the right.
- **Groups:**
  - 12px apart;
  - each has a 12px `text-faint` label in sentence case ("Sales", "Operations", "Money", "Admin");
  - **the label folds its group:** it is a button with a 14px chevron, pointing down when open and right when folded. The group holding the current page opens itself; the others stay as the person left them, remembered in their browser (in memory where storage is refused). A long sidebar stays short.
- **Items:**
  - 36px tall, 8px radius, 12px padding;
  - an 18px icon, a 12px gap, then a 14px label.
- **Item states:**
  - active: `soft` fill, ink text, weight 500 and an ink icon;
  - inactive: `text-secondary` text, a `text-faint` icon and a `canvas` fill on hover.
- **Counts:** an ink pill at least 20px wide, with white 11px weight 500 tabular figures.
- **Footer:**
  - a hairline on top;
  - avatar, then name (13px weight 500) and role (12px muted);
  - a sign-out icon button.

#### Command menu

- **Opening:**
  - Ctrl K, or ⌘K on a Mac, from anywhere;
  - also from the sidebar search button.
- **Panel:**
  - centred, 512px wide, 14% down the screen;
  - 16px radius, with the floating shadow and scrim.
- **Input:** 52px tall with 15px text and a `text-faint` search icon. It has no border, only a hairline underneath.
- **Results:**
  - rows with a 12px radius and 10px × 12px padding;
  - the highlighted row has a `soft` fill;
  - an optional hint ("Go to") sits on the right in 12px `text-faint`.
- **Order of results:**
  - actions first ("New quote");
  - then pages;
  - then "Search for …" once two characters are typed.
- **Keys:** arrow keys move through the results, Enter opens one and Esc closes the menu.

#### Dialogs

- **Size:** centred, 448px wide, or 672px for complex forms. On phones the width is the screen width minus 32px.
- **Surface:** 24px radius, the floating shadow, the scrim and the entrance motion.
- **Header:**
  - 24px padding;
  - title 17px weight 600, with a 13px muted description;
  - a round ghost close button at the top right.
- **Body:** scrolls within 75% of the screen height.
- **Footer:** Cancel as a ghost button, then the primary button, aligned right.
- **Destructive confirmations** name the thing being removed.

#### Toasts

- **Placement:** bottom centre, 24px from the edge. They sit above open dialogs.
- **Look:**
  - pill shape, ink fill;
  - white 13px weight 500 text, 10px × 16px padding;
  - the toast shadow.
- **Errors** use a `danger` fill.
- **Behaviour:** each toast leaves after 3.5 seconds, and screen readers announce it as a status.
- **Wording:** one short sentence in the past tense, such as "Quote sent" or "Payment recorded".

#### Notices

- **Inline banner:**
  - 16px radius, `soft` fill;
  - 14px text in `#404040`, with 16px × 14px padding;
  - an optional 16px icon.
- **For problems:** a `danger-soft` fill with `danger-strong` text.

#### Empty states

- **Layout:** centred with 56px vertical padding.
  - Icon: 28px, stroke 1.5, in `decor`.
  - Title: 15px weight 500, ink.
  - Text: one 13px muted line.
  - Action: one button.
- **What it says:** what will appear here, and how to add the first one.

#### Avatars

- **Look:** initials on a `soft` circle, in `text-secondary` weight 500.
  - 32px circle with 11px initials.
  - 24px circle with 10px initials.
- **Never used:** photos, or a different colour for each person.

#### Activity timeline

- **Markers:**
  - 32px circles with a `soft` fill, an ink 15px icon and a 4px white ring;
  - joined by a 1px `control` line;
  - system events use a white marker with a `control` ring and a `text-faint` icon.
- **Each entry:**
  - the person's name in ink weight 500, the verb in `text-secondary`, and the duration in `text-faint`;
  - the time right-aligned in 12px `text-faint` tabular figures;
  - any note below in 14px `text-secondary`.
- **Spacing:** entries are 24px apart.

#### Board (drag and drop)

- **Columns:**
  - 272px wide, `soft` fill, 16px radius, 16px apart;
  - header: name in 14px weight 500, count in `text-faint`.
- **Cards:**
  - white, 12px radius, 14px padding;
  - a 4% black ring, with a soft shadow on hover.
- **While dragging:** the dragged card drops to 40% opacity, and the column under it darkens slightly.
- **Card content:**
  - name in 14px weight 500;
  - up to two lines of context in 13px muted;
  - a 12px muted footer with the next step (in `danger` if overdue) and the deal value in ink weight 500.

#### Tasks and steps

- **Task checkboxes:** 20px circles. A done task is an ink fill with a white 12px tick.
- **Guided multi-step forms:**
  - number each step with a 24px ink circle holding a white 12px number;
  - keep a live summary panel on the right that stays in view while scrolling;
  - show the total in that panel at 26px weight 600.

#### Brand mark and keyboard hints

- **Brand mark:**
  - a 28px ink square with an 8px radius and a white 13px weight 600 initial;
  - the name next to it, 15px weight 600, -0.01em, 10px away.
- **Keyboard hint:**
  - white, 1px `control` ring, 6px radius;
  - 11px muted text, 2px × 6px padding;
  - written "Ctrl K" (⌘K on a Mac).

### 8.10 Charts and data

- **One hue.** Ink on `soft` tracks. There are no categorical rainbows. If a second series cannot be avoided, use `text-faint` and `decor` and label the series directly.
- **Bar lists:**
  - label on the left, up to 144px wide and truncated;
  - bar 12px tall in ink, with a 4px rounded end;
  - value at the tip of the bar in 12px weight 500 tabular figures;
  - the longest bar reaches 85% of the width, so the value always fits.
- **Meters:** an 8px pill with a `soft` track and an ink fill.
- **Negative values** (such as a loss) are the one place red appears in a report.
- **Availability grid:** day cells 14px × 28px, 2px apart, 3px radius.

  | State | Cell |
  |---|---|
  | Free | `soft` |
  | Partly sold | `decor` up to a third, `text-faint` up to two thirds, `text-muted` above that |
  | Fully booked | ink |
  | On hold | White with an ink diagonal hatch (1px lines every 5px at 135°) and a `decor` ring |
  | Maintenance | `control` with a white diagonal hatch at 45° |

  Always show a legend. Every cell also has a plain-text tooltip, such as "12 Oct: 4 of 10 slots sold, 2 on hold".

### 8.11 Page patterns

#### Anatomy of a page

1. **Back link** on detail pages: 13px muted with a left chevron, naming the parent ("Quotes").
2. **Title** at 28px weight 600, with at most one status badge beside it.
3. **Subtitle:** one 15px muted line of context, such as "For Kaveri Silks, prepared by Arjun Rao. Valid until 8 Oct 2026."
4. **Actions** on the same row, aligned right. Secondary actions come first and the one primary action sits at the far right.
5. **Content** starts 32px below.

#### Home

- **Header:** a 13px muted date line, then the greeting at 32px.
- **Needs attention:** a single card with one sentence per item.
  - Each item starts with a status dot, red for problems.
  - The key noun is in ink weight 500.
  - Each row ends with a chevron.
- **Below that:** a row of the four figures that matter for this person, then today's tasks and this week's events.

#### Record pages (a client, quote, booking or invoice)

- **Top card:**
  - the progress track;
  - one sentence on where things stand ("Waiting for the client's decision");
  - the single suggested next step as the primary button.
- **Main column:** the substance, such as line items, the timeline or the tax invoice.
- **Side column:** summary, versions and details, as key–value lists.

#### Lists

- **Above the table:** search on the left, then filters as selects or chips.
- **Counts** appear in the tab labels.
- **When the list is empty,** the empty state sits inside the card.

#### Forms

- **One column, 16px between fields.** Put two fields side by side only when both are short, such as dates or amounts.
- **Optional fields** go under "More details".

#### Sign-in

- **Column:** centred, 380px wide.
- **Contents:**
  - brand mark;
  - title and subtitle;
  - the form;
  - where relevant, a card listing accounts as rows.

#### Phones

- **Navigation:** it moves into a 288px drawer behind a 30% scrim.
- **Top bar:** a 56px sticky, translucent bar holding menu, brand and search.
- **Layout changes:**
  - figure rows go 2 across;
  - tables scroll sideways;
  - two-column pages stack with the main column first.
- **Touch targets:** at least 40px, and 44px where space allows.

#### Printed documents (quotes, invoices, receipts, PDFs)

- **Look:**
  - same typeface and hairline tables, on white, sized for A4;
  - ink only, with a letterhead carrying the brand mark.
- **Figures:** amounts right-aligned in tabular figures, with totals at weight 600.
- **Letterhead contact lines** may use middle dots as separators. This is the only place they are allowed.

### 8.12 Writing

- **Sentence case everywhere.**
- **Buttons** are a verb and its object: "Send quote", "Record payment". Never "Submit", "OK" or "Click here".
- **Say what will happen and when:** "Screens held until 26 Sept, 10:50 pm."
- **Numbers carry their units and use local formats:**
  - "₹4,67,280", "₹14.8 L";
  - "3 of 14", "21% occupied".
  - Dates read "26 Sept 2026", and times "10:50 pm".
- **Metadata** is written with commas, like "LED screen, MG Road". Do not use middle dots, pipes or slashes.
- **Links** say where they go ("All bookings"), with no trailing arrows and no "Learn more".
- **Errors** say what went wrong and what to do next. Success messages are short and in the past tense.
- **Empty states** explain what goes there and how to add the first one.
- **Avoid:** emojis, exclamation marks, "Oops", and jargon when a plain word exists.

### 8.13 Accessibility

- **Focus:**
  - every interactive element shows a 2px ink outline, 2px offset, when focused from the keyboard;
  - text inputs show the ink border and soft ring instead.
- **Text selection:** ink background with white text.
- **Contrast:** text people must read is `text-muted` or darker. See the contrast table in section 2.
- **Status** is never shown by colour alone. It always has a shape and a word.
- **Every input has a visible label.** Placeholders are examples, not labels.
- **Dialogs:**
  - use the platform's modal dialog, so focus stays inside and Esc closes it;
  - the command menu works entirely from the keyboard.
- **Icon-only buttons** have accessible names.
- **Toasts** are announced to screen readers as status messages.

### 8.14 What to avoid

Each of these makes an interface look generated or cluttered:

- Gradients, glows or glass effects on resting surfaces.
- Coloured icon tiles, or a different colour for each section or category.
- Shadows on cards.
- More than one filled button on a screen.
- Green for success, blue for information or amber for warnings.
- ALL CAPS eyebrow labels above headings.
- Emojis anywhere, including toasts and empty states.
- Middle-dot metadata strings in the interface ("LED · MG Road · 10 slots").
- Arrows appended to links ("View all →").
- Decorative illustrations.
- Dense toolbars.
- Forms that show every optional field up front.
- Centred body text.
- Pill badges on every row of a table.

### 8.15 Rebuilding it on another platform

#### CSS custom properties (any web stack)

```css
:root {
  --ink: #171717;
  --ink-hover: #404040;
  --text-secondary: #525252;
  --text-muted: #737373;
  --text-faint: #a1a1a1;
  --decor: #d4d4d4;
  --control: #e5e5e5;
  --line: #ebebeb;
  --soft: #f5f5f5;
  --canvas: #fafafa;
  --surface: #ffffff;

  --danger: #e7000b;
  --danger-mark: #fb2c36;
  --danger-strong: #c10007;
  --danger-soft: #fef2f2;
  --danger-line: #ffc9c9;

  --radius-cell: 3px;
  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-lg: 16px;
  --radius-xl: 24px;
  --radius-pill: 999px;

  --shadow-dialog: 0 25px 50px -12px rgb(0 0 0 / 0.1);
  --shadow-toast: 0 10px 15px -3px rgb(0 0 0 / 0.1);
  --scrim: rgb(0 0 0 / 0.32);

  --ease-standard: cubic-bezier(0.4, 0, 0.2, 1);
  --ease-enter: cubic-bezier(0.2, 0.8, 0.2, 1);

  --font-sans: "Geist", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}

body {
  background: var(--canvas);
  color: var(--ink);
  font-family: var(--font-sans);
  font-feature-settings: "ss01", "cv11";
  letter-spacing: -0.005em;
  -webkit-font-smoothing: antialiased;
}

::selection { background: var(--ink); color: #fff; }
:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
```

#### Tailwind CSS 4

The product uses Tailwind's built-in `neutral` and `red` scales. The tokens above correspond to:
- `neutral-900` (ink), `700`, `600`, `500`, `400`, `300`, `200`, `100` and `50`;
- `red-600`, `500`, `700`, `50` and `200`.

It adds two tokens of its own:

```css
@theme {
  --font-sans: var(--font-geist), ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  --color-canvas: #fafafa;
  --color-line: #ebebeb;
}
```

Tailwind radius names map as follows:
- `rounded-lg` is 8px;
- `rounded-xl` is 12px;
- `rounded-2xl` is 16px;
- `rounded-3xl` is 24px.

#### Native apps and design tools

- **iOS and Android:**
  - keep the same scale in points or dp;
  - Geist ships as OTF and TTF files; otherwise use SF Pro or Roboto at the same sizes;
  - hairlines stay one logical pixel;
  - use the platform's own sheets and dialogs, restyled with the radii and scrims above.
- **Figma or similar:**
  - create colour variables with the token names from §8.2;
  - create one text style per row of the type scale;
  - build button, chip, badge and status-dot components with every variant and size listed here.

### 8.16 Review checklist for a new screen

- [ ] Only ink, greys and, for problems, red.
- [ ] One primary button at most.
- [ ] Cards separated by hairlines, with no shadows on resting surfaces.
- [ ] Sentence case throughout, with no capitals-only labels and no emojis.
- [ ] Every number formatted, with units, in tabular figures where it lines up.
- [ ] Every status readable without colour (shape plus word).
- [ ] All text people must read is `#737373` or darker.
- [ ] A visible focus state on every control.
- [ ] Empty, loading and error states designed, not left to chance.
- [ ] Works at 375px wide.
- [ ] Nothing on the screen can be removed without losing something the user needs to decide or act.

### 8.17 Where it lives in this repository

| File | What it holds |
|---|---|
| `src/app/globals.css` | Colour tokens, base type settings, focus, selection, dialog motion (`@layer base`) |
| `src/app/layout.tsx` | Geist font loading |
| `src/components/ui.tsx` | Buttons, cards, badges, status dots, page header, figure row, tables, tabs, avatars, notices, empty states, key–value lists, row links |
| `src/components/inputs.tsx` | Fields, selects, date inputs, checkboxes, chips, form grid, "More details", the error block |
| `src/components/shell.tsx` | Sidebar, bell and count, mobile top bar and drawer, brand mark |
| `src/components/command-menu.tsx`, `dialog.tsx`, `toast.tsx` | Command menu, dialogs, toasts |
| `src/components/stage-track.tsx`, `charts.tsx` | Progress tracks, bar lists and meters |
| `src/components/home.tsx`, `payslip.tsx`, `form16.tsx`, `change-log.tsx`, `table-scroll.tsx` | Home cards, the printed documents, the change-log table, sideways-scrolling tables |

---

## 9. What is left

### 9.1 The shape of the remaining work

The plan continues the phase numbering: phases 0 to 13 are done (§11), and the rest is in two parts.

- **Part A — phases 12 to 24.** Everything that can be built without anyone's input: no accounts, keys, contracts or decisions needed from you or the client. Where a feature eventually needs an outside service, Part A builds all of it and leaves only the switch.
- **Part B — phase 25.** What needs input from you or the client, gathered in one place. Each item says what will already be built, so finishing it is configuration and testing.

The client's ERP and this module must exchange data **in both directions through an API**, so that integration is a foundation — built in phase 12 and extended by every phase after it — rather than a feature added at the end. Every phase from 12 ships its API endpoints and events with its screens (§9.7). What must be true before real employee data or real payroll is in §10; where a phase leans on one of those items, it says so.

**Open questions for the client** (each blocks only phase 25, §9.6): which record types their ERP owns; whether it receives webhooks or reads the pull feed, or expects this module to call its API; which roles their HR team needs (§10.1).

### 9.2 Working with the client's ERP

The HRMS and the client's ERP are two systems with one agreement: a published API contract. Neither reads the other's database. The client's developers build against the contract; this module keeps it.

#### What flows each way

The default set below is built in Part A and confirmed with the client in phase 25.

| From → to | What | Through |
|---|---|---|
| HRMS → ERP | **People**: hires, changes to position, department and cost centre, exits | `employee.*` events · `/v1/employees` |
| HRMS → ERP | **Organisation**: companies, locations, departments, positions | `org.*` and `position.*` events · `/v1/org/...` |
| HRMS → ERP | **The payroll journal** for each run, by account and cost centre, with employer contributions | `gl.posting.created` · `/v1/gl-postings` |
| HRMS → ERP | **Payments to make**: net pay per person with bank details, statutory remittances due | `payroll.period.posted`, `remittance.due` · `/v1/payment-batches`, `/v1/remittances` |
| HRMS → ERP | **Time**, for the ERP's project costing or billing: approved leave, attendance, overtime | `leave.*`, `attendance.*` · `/v1/attendance-days` |
| HRMS → ERP | **Loans, claims and settlements**, for the ERP's books | `loan.*`, `claim.*`, `settlement.*` |
| ERP → HRMS | **Chart of accounts and cost centres**, when the ERP owns them | `PUT /v1/gl-accounts/{code}` · `PUT /v1/cost-centres/{code}` |
| ERP → HRMS | **Payment confirmations**: salary credited or failed, remittance paid, with the bank reference | `POST /v1/payment-batches/{id}/confirmations` · `POST /v1/remittances/{id}/payment` |
| ERP → HRMS | **Earnings and deductions that start in the ERP**: sales incentives, canteen or asset recoveries | `POST /v1/one-off-payments` · `/v1/recurring-payments` |
| ERP → HRMS | **Approved expense claims**, if expenses are handled in the ERP | `POST /v1/claims` |
| ERP → HRMS | **Hours from ERP projects or timesheets**, for overtime and cost splits | `POST /v1/timesheets` |
| ERP → HRMS | **Acknowledgements**: the ERP's own document number for each journal and payment batch it books, or its reason for rejecting one | `POST /v1/gl-postings/{id}/acknowledgement` |

#### Who owns what

Every kind of record has **one owner**, set per record type, and where needed per field, on the Integrations screen. Only the owner writes it:

- The other side reads it. A write through the API to what the HRMS owns is refused with the code `owned_by_hrms`, and the reverse with `owned_by_erp`.
- HR's screens are to show ERP-owned fields read-only, marked "Managed in the ERP" — not built yet (§3.6).

| Record | Owner by default |
|---|---|
| People, their dated history, org structure, positions, leave, attendance, pay results, tax | HRMS |
| Chart of accounts; payments once made | ERP |
| Cost centres | ERP, since finance usually keeps them — switchable to HRMS |

#### How a change travels

- **HRMS to ERP.** A change commits together with its event, through one outbox, so there is never an event for a change that did not happen. The ERP receives the event as a signed webhook, or reads it from the pull feed.
- **Business documents are acknowledged.** For journals, payment batches and remittances, the ERP **acknowledges** with its own reference, or **rejects** with a reason. The HRMS screen shows the state — "Booked in the ERP as JV/2026/0912", or "Rejected: account 5010 is closed" — and HR can resend after fixing.
- **ERP to HRMS.** The ERP calls the API with its own credentials, an idempotency key and its own record id. The HRMS validates the write exactly as its screens would, records it in the change log with the ERP as the actor, and emits the resulting event.
- **No echoes.** Every event carries the client that caused it, and a client is not sent its own changes back by default. The two systems never bounce an update between them.
- **Conflicts.** Updates carry `If-Match`. A stale write is refused with `412`, and the ERP re-reads and retries. Anything that cannot be applied automatically lands in a **sync issues** queue on the Integrations screen, with the payload, the reason, and retry or discard.
- **Catching up after an outage.** The ERP reads everything changed and deleted since its last sync; the HRMS replays webhooks from the first one that failed.

#### What HR can see

The Integrations screen shows, for the ERP's connection:
- its health and the last event delivered;
- deliveries pending and failed;
- the sync issues queue;
- the acknowledgement state of every journal and payment batch;
- a **reconciliation report**: every posted journal, whether it was sent and acknowledged, the ERP's reference, and totals compared.

#### What the client's developers get

All built in phase 12:

- **The guide**: `API.md` in the repository — connecting, conventions, keeping a copy in step, events and webhooks with verification code, writing, the payroll flows, errors and retries, the sandbox, and a generated reference of every scope, event type, error code and endpoint.
- **The contract**: OpenAPI 3.1 at `/api/v1/openapi.json`, rendered at `/developers`, with an example for every event and most endpoints.
- **A reference "mock ERP"** (`tools/mock-erp`): a small program written from the guide alone that does what the client's ERP will do — takes a token, syncs employees and deletions, pushes a cost centre, is refused what it does not own, hears a hire as a signed webhook and in the feed, never hears its own changes, books a journal and confirms payments. It runs in the test suite and in CI against the built app, so both directions are proven on every change, and it is sample code for their team.
- **A local sandbox**: the seed's sandbox clients and `npm run sandbox` (§4.3). A hosted sandbox is a phase 25 item.
- **A certification checklist** (`API.md` §11): what their ERP must do before production credentials are issued.

### 9.3 The integration API

The contract every phase from 12 onwards follows. Phase 12 built it as described here, except `?include=`, asynchronous bulk jobs and deprecation headers, which arrive with the first phase that needs them. For integrators the reference is `API.md`; this section is the design.

#### Principles

- **One set of rules.** Business logic moves into a service layer that the screens' Server Functions and the API both call. The API can do exactly what the screens can, with the same validation, permissions, change log and access log — never a second, weaker path.
- **The API keeps up with the screens.** Every phase ships its endpoints and events with its screens. A feature is not done until the ERP can use it.
- **The contract only grows.** Within `v1`, changes are additions. Anything that would break the client's ERP waits for `v2`, and `v1` stays available alongside it until the client has moved.

#### Access

| Part | What |
|---|---|
| Clients | Each connected system is a registered client: a name, the companies it may see, its scopes, and optionally the IP addresses it may call from. HR creates, suspends and rotates clients on an **Integrations** screen. The client's ERP is one client; the mock ERP and any later system are others. |
| Tokens | OAuth 2.0 **client credentials**. The client exchanges its id and secret at `/api/v1/oauth/token` for a short-lived bearer token, signed with the same `jose` library the sessions use. Secrets are stored hashed and can overlap during rotation. |
| Scopes | Scopes are the permissions from phase 11: `employees:read`, `employees:write`, `org:write`, `time:write`, `payroll:read`, `gl:read` and so on. **Sensitive fields need their own scope** — `pay:read` for salary, `bank:read` for bank accounts, `tax_ids:read` for PAN. Without it, those fields are absent from the response, not empty. |
| Devices | Attendance devices (phase 17) are a restricted client type that may only send punches. |
| Accountability | Every call is logged with its client, route, status, duration and a correlation id. Reads of personal data go to the access log, and writes to the change log, with the client recorded as the actor. |

#### Conventions

| Topic | Rule |
|---|---|
| Shape | REST over HTTPS with JSON under `/api/v1`, plural resource names, and `snake_case` fields throughout |
| Identity | Each record has a stable `id`, and can also carry the ERP's own id — `{"external_ids": {"erp": "EMP-0042"}}`. The ERP finds records by its own keys and never has to store ours. |
| Dates and money | Dates are `YYYY-MM-DD`; timestamps are ISO 8601 in UTC. **Money is a decimal string with its currency** — `{"amount": "72000.00", "currency": "INR"}` — never a float, the same rule as paise in the database. |
| Effective dating | Dated records say `valid_from` and `valid_to`. `?as_of=2025-06-01` answers "what was true then", and `/history` returns every slice. This is the time-slice engine, exposed. |
| Listing | Cursor pagination (`?limit=` and the returned `next_cursor`), filters per resource, `?fields=` to choose fields, and `?include=` to embed related records |
| Syncing | `?updated_since=` returns what changed, and `/v1/deletions?since=` what was deleted, so the ERP can keep an exact copy by polling. The change log makes both possible. |
| Safe writes | `POST` accepts an `Idempotency-Key`: the same key returns the first result instead of acting twice. Updates use `ETag` and `If-Match`, so neither system silently overwrites the other. |
| Bulk | Large imports and exports are asynchronous. They return `202 Accepted` and a job resource to poll, or a `job.completed` event. |
| Errors | RFC 9457 problem details with a stable machine `code` and a sentence a person can act on — the same rule as §8.12 of the design language |
| Limits | Per-client rate limits, with `RateLimit` headers and `429` plus `Retry-After` |
| Versions | `Deprecation` and `Sunset` headers on anything scheduled for removal, and a changelog the client's team can follow |

#### Events

| Part | What |
|---|---|
| Envelope | **CloudEvents 1.0** JSON: `id`, `type` (such as `employee.hired`), `source`, `time`, `subject` and `data`. `data` carries the record as the API would return it, filtered by the client's scopes, plus the client that caused the change. |
| Written with the change | Through the phase 10 outbox, **in the same batch as the change that caused it** |
| Webhooks | Signed to the **Standard Webhooks** specification (HMAC over id, timestamp and body), so the client's ERP can verify them with a published library in any language. Delivery is at least once, with retries backing off, then parked for replay. Each record carries a sequence number, so the ERP can tell which event is newer. |
| Pull feed | `/v1/events?after=` returns the same events, for when the ERP would rather ask than be told |
| Catalogue | Every event type is listed at `/developers` with an example, and grows phase by phase |

#### What the API covers, and from which phase

| Module | Read | The ERP can write | From phase |
|---|---|---|---|
| Organisation | companies, areas, departments, jobs, positions, reporting lines | cost centres, and accounts where the ERP owns them | 12 |
| People | employees and every infotype, with `as_of` and history; documents | guided actions such as hire, with the same checks as the screens | 12, then 14 and 20 |
| Time | holidays, absences, leave requests, quotas, attendance | absences, leave requests, timesheets, punches | 12, then 16 and 17 |
| Payroll | periods, runs, results with lines, payslips, bank files, GL postings, remittances, payment batches | one-off and recurring payments, payment confirmations, journal acknowledgements | 12, then 18 and 19 |
| Tax | declarations, register, Form 16 | challan deposits | 12, then 21 |
| Recruitment | requisitions, candidates, applications, offers | applications | 12, then 22 |
| Performance and learning | cycles, appraisals, goals, courses, certifications | training completions, certificates | 12, then 23 |
| Integration | events, deletions, jobs, sync issues, acknowledgement states | acknowledgements | 12 |
| Reporting | report data and monthly metrics | — | 24 |

### 9.4 How the phases are ordered

Most roadmap features need the same capabilities, and none of them exists yet. Building each once, first, is cheaper than building it badly inside the first feature that needs it.

| Shared capability | Built in | Needed by |
|---|---|---|
| **Notifications, an outbox and background jobs** | 10 | reminders, accrual, escalation, the ERP's webhooks, payslip and report delivery, certificate expiry |
| **A change log** — every write, before and after | 10 | correction requests, transfers, imports, regularisation, the API's change tracking |
| **Permissions and an approval engine** — roles from permissions, configurable approvals, delegation | 11 | API scopes, corrections, headcount requests, confirmations, regularisation, loans, claims, exits, offers, training |
| **The integration API and the two-way link with the client's ERP** | 12 | every later phase's endpoints and events |
| **Document generation** — records rendered to PDF | 13 | payslip PDFs, letters, offer letters, settlement statements, 12BA, scheduled reports |

After those, modules follow their dependencies. People move through the organisation (joining, moving, leaving), time comes before the payroll that pays it, and statutory payroll before the tax that depends on it. Part B comes last, because it waits on other people rather than on other code.

#### Decided in this plan

Technical choices that need nobody's input, taken here so Part A can proceed without waiting.

| Decision | Choice | Why |
|---|---|---|
| API style | REST with webhooks and a pull feed | The client's team can build against it in any language, and every client library, gateway and monitoring tool handles it. |
| Machine authentication | OAuth 2.0 client credentials, issued by this system with `jose` | A standard their developers already know, with no third-party account and no per-token cost |
| Event format and signatures | CloudEvents 1.0, signed to the Standard Webhooks specification | Both are published standards with verification libraries in every language, so the client's team writes no crypto. |
| API specification | OpenAPI 3.1 generated from the zod schemas that validate requests | The specification cannot drift from the code. |
| API documentation | Scalar, served from this application | Readable, renders OpenAPI 3.1, needs no account |
| Background jobs | A job table in the database, processed right after the request that queued it and by a scheduled tick | No external service or account; works on any host. A queue service can replace it later without changing any caller. |
| Email | Every email is built and written to the outbox through a pluggable transport, which records instead of sending until phase 25 | Everything that sends mail can be built, previewed and tested now. |
| Document storage | The database, as today, until R2 in phase 25 | It exists, and the switch is already written. |
| PDF rendering | Built in phase 13: drawn directly with `@cantoo/pdf-lib`, which also encrypts. The first choice was headless Chromium printing the existing HTML; a browser was judged too heavy to start in serverless jobs, and protection needed a PDF library anyway. | One small dependency, fast, and the same data as the page, so the two cannot disagree. |
| Careers-page protection until keys exist | Rate limits and a honeypot field | Works without an account; Turnstile adds to it in phase 25. |
| Attendance devices until a vendor is chosen | CSV upload and a generic punch endpoint | Every device can export CSV, and any middleware can call an endpoint. |
| Continuous integration | GitHub Actions running typecheck, lint, tests, build, the UI audit and the mock ERP against a local database | Needs no secrets, because tests never touch Turso. |

### 9.5 Part A — done

Phases 0 to 24 are all built; §11 History has what each one delivered, and where it differs from what was planned here. What is left is Part B, below — phase 25, which waits on the client and on outside services rather than on more building.

### 9.6 Part B — phase 25, outside input

**Goal.** Finish what Part A built up to the edge of another party: switch on the outside services, and take the client's ERP live.

Each item names who has to act, what they provide, and what it switches on. Part A leaves every one of them ready, so the work here is configuration, a small adapter where noted, and testing.

Three of these came out of the client's own feedback on the prototype (§11) and are decisions rather than configuration: who creates users, whether each company gets its own address, and which database holds HR data. None of them should be guessed at, and each changes what gets built.

| Item | From | What they provide | Already built in Part A | What it switches on |
|---|---|---|---|---|
| **Who signs in, and how** | The client, with you | A decision: **single sign-on from the ERP** (we accept its tokens and map its groups onto roles here), or users created in the HRMS and kept in step through the API. If SSO: which protocol (OIDC is the assumption), the issuer, and a test client. | Roles, permissions, scopes and sessions, all read from the database on every request, so access can be granted by a mapping rather than by hand; `sec_app_user` already carries an employee link | People getting access without the seed, and one place to create them |
| **One deployment or one per company** | The client | A decision: one organisation holding several companies (how it works today), or a hostname per company with its data apart — `company1.hr.example`. If the latter: who owns DNS, and whether a company's data must be in its own database or only separated within one | Companies, personnel areas and departments as first-class records; scope on a role already limits someone to their own companies | Whichever separation the client actually needs, before there is production data to migrate |
| **The move to MySQL** | You, with the client | Where production MySQL lives: an instance of ours, or HR data inside the client's own ERP database — with its host, version and who administers it. Turso is the prototype's convenience and is not the production database. | One data layer behind `src/lib/db.ts`, Drizzle migrations, and a test suite that runs against a file database — so the port is a driver, a dialect for the migrations, and re-running the suite | Production on MySQL, which is what the client expects to run |
| **The client's ERP go-live** | The client, with you | Agreement on the ownership of each record type (the default table in [Who owns what](#who-owns-what)); the address their ERP receives webhooks on, or confirmation that it will read the pull feed; the result of the certification checklist; a secure exchange of production credentials. **If their ERP expects this module to call its API** rather than receive events, their API specification, address and credentials, for an outbound adapter written here. | The full API in both directions, events, ownership, acknowledgements, sync issues, reconciliation, the mock ERP, the local sandbox, documentation | Live two-way data between the HRMS and the client's ERP |
| **A hosted sandbox** | You | A second Turso database, and the deployment settings pointing a preview deployment at it | The seed, the sandbox configuration, the mock ERP | A shared environment where the client's developers test against the real API before production |
| **Email delivery** | You | A choice of provider (Resend is the recommendation), an account and API key, and a sending domain with SPF, DKIM and DMARC records at your DNS host | Every email, built, queued and previewable in the outbox; the transport interface | Email notifications, payslips by email, interview invitations, scheduled reports by email, offer emails |
| **Cloudflare R2** | You | R2 enabled on the Cloudflare account, and an API token with object read and write | The R2 driver, tested against signed requests | Documents stored in R2 instead of the database; existing ones keep being read from where they are |
| **E-signature** | You | A choice of provider (Leegality or Digio recommended, for Aadhaar eSign), a contract, and API credentials for a test account | Offer letters as PDFs, acceptance tracking, the offer states | Offers signed online, with the signed document stored |
| **Careers-page protection** | You | A Cloudflare Turnstile site key and secret, from the same Cloudflare account | Rate limits and the honeypot | Human verification on public applications |
| **Attendance devices** | You, or the client's operations team | Which devices are installed (make and model), and how their data can be reached — the vendor's cloud API, its export format, or middleware — plus a device or sample data to test with | CSV upload and the generic punch endpoint | Punches arriving from the devices automatically |
| **Scheduling frequency** | You | Confirmation of the hosting plan: if scheduled jobs can only run once a day, either a plan that allows them every minute or an account with a queue service; and a `CRON_SECRET` in Vercel | The job table, its self-continuing runner and the daily tick | Reminders, escalations and webhook retries on the minute rather than on the next request or the daily tick, and a tick only Vercel can call |
| **Government format validation** | Someone with EPFO and TRACES access | Running the generated ECR through EPFO's upload and the 24Q file through the government's validation utility, with the company's real UAN and TAN details | Both files generated to the published formats | Files the authorities accept, and fixes for anything their tools reject |
| **Payroll compliance review** | A payroll or compliance professional | A review of the statutory calculations — PF, ESI, professional tax, LWF, gratuity and TDS — against current law and rates | Every rate as dated data, so a correction is a row edit | Confidence to run the parallel payroll that §10 requires |
| **The Turso token** | You | A rotated token, in `.env.local` and in Vercel | — | Closes the exposure from the token being pasted into chat |

**Done when**
- The client's ERP passes the certification checklist in the hosted sandbox, and then exchanges data both ways in production.
- A real email arrives from the company's domain and passes SPF and DKIM.
- New documents land in R2.
- An offer is signed online.
- The government's tools accept the ECR and 24Q files.

### 9.7 Every phase ends with

The conventions in §7.1, plus:

- [ ] The migration generated, **read** (drizzle-kit drops `ON DELETE` on added columns), and applied to production.
- [ ] Tests for every engine and repository change, and a mutation check for anything that computes money, tax or leave.
- [ ] `npm run audit:ui` clean as every role, including new roles and screens, at 1280 and 375 pixels.
- [ ] CI green, the change log recording new writes, and the access log recording new sensitive reads.
- [ ] Every new Server Function and route checks a permission and has a row in the authorisation matrix.
- [ ] From phase 12, **the phase's API endpoints and events ship with its screens**:
  - built in the service layer;
  - added to the OpenAPI specification;
  - in the event catalogue with an example;
  - covered by the contract tests;
  - exercised by the mock ERP where the client's ERP will use them.

  Nothing breaking inside `v1`.
- [ ] HANDOVER.md updated as §1 says: §3 rewritten, the phase moved from §9 to §11, anything else it changed.
- [ ] Committed as tfthushaar with no attribution lines, pushed, CI green, and the Vercel deployment green.

### 9.8 If one company must go live on payroll first

The order that gets there, before the rest of Part A:

1. Phases 10, 11 and 12 — the foundations and the link to the client's ERP.
2. Phase 18 — statutory payroll and the journal.
3. Phase 21 — tax.
4. Phase 15's import, to load the company's employees and year-to-date figures.
5. The phase 25 items that payroll needs: the ERP go-live, the hosted sandbox, email delivery, government format validation and the compliance review.

Then the company runs payroll in parallel with its current one, as §10 requires, and everything else follows.

### 9.9 Every roadmap feature, and where it lands

Kept to what belongs in the HR module of an ERP for an Indian company. Features built so far are in §11.

| Feature | Why it matters | Phase | Status |
|---|---|---|---|
| Notifications | Leave asked for and decided, payslips ready, self reviews due and ratings finalised reach the right person in an inbox with an unread count, and by email once a provider is connected. Each person chooses what they hear about. | 10, email delivery in 25 | built, delivery in 25 |
| Change log viewer | Every change, by whom and when, with the value before and after — on each employee's record and across the organisation, alongside the read log. | 10 | built |
| Roles and permissions screen | Defining roles from permissions, instead of three fixed roles. | 11 | built |
| Configurable approvals | Who approves what, set by HR rather than code. | 11 | built |
| Delegate approvals | A manager on leave hands their queue to someone for the dates they are away. | 11 | built |
| Two-way integration with the client's ERP | This HRMS is a module of the ERP the client is building. The two must exchange data in both directions through an API: the HRMS sends people, organisation, time and payroll changes and the payroll journal as they happen; the ERP sends back what it owns — accounts and cost centres, payment confirmations, earnings and deductions that start on its side — and acknowledges what it received. A documented contract their developers build against, with a sandbox to test in. | 12, go-live in 25 | built, go-live in 25 |
| Request a correction | Employees can see their record but must ask HR to change it. A request that HR approves keeps the dated history intact. | 13 | built |
| Year-to-date on the payslip | Gross, tax and PF so far this year, which employees need for their own filing. | 13 | built |
| Payslips by email | Posted payslips delivered as a PDF, password-protected. | 13, delivery in 25 | built, delivery in 25 |
| Installable phone app | The phone layouts already exist; a web app manifest and a service worker make it installable. Payslips are not kept offline: nothing personal stays on the phone. | 13 | built |
| Onboarding checklists | Laptop, accounts, documents, induction — tasks assigned from the hire action and tracked to done. | 14 | built |
| Probation and confirmation | A due date from the hire date, and a direct HR action to confirm, extend or end it. | 14 | built |
| Transfers and promotions as actions | Guided actions like hiring, writing org assignment and pay together, effective from a date. | 14 | built |
| Letters from templates | Appointment, experience and relieving letters filled from the record and stored as documents. The offer letter (phase 22) is merged separately, from the CTC breakdown rather than the template store — one letter, one shape, nothing yet asking for a second. | 14, 20 | built |
| Headcount requests | A manager asks for a new position; approved through HR and finance, it opens vacant, ready for recruitment to open a requisition against. | 15 | built |
| Bulk import | Load positions, employees and opening balances from a spreadsheet, with a check before anything is written. | 15 | built |
| A drawn org chart | The hierarchy as boxes and lines, not only an indented list. | 15 | built |
| Policies by grade | Different entitlements for different grades or locations. | 16 | built |
| Regional holiday calendars | Holidays differ by state; today there is one national list. | 16 | built |
| Leave accrual, carry-forward and lapse | Entitlement earned monthly, part carried into next year, the rest lapsing, per policy. | 16 | built |
| Leave balance forecast | What the balance will be on a future date, counting approved leave and accrual. | 16 | built |
| Compensatory off | Time off earned for working a holiday, with an expiry. | 16 | built |
| Leave encashment | Paying unused leave, on exit or yearly, through payroll. | 16 | built |
| Shift rosters | Who works which shift on which day, for plants and support teams. | 17 | built |
| Attendance devices | Import punches from biometric devices instead of recording attendance by hand. | 17, vendor adapters in 25 | built, vendor adapters in 25 |
| Team attendance regularisation | Approve a forgotten check-in or a missed punch. | 17 | built |
| Salary structures and CTC | Components by grade, a CTC letter, and the breakdown shown to the employee. | 18 | built |
| ESI, professional tax, LWF, employer PF | Statutory deductions and contributions still missing — see §10.md. | 18, compliance review in 25 | built, compliance review in 25 |
| ECR file for EPFO | The monthly provident fund upload in EPFO's format. | 18, validation in 25 | built, validation in 25 |
| Split cost centres | One person's cost shared across projects by percentage. | 18 | built |
| Accounting export | The payroll journal as a file, for audit, and as a fallback when the link to the ERP is down. | 18 | built |
| Loans and advances | EMI schedules with an outstanding balance, recovered through payroll. | 19 | built |
| Reimbursement claims | Claims with bills and approval, paid through payroll. | 19 | built |
| Exit management | Resignation, notice period, clearance from each department, and full and final settlement. | 20 | built |
| Full and final settlement | Leave encashment, notice recovery and gratuity in one off-cycle run on exit. | 20 | built |
| Investment proofs (Form 12BB) | Employees upload rent receipts and 80C proofs against their declaration; HR verifies them before the year-end tax recalculation. | 21 | built |
| HRA computed from rent | The exemption worked out from salary, rent and city, not typed in. | 21 | built |
| Tax regime comparison | Shows an employee their tax under both regimes from their own figures before they choose. | 21 | built |
| Form 12BA | Perquisites statement, issued with Form 16. | 21 | built |
| Section 89 relief | Relief on arrears that belong to earlier years. | 21 | built |
| 24Q return file | The quarterly return generated from the register, ready for the government's validation utility. | 21, validation in 25 | built, validation in 25 |
| Careers page | Applicants apply to open requisitions directly, with a resume upload. | 12, Turnstile keys in 25 | built |
| Interview scheduling | Rounds with their own interviewer, time and place; a calendar invite built on request and queued in the outbox for the candidate. Proposing several slots for the candidate to pick remains. | 12, invitations 22, slots and email in 25 | mostly built |
| Structured scorecards | Criteria and weights per job; a round's notes cannot be recorded until every criterion is rated. | 22 | built |
| Offer letters with e-signature | Built from the CTC breakdown, sent to the candidate's own link, which records their accept or decline and converts them on acceptance. Signing online is phase 25. | 22, e-signature in 25 | built, e-signature in 25 |
| Referral tracking | Who referred whom, and the referral bonus through payroll once the hire is still employed after the qualifying days. | 22 | built |
| Recruitment analytics | Time to hire, time in stage, source effectiveness, offer acceptance, drop-off by stage. | 22 | built |
| Goal check-ins | A progress update either side can add, through the year — not only at the review — with a weekly reminder while one is overdue. | 23 | built |
| 360-degree feedback | Peers, a manager, reports and self all contribute; peer answers are shown only in aggregate, once three have replied. | 23 | built |
| Calibration distribution | The spread of ratings as a bar list, against a guideline, during calibration. | 7 | built |
| Improvement plans | A plan with goals and dates for someone who is struggling, checked in on and closed with an outcome. | 23 | built |
| Training catalogue and nominations | Courses and their sessions; a nomination is refused once it would take its department over its training budget for the year. | 23 | built |
| Certification expiry | Alerts before a safety or professional certificate lapses, to its holder and their manager; a report flags anyone whose job needs one they do not hold. | 23 | built |
| Trends over time | A 24-month headcount trend, backfilled from the time-slice engine and kept current; cost and attrition stay a today figure, not yet trended. | 24 | partly built |
| Leave liability | Every encashable balance priced at its own daily rate — what finance would provide for if it were all cashed out today. | 24 | built |
| Scheduled reports | A report rendered to CSV and queued to someone's inbox on the 1st of the month. | 24, email delivery in 25 | built, email delivery in 25 |

---

## 10. Production readiness

What it would take to run real people's pay on this system rather than a demo organisation. The prototype is feature-complete against its blueprint, tested, audited and deployed; none of that makes it production software. Items are grouped by when they must be done:

- **Before real data** — before any real employee's personal data goes in.
- **Before the first real payroll** — before the system pays anyone.
- **After go-live** — needed for a system people depend on, but not blocking day one.

Each item says why it matters, because the reason decides how much effort it deserves. Many are built in Part A (§9.5); this list is what must be true, whichever phase delivers it.

### 10.1 Before real data

#### Identity and sign-in

| What | Why | What to do |
|---|---|---|
| Replace demo sign-in | One click signs anyone into the HR administrator account. That is the point of a demo and the end of a real system. | Set `DEMO_SIGN_IN=off` and delete the three seeded accounts. |
| Single sign-on | Staff should use the company's identity provider, so leavers lose access the day they leave and passwords are not stored here. | OIDC or SAML against Microsoft Entra ID or Google Workspace. Keep the `jose` session, mint it after the provider's callback. |
| Multi-factor authentication | An HR account can read every salary and bank account. | Enforce MFA at the identity provider for every role, and step-up for payroll release and posting. |
| Revocable sessions | The session is a signed cookie valid for eight hours; there is no way to end it early. A stolen laptop keeps access for the rest of the day. | Keep a server-side session record the cookie points at, so sign-out and "sign out everywhere" actually end the session. |
| Rate limiting on sign-in | The password form has no limit on attempts. | Limit by account and by IP, with lockout and an alert. Moot once single sign-on replaces passwords. |
| Accounts follow employment | Today accounts are seeded by hand and not tied to hire or termination. | Create the account at hire, disable it on the termination date, automatically. |

#### Secrets

| What | Why | What to do |
|---|---|---|
| **Rotate the Turso token now** | It has been pasted into chat transcripts more than once. Anyone with it can read and change every record. | Rotate in the Turso dashboard, update Vercel and `.env.local`. |
| One set of secrets per environment | Production, preview and local share one database and one token today. | A database and a token per environment; production secrets only in Vercel's production scope. |
| Secret scanning | So the next leak is caught at the commit, not afterwards. | Enable GitHub secret scanning and push protection. |

#### Who can see and do what

| What | Why | What to do |
|---|---|---|
| The real roles | Every screen and Server Function now checks a permission, and HR builds roles from them on the Roles and permissions screen; a Recruiter role ships as the example. Nobody has yet decided which roles the client actually needs. | Agree the roles with the client — HR generalist, payroll administrator, recruiter, auditor (read-only) are the usual set — and create them. |
| Maker and checker | One person can today change a salary, run payroll, post it and generate the bank file. The approval engine exists (phase 11) and enforces two different people for bank changes an employee asks for (phase 13), but HR's own edits, payroll release, posting and the bank file are single-person. | Route salary changes above a threshold, payroll release, posting and the bank file through the approval engine, with a second approver. |
| Scope beyond the employee record | A role can be limited to companies or personnel areas, and that limit holds on the employee list, the record, people search, documents and the employee export; API clients are limited to their companies on every resource. Payroll, time, tax and performance screens are still organisation-wide for anyone holding their permission. | Apply the same scope to those screens, through the service layer as their modules move onto it. |
| Connected systems | The ERP's client id and secret open everything its scopes allow. | Issue production credentials over a secure channel, grant only the scopes it uses, set its address allowlist, and rotate its secret on a schedule. |

#### Protecting personal data

| What | Why | What to do |
|---|---|---|
| Encrypt sensitive fields | Bank account numbers, PAN and Aadhaar sit in plain text; a database leak exposes them directly. | Application-level encryption for those columns, with keys outside the database; decrypt only where shown. |
| Mask by default | The profile masks the bank account; HR screens do not. | Mask everywhere, reveal on an explicit action, and log the reveal. |
| Keep data in India | The Turso database is in `aws-us-west-2`. Indian employee data leaving India needs a reason and a contract. | Move the database to an Indian region (AWS ap-south-1) or document the transfer basis. |
| Security headers | No content security policy, HSTS or frame protection is set. | Add CSP, HSTS, `frame-ancestors 'none'`, `Referrer-Policy` and `Permissions-Policy` in `next.config.ts`. |
| Scan uploads | Uploads are checked by content type but not for malware. | Scan on upload (for example ClamAV in a function, or a scanning service) before the file can be downloaded. |
| Keep dependencies patched | The production dependencies are clean today; `npm audit` reports four moderate issues in development tooling. That changes weekly. | Dependabot or Renovate with automatic security updates, and `npm audit --omit=dev` in CI. |
| A penetration test | Nobody has attacked this system on purpose yet. | Before go-live, by someone independent. |

#### The Digital Personal Data Protection Act, 2023

| What | Why | What to do |
|---|---|---|
| Privacy notice | Employees must be told what is held, why, and for how long. | A notice at first sign-in, recorded as seen. |
| Retention schedule | Payroll records must be kept for years under tax and labour law; other data should not be kept forever. | A schedule per record type, agreed with legal counsel, and a job that applies it. |
| Correction requests | Built (phase 13): employees request changes on My profile and HR approves them into the dated history. | Agree with legal counsel how quickly requests must be answered, and set the flow's escalation to match. |
| Breach response | The law sets deadlines for notifying the Board and the people affected. | A written runbook, and contacts at Turso, Vercel and Cloudflare. |
| Processor agreements | Turso, Vercel and Cloudflare process employee data. | Data processing agreements with each. |
| Candidates' data | Applicants agree on the careers site to their details being kept to consider them; nothing removes them afterwards. | Delete or anonymise unsuccessful candidates after a period agreed with legal counsel. |
| Log retention and review | The read log and the change log exist; nobody reviews them and nothing ages them out. The change log also holds personal data as it was before each change. | Keep each for a defined period, review unusual access such as bulk exports, and include both in the retention schedule. |

### 10.2 Before the first real payroll

#### Statutory coverage in India

Phase 18 closed the gaps this section used to list: employer PF, EPS, EDLI and the admin charge are calculated; the ECR file is generated (to the published format — validating an actual file against EPFO's own tools is still open, below); ESI and professional tax are calculated, including ESI's contribution-period rule and Maharashtra's February slab; the labour welfare fund is calculated; and the standard deduction, the 87A limits, the cess rate and the PF wage ceiling are now dated rows (`py_tax_constant`, `py_pf_rate`), not constants in code. What is left:

| What | Why |
|---|---|
| **The ECR file against EPFO's own tools** | Generated to the published format from this build's own reading of it; an actual file has not been validated against EPFO's upload tool or a real UAN. |
| **Gratuity accrual, and bonus** | Gratuity is calculated and paid at exit (phase 20); provisioning the liability for the active workforce, ahead of anyone actually leaving, is not. The Payment of Bonus Act applies to many salaries and is not calculated at all. |
| **Income tax completeness** | Surcharge above ₹50 lakh; a concessional loan's perquisite value reaches Form 12BA (phase 21) but is not yet added into monthly TDS itself, only into the year-end certificate; income from a previous employer in the year (Form 12B). Proof collection and verification (phase 21), HRA from rent (phase 21) and section 89 relief (phase 21) are no longer gaps. |
| **The 24Q return, against the government's own utility** | Generated as a best-effort reading of the published Annexure I/II layout (phase 21), the same spirit as the ECR file; validating an actual file against the FVU has not been done. |
| **Form 16 as issued** | Part A is downloaded from TRACES and Part B is issued by the employer, digitally signed. The certificate here is a faithful computation, not the issued document. |
| **ESI and professional tax wage bases** | Both read the same taxable-earnings figure TDS already computes, not the narrower "ESI wages" or "PT wages" the law separately defines (which exclude some non-taxable reimbursements). A reasonable prototype simplification, worth a real audit's attention before go-live. |

#### Running payroll safely

| What | Why | What to do |
|---|---|---|
| **A parallel run** | The only real proof a payroll is right. | Run alongside the existing payroll for two or three payroll cycles and reconcile every payslip to the paisa before switching over. |
| Retro limits | Retro sees records *added* after a month was paid, not records deleted, and stops at the financial year. | Read deletions from the change log, which now records them, and extend retro across the year end with the tax effect on the right year. |
| Bank formats and reconciliation | The bank file is a generic NEFT CSV. Banks each have their own bulk formats, and failed credits come back. | Formats per bank (or host-to-host), and reconciliation of what was actually credited. |
| Payroll inputs cut-off | Inputs can change up to the moment of the run. | A cut-off date per period after which changes go to next month or through retro. |

#### Data migration

| What | Why |
|---|---|
| Import from the current system | Every employee, their dated history, year-to-date pay and tax already deducted. Without year-to-date figures, the TDS projection assumes months before go-live were paid at today's rate — a documented approximation, not a substitute. |
| Remove the demo organisation | Acme Manufacturing, the three employees, candidates and appraisals are seeded into the production database today. |
| Verify the import | Headcount, salary totals and year-to-date tax reconciled against the old system before anyone is paid from the new one. |

### 10.3 After go-live

#### Environments and data

| What | Why | What to do |
|---|---|---|
| Separate databases | Local development currently points at production unless told otherwise. One mistake in a script changes live records. | Turso databases for production and preview; local development on `file:.local/dev.db` by default. |
| Migrations in the pipeline | Migrations are applied by hand from a laptop. | Apply them in CI before the deploy that needs them, and fail the deploy if they fail. |
| Backups you have restored | Turso keeps point-in-time history; nobody has tried restoring from it. | Schedule a restore drill, and write down how long it took. |
| Employee pickers that scale | Forms that choose an employee list everyone. Fine at hundreds, unusable at thousands. | A searchable picker that queries as you type, like the command menu. |
| Cloudflare R2 | Documents are stored in the database until R2 is enabled. Fine for resumes, costly for years of payslips and proofs. | Enable R2 on the account and set the four variables — see §3.7. |

#### Operations

| What | Why | What to do |
|---|---|---|
| Error monitoring | Errors surface only in Vercel's function logs today. | Sentry or similar, with the error boundary's digest linked. |
| Uptime and alerts | `/api/health` exists; nothing watches it. | An uptime check every minute, alerting whoever is on call. |
| Payroll-day runbook | Payroll day is when an outage costs most. | What to check before, during and after a run, and who decides to delay payment. |
| Load test | Payroll has run for three people and for test organisations, not for five thousand. | Run a 5,000-person month against a copy of production and time each stage. |
| Email delivery | Notifications reach the inbox, and emails are written to the outbox, but nothing is sent: no provider is connected. | Choose a provider, verify the sending domain (SPF, DKIM, DMARC) and switch the transport on — phase 25. |
| Job frequency | Vercel Hobby runs the scheduled tick once a day. The runner keeps itself going between ticks, but weekly reminders — and a webhook retry when nothing else is running — wait for the day's tick. | Set `CRON_SECRET`, and on a paid plan tick every few minutes. |

#### Quality

| What | Why | What to do |
|---|---|---|
| Protect `main` | GitHub Actions runs typecheck, lint, `npm test`, a build and `npm run audit:ui` on every push and pull request, but nothing stops a red commit reaching `main`. | Require the CI check and a review before merging. |
| End-to-end flows | Unit and integration tests cover the engines; nothing drives hire → pay → Form 16 through the browser. | Playwright journeys for the main flows, using the same drivers the UI audit uses. |
| Accessibility with real assistive technology | The automated audit catches perhaps a third of accessibility problems. | Walk the main flows with NVDA and VoiceOver, and fix what they find. |

#### For the people using it

| What | Why |
|---|---|
| Configuration screens | Leave policies, allowance percentages and statutory constants are seed data or code. HR should change them without a developer. |
| Help and training | Short guides for each role, and inline help on the payroll and tax screens where a mistake costs money. |
| A support route | Who employees ask when their payslip looks wrong, and how HR escalates to whoever maintains the system. |

### 10.4 Go-live checklist

- [ ] Demo sign-in off; demo accounts and demo organisation removed
- [ ] Single sign-on with MFA; sessions revocable
- [ ] Turso token rotated; secrets separated per environment
- [ ] Roles, maker-checker and company scoping in place, with an authorisation test per Server Function
- [ ] Bank, PAN and Aadhaar encrypted at rest and masked by default
- [ ] Database in an Indian region, or the transfer documented
- [ ] Privacy notice, retention schedule and breach runbook agreed with legal counsel
- [ ] Employer PF, ESI, professional tax and the ECR file in place for every state you employ in
- [ ] Data migrated and reconciled, including year-to-date pay and tax
- [ ] Two or three parallel runs reconciled to the paisa
- [ ] Separate production database, backups restored at least once, migrations in CI
- [ ] Error monitoring, uptime alerts and a payroll-day runbook
- [ ] Independent penetration test passed
- [ ] The client's ERP certified against the checklist in `API.md`, with production credentials issued securely and an address allowlist

---

## 11. History

What each phase delivered, newest first, and where the build differed from its plan. When a phase in §9 is finished, it moves here.

### Client feedback, round one — 7 Oct 2026

The client went through the prototype and sent a list. Everything on it that was a bug, a missing rule or a missing screen was fixed; what is left is decisions only they can take, which are now written out for them in README's "What we need from you" and in §9.6. Migration 0025 carries the three new columns and the data rows the fixes need.

- **A requisition has to describe the role before it opens.** `description` (40 characters at least), `skills`, the least experience and the hiring manager are required on every save, not only on publishing — the client found an open role with none of them. The validation that existed ran at publish time, which is why opening one looked unchecked.
- **A refused form no longer loses what was typed.** React 19 resets an uncontrolled field to its `defaultValue` once a form action returns, so a long form that failed one check came back blank. `saveRequisition` now echoes the submitted values in its `ActionState`, and the form reads its defaults from those — the reset then restores what was typed instead of what was loaded. The same trick fits any long form that needs it later.
- **A filled role stops taking applications.** `requisitionClosedReason(requisitionId)` is the one rule — open, and not already at its own number of openings in offers or hires — and all three ways in go through it: HR's screen, the careers page and a referral. `publishedRoles()` filters the same way, so a filled role leaves the careers page. A declined offer counts as rejected rather than offered, so the opening frees itself.
- **Scorecards are HR's list, not the software's.** `rc_scorecard_template` existed and was enforced from phase 22, but only the seed could write it. New **Recruitment → Scorecards** screen keeps the criteria per job, with a weight and an order; a criterion already scored on a round is made inactive rather than deleted, so what an interviewer recorded is never rewritten by a later change.
- **The candidate's invitation carries the calendar file.** Phase 22 left this as a documented gap ("the file attaches once a real provider sends it"). The outbox's `AttachmentSpec` gained an `"interview"` variant and `renderAttachment` a branch that builds the `.ics` from the round on demand — the same "a recipe, not bytes" rule payslips and reports already follow. The download route's permission check is now a lookup per attachment type rather than an if/else.
- **Referrals carry a resume and the bonus's terms**, and refuse someone already in the pipeline: a candidate who applied themselves cannot be claimed for a bonus, and the reason given is the exact one (already referred, or already applied).
- **A resignation cannot be quietly undone.** The employee could withdraw it after their manager had approved, because the exit row stays `Pending` until every step is decided. Withdrawal is now theirs only while no step has been approved; after that HR cancels it with `revokeApprovedExit`, which is refused once the exit is settled, since by then there is a termination on the record and the answer is a rehire. Their own `/exit` screen lists what they withdrew, with the reason, which is the point of keeping the row.
- **Notice short of the period reaches payroll at approval**, not at settlement: `completeExit` works out the shortfall with the same `noticeShortfallDays` the settlement uses and tells everyone holding `payroll.run`, so it can be recovered or waived while there is still time to decide.
- **Retirement is HR's to record.** The self-service form offered it in a dropdown; `submitExit` now fixes the type at `Resignation` whatever the form sends.
- **A change request says who asked and who it waits on.** The employee's own screen showed "Waiting" and nothing else. It now names the requester (and marks a connected system as one) and, while pending, whoever the request is actually sitting with, read from `wf_assignee` at the request's current step.
- **"While I am away" only appears for people who approve something.** `isApprover(userId, employeeId)` asks whether requests can reach them at all — people report to them, a flow step names their role or them, or they can override a process — so a senior engineer is no longer offered a hand-over of approvals they do not have.
- **The bank form says which account it is replacing.** The full number is still never read back to the screen; the masked current one is shown beside the field instead, which is what the client was missing.
- **A claim needs its bill.** Every line must carry one, on the screen and in the action. A claim arriving already approved from the ERP is unaffected: it comes in through the service, not the form.
- **Employees can clock in and out.** `punchNow` writes exactly the `pt_punch` row a device writes, against a `WEB` device, with `source = 'Web'` — so the attendance engine needed no change at all. The time is always now; a time someone chooses is a correction, which still goes to their manager.
- **Optional holidays.** `pt_holiday.is_optional` and `pt_holiday_calendar.optional_allowance`. An optional holiday is left out of every company-wide holiday set (quota, payroll, time evaluation), so it is an ordinary working day until someone takes it — and taking it writes a paid absence of its own type, `OPTH`, which means payroll, time evaluation and the team calendar all handle it with no special case. The allowance is counted per year from those absences, so there is no second table to keep in step.
- **Training a manager assigns, and follows.** `nominate` accepted any `employeeId` from anyone holding `self.training`, so an employee could nominate a colleague — now it is yourself, your own reports (by the same reporting line approvals use), or anyone with `training.manage`. Someone put forward by their manager is told. My training grew a "My team's training" card for anyone with reports: nominate, then follow it to whether they attended.
- **Voluntary provident fund.** `pa_it0011_statutory_details.vpf_basis_points`, dated like every other fact there, and one more line in the payroll engine: a percentage of basic on top of the statutory 12%, deliberately *not* capped at the PF wage ceiling (the ceiling bounds what is compulsory, not what someone may add), and the employer's share never follows it.
- **Finance is a role you can sign in as.** It existed from phase 14 holding only `org.view`, for the budget step on a headcount request. Migration 0025 gives it payroll, tax, reports and the outbox, and the seed adds Deepa Rao, so "should there not be a finance persona" can be answered by clicking it.
- **The API answers "what will I get?" for every endpoint.** The reference generated into API.md documented request bodies but showed a response for only 4 of 75 endpoints. It now prints a response field table and a response example for every one, built from the endpoint's own response schema — deterministic, so regenerating never churns the file, and impossible to drift from the code. A short "The contract, in short" section at the top names the OpenAPI document as the contract of record and shows one exchange end to end, which is what the client asked for.
- **Screens**: **Recruitment → Scorecards** (new) · Reports, My leave (optional holidays), My attendance (clock in and out), My training (the team card), My profile (who asked, who it waits on, the masked account), the exit board ("Cancel exit"), Resign (no type dropdown, and earlier resignations listed).
- **Where it differs from what was asked**: user creation is deliberately not built — the client's own note says it should be the ERP's job or integrated with it, and building a second place to create people before that is decided would be the wrong thing to own. Per-company URLs (`company1.hr.example`) and single sign-on from the ERP are both decisions with real architectural weight and are written up for the client rather than guessed at. A resume is still stored rather than parsed. The demo has no posted payroll month, so payslips and Form 16 appear only once one is run — the empty states now say exactly how.

### Phase 24 — Analytics

- **Headcount as of any month, from one narrow function**: `headcountAsOf(date)` is the exact COUNT the live Reports page already ran, pulled out of `reports()`'s own batch so it can be called on its own for 24 different dates without recomputing payroll cost and leave by type each time. `rp_snapshot` (month, measure, dimension, value) stores the result once a month is behind it; a past month, once snapshotted, never changes — nobody backdates a hire after the month has closed — but the current month is recomputed on every run, since headcount within it can still move.
- **Backfilled once, not waited for**: `backfillHeadcountSnapshots` fills every missing month in the trailing 24 the first time it runs — the daily job, or the seed, whichever gets there first — because the time-slice engine answers "who was employed then" for any date with no approximation; a month twenty-three ticks away is no harder than yesterday.
- **Leave liability, assembled from what `encashLeave` already trusts**: `leaveLiabilityAsOf` is read-only arithmetic over the same pieces that function already calls to price an actual encashment — `balancesFor`, `policyFor`'s own cap, what has already been encashed this year, `dailyRatePaise` (now exported, previously used only inside `encashLeave`) — summed across every employee and quota type instead of paid out for one. Nothing is posted; it is only ever asked.
- **Scheduled reports render on demand, the outbox's own convention extended rather than replaced**: `AttachmentSpec` gained a `"report"` variant alongside the existing `"payslip"` one, and `renderAttachment` a matching branch that builds the CSV fresh each time from `renderReportCsv` — never stored, the same "a recipe, not bytes" rule the payslip attachment already followed. The one download route's permission check, written narrowly for payslips, now branches on the attachment's own type: `payroll.view` for a payslip, `reports.view` for a report. `rp_schedule` (report, recipients) is read on the 1st of the month, inside the same guard `runLeavePolicyTicks` already uses for its own once-a-month accrual, and each recipient gets their own outbox row — one dedupe key per address, not one shared across all of them, which would have queued the first recipient and silently dropped the rest.
- **Screens**: **Reports** extended with the 24-month trend (a bar list, one bar a month — the one chart primitive this app has, rather than a second kind of chart for one new line) · a **leave liability** figure · **"Schedule this report"**, with the schedules already set below it.
- **Where it differs from the plan**: trends cover headcount only — payroll cost, overtime and leave by department and location were not built, since nothing in "done when" exercised them and today's Reports page already shows cost and leave as a current figure, not a trend, with no seeded history to trend them against yet. Reports render to CSV only, not PDF — there is no tabular-report PDF precedent in this codebase to extend, and the plan itself offered CSV as the alternative. No `/v1/reports/{name}`, `/v1/metrics`, or `report.delivered` event — every "done when" criterion is a computation or a scheduled delivery, not an integration, the same call every phase since 21 has made.

### Phase 23 — Performance and learning

- **Goal check-ins are a timeline, not a record two people take turns editing**: `pm_goal_checkin` (date, status, comment, `author_type`) gets a new row from either side — the employee through `self.appraisal`, their rater through `mayRateEmployee`, the same reports-to-them check goals and ratings already use — rather than one row with an employee slot and a manager slot. A daily step, mirroring the self-review reminder's own weekly dedupe key, tells everyone with an open goal and no check-in in the last seven days, once a week.
- **360 feedback, with peer answers held back until three exist**: `pm_feedback_request` (cycle, reviewee, reviewer, relationship) and `pm_feedback` (one row per competency). `requestFeedback` is HR or a rater asking, gated the same `mayRateEmployee` way goals already are; `submitFeedback` needs only a session — the data decides, since only the named reviewer's request matches their own employee id. `peerFeedbackSummary()` is the anonymity threshold itself: averages by competency once three `Peer`-relationship requests are `Submitted`, `null` before that — manager, report and self feedback are never threshold-gated, shown as given.
- **Improvement plans, without a workflow of their own**: `pm_pip` (reason, goals, dates, outcome) and `pm_pip_checkin`, created and closed directly under `performance.manage` rather than routed through the approval engine — nothing in "done when" asked for a second approver, and HR opening one already is the decision. Passing to exit (phase 20) on a failed outcome is a manual next step, not an automatic one.
- **A nomination is refused at the point it would break a budget, not before**: `ld_department_budget` (department, year, allocated). `decideNomination` sums every already-`Approved` nomination's session cost for the nominee's own current department and the session's year, and refuses the decision — leaving the nomination `Requested` — if adding this one would pass what was allocated; checked at decision time, since the budget or the queue ahead of it can move between asking and deciding.
- **Certifications, checked against what the job actually requires**: `ld_certification` (issuer, issued, expiry, its document — reusing the employee document store's existing `"employee"` owner type with a new `"Certification"` kind, not a new table) and `ld_certification_requirement` (job, certificate name). A daily step warns a certificate's holder and, through the same `resolveApprovers("reporting_manager")` the approval engine itself calls, their manager, once — `reminded_at` guards it the same way a probation reminder already does. `certificationComplianceReport()` joins requirements against current employees' jobs (through their position, not a `job_code` the org assignment itself does not carry) and what each still validly holds, for who is missing one.
- **Screens**: **360 feedback** — ask, see every request, and the aggregate once it is safe · **Improvement plans** — open, check in, close · **My appraisal** extended with each goal's check-in history and a form either side can use, and feedback requests waiting for an answer · a new **Training** area — catalogue (courses and sessions), nominations (decide, record attendance), budgets, compliance, and my training (nominate, keep certifications on file).
- **Where it differs from the plan**: calibration's distribution chart already existed from phase 7 — nothing new was needed for "the distribution moves as calibrated ratings change" beyond the test confirming it still does. No `/v1/goals`, `/v1/courses`, `/v1/sessions`, `/v1/nominations` or `/v1/certifications`, and no `appraisal.finalised`/`training.completed`/`certification.expiring` events — every "done when" criterion is a reminder, a computation or a refusal, not an integration, the same call phases 21 and 22 made; 360 feedback was never going to be exposed regardless, to protect its anonymity. Two new permissions, `training.manage` and `self.training`, joined the catalogue rather than overloading `performance.manage`'s own meaning.

### Phase 22 — Recruitment

- **Scorecards, enforced at the point notes are saved**: `rc_scorecard_template` (criterion, weight and order per job) and `rc_scorecard` (one row per interview per criterion). `recordInterviewFeedback` reads the round's job's active criteria and refuses to save — with the missing criterion named — until every one has a rating, submitted in the same form as the round's own rating, recommendation and notes rather than a separate step; a role with no template behaves exactly as before.
- **Interview invitations, without a slot-picker**: scheduling a round now also queues a confirmation email to the candidate (`announceInterview`, extended to take their name and email, not just their name) and builds an .ics file on request at `GET /api/recruitment/interviews/{id}/ics`, gated the same way the round's own page is — the assigned interviewer, or anyone running recruitment — with a "Download invite" link on that page. The interviewer's own existing in-app notification already becomes an email by default through their notification preferences, so nothing new was needed on that side.
- **An offer is a real record, not a number on the application**: `rc_offer` (CTC, structure, joining date, expiry, the merged letter, status, a token). Making an offer now asks for the annual CTC and a salary structure rather than a flat monthly figure, runs it through `previewCtc` (phase 18's own CTC breakdown — no second calculation to keep in step with payroll's), merges a plain-text letter, and emails the candidate a link to `/careers/offer/{token}` — a page with no sign-in, reached only by the token, matching the careers site's own public pattern. **Above the requisition's budgeted band needs `recruitment.hire`**, not just `recruitment.manage` — the same, more senior permission that already turns an offer into an employee — rather than a new approval chain for a check this narrow.
- **Accepting is the same hire conversion, called from a second place**: `convertToEmployee`'s whole transaction — employee, five infotypes, the position freed, onboarding started — was pulled out into `performConversion`, callable from the HR-driven action exactly as before and from the candidate's own `respondToOffer`, which records the time and address of their reply, then calls it with the offer's own joining date and CTC. One way an employee comes into existence, reached from two doors. Declining reuses the existing `stageStatements` rejection path — the application keeps the stage it reached, same as any other rejection.
- **A referral is tracked from the moment it is made**: "Refer someone", open to every employee (`self.profile`, not a recruitment permission), creates or reuses the candidate — duplicates are now caught by phone as well as email, in this path, `saveCandidate` and the careers page alike — applies them to a role if one is named, and opens an `rc_referral` row with a flat default bonus and qualifying period. A new daily step, `payQualifyingReferrals`, finds every referral whose hire has passed that period: still employed, it queues the bonus on the IT0015 rail every other one-off payment already shares (wage type `REFERRAL`); not still employed, it is forfeited rather than paid. Either way it is never revisited, since both outcomes leave `status` off `Pending`.
- **Analytics as plain counts and averages, not a stored snapshot**: `recruitmentAnalytics()` computes time to hire, time in each stage, source effectiveness, offer acceptance and drop-off by stage directly from `rc_application`, its stage history and `rc_offer` — no new table, since every figure is derivable from records already kept. Shown as bar lists, reusing the one chart primitive the app has rather than building a second.
- **Screens**: **scorecards** inside the interviewer's round page, and a **"Download invite"** link there · the **offer form** rebuilt around CTC, structure, joining and expiry, and the application page's "Offered" state showing the real offer's status · the candidate's own **offer page**, public · **"Refer someone"**, for every employee, with their own referrals below the form · **Recruitment analytics**, a new tab.
- **Where it differs from the plan**: no `rc_interview_slot` — HR schedules one fixed time, as before; proposing several for the candidate to choose from was cut, since no "done when" criterion exercised it, in favour of the invitation and scorecard work the criteria do test. The offer letter is a plain merged string, not a stored, HR-editable template — one letter, one shape, with nothing yet asking for a second. No `/v1/applications`, `/v1/offers` or `/v1/referrals`, and no `candidate.applied`/`offer.sent`/`offer.accepted` events — every "done when" criterion is a computation, a screen or a payment, not an integration, so the API layer was left for a later pass rather than built speculatively, the same call phase 21 made. Turnstile itself is still phase 25, unchanged; nothing here touches the existing rate limit and honeypot.

### Phase 21 — Tax completeness

- **Proof verified against a window HR opens**: `tds_proof_window`, one row per financial year (`opensAt`/`closesAt`); `tds_proof`, one row per piece of evidence an employee files against a declared section (80C, 80D or HRA), each with its own document, status and who decided it. `effectiveDeclarationAmounts` is where this actually bites: while a year's window is open, or none has been set yet, a declaration's three figures are used exactly as declared, unchanged from before this phase; once closed, each is capped to no more than what was actually verified for that section — never more than what was declared, only less, if proof fell short. `loadFacts` — the one function every payroll calculation already reads its facts through — and Form 16 generation both call it, so a month's TDS and the certificate it adds up to can never disagree about what counted.
- **HRA from rent, not typed in**: `tds_rent` holds one monthly figure, landlord and city per employee per year. `hraExemption` is section 10(13A)'s own three-way minimum — actual HRA received, rent less 10% of basic, 50% (metro) or 40% (elsewhere) of basic — never negative. The declaration screen shows it alongside the raw figure a declaration still stores, rather than replacing how TDS reads that figure; entering rent is what feeds the smaller of the three into it.
- **The regime comparison is payroll's own arithmetic, not a parallel one**: `compareRegimes` runs `computeAnnualTax` once per regime on the same projected gross and declared figures and returns both, which is the whole guarantee — it cannot disagree with what a month's TDS deducts, because nothing but that same function produced either number.
- **Form 12BA, from what phase 19 already computed**: `tds_perquisite` is populated by reading `py_loan_schedule.perquisite_value_paise` for every instalment due in the year and summing it per loan (`generate12BA`, keyed so recomputing replaces rather than piles up) — the first thing to read a figure that phase had already stored but nothing yet consumed. Shown on the Form 16 page itself, as the plan's own screen line asked for, not a screen of its own.
- **Section 89 relief, as Form 10E actually works it out**: `section89Relief` is the arithmetic — the extra tax arrears cost in the year paid, less what they would have cost in the year they relate to, never negative — and `computeArrearsRelief` is the orchestration: arrears are read from `py_payroll_result_line` where `wage_type_code = 'RETRO'` and the instalment's own `for_period_id` falls in the earlier year (the tag retro already carried before this phase, now put to use), and that earlier year's actual income comes from its own already-issued Form 16 rather than a recomputation that could drift from what was really assessed.
- **The 24Q file**: `engines/tax-returns.ts` writes Annexure I (challan and deductee detail, every quarter) and Annexure II (the full salary computation, fourth quarter only), caret-separated — a best-effort reading of the published layout's key fields, the same spirit as the ECR file in phase 18: validating an actual file against the government's own utility is phase 25.
- **Screens**: a new **Proof verification** tab (the window, and every proof waiting on a decision) · the **declaration** screen extended with rent, filing proof, and the regime comparison · the **Form 16** certificate extended with Form 12BA and a Section 89 relief working, exactly where the plan's own screen line put them, rather than screens of their own.
- **Where it differs from the plan**: no `/v1/tax/...` API surface or `form16.issued`/`proof.verified` events were built — every "done when" criterion is a computation or a screen, not an integration, and the API layer was left for a later pass rather than built speculatively. `tds_rent` holds one figure for the whole year, not a dated history of rent changes within it — a reasonable simplification given nothing in "done when" exercised a mid-year change. Employee PAN, held nowhere before this phase, now lives on the existing statutory-details infotype (`pa_it0011_statutory_details.pan`) rather than a new table, the same slice Form 16 already drew UAN and ESI number from.

### Phase 20 — Exit and full and final settlement

- **A resignation, approved like any other request**: `pa_exit` (type, reason, the day asked for, notice days, the approved day once decided, a waived flag, rehire eligibility) goes through its own "exit" flow — reporting manager, then anyone holding HR_ADMIN — the same `planRequest`/`writeRequest`/`decide` engine every other process already uses; `workflow/exit.ts` only fixes the approved day at the one asked for and tells the employee. Nothing about the record changes yet: that waits for the last day.
- **The last day, run by the daily job**: `processExitsDue` finds every exit approved with its last day arrived and not yet exited, and `settleExit` does the rest in one call — the termination through the time-slice engine (a new `action_type`), `employment_status` and `termination_date` set (the same pair payroll's proration, time evaluation and leave eligibility already read), the position freed, and sign-in disabled by clearing the same `sec_app_user.is_active` flag the sign-in action already checks — no new check there, just the same gate turned off. An offboarding checklist starts alongside it (`startOffboarding`, the same shape `startOnboarding` writes, against a template with its own `event = 'offboarding'` — a column the schema anticipated back in phase 14). A manual "Settle now" on the exit board runs the identical function, for whenever HR does not want to wait for the day's tick.
- **Gratuity, under the 240-day rule**: `gratuityYears` counts completed years from the hire date, plus one more once at least 240 days have passed in the year after the last completed one — section 2A's own figure for a full year of "continuous service", read into section 4(1)'s five-year eligibility the same way case law does, so four years and 240 days is treated as five. `computeGratuity` is then 15/26 of the last basic for each of those years, capped at ₹20 lakh. Below five years, nothing is paid.
- **Every component, one off-cycle run**: leave encashment pays out whatever balance is left, quota type by quota type, bypassing the annual encashment cap `encashLeave` already enforces for someone still employed (a new `ignoreAnnualCap` flag on it — the balance itself is still never exceeded, only the policy's per-year ceiling on cashing it out while still working, which has no bearing on a final exit); a notice shortfall is recovered at the last basic over a flat 30-day month, unless HR waives it; gratuity and the outstanding loan's full balance (`recoverLoanAtExit`, the same "delete what is unqueued, close the loan" shape `closeLoan` already has, but queuing the balance as one recovery instead of writing it off) join whatever claims were already approved and still unpaid — all of it queued onto `py_it0015_additional_payment`, the one rail every other one-off payment already shares, then paid together by a single off-cycle run for that one employee. The statement (`py_settlement`, `py_settlement_line`) is assembled afterwards by reading back exactly what the run paid — salary from the result, every component from the payments it claimed — a deduction's amount negated so the statement reads as a recovery rather than a payment.
- **Screens**: the **exit board** for HR (clearance progress, a "waive notice" toggle, "Settle now") · **Resign**, for the employee (the form, status while it is decided, the settlement statement and the exit interview once settled).
- **API and events**: `GET /v1/exits`, `GET /v1/settlements` with every component; clearance tasks were already generic over `GET /tasks`, and relieving and experience letters over `GET /letters` — neither needed a line of code. `employee.resigned` on approval and `employee.exited` on settlement both derive from `pa_exit` reaching that status, alongside the existing generic `employee.status_changed` derived from `pa_employee` itself; `settlement.paid` derives from `py_settlement`'s own creation.
- **Where it differs from the plan**: the mock ERP's own scenario does not drive a resignation through approval and settlement end to end — that needs an HR session clicking through decisions and a payroll period already locked for running, neither of which the ERP's API-credential-only simulation can do on its own. `employee.exited` and `settlement.paid` deriving correctly, and `GET /exits`/`GET /settlements` answering to schema, are covered instead by a dedicated test and the generic contract test every endpoint already gets. "Buyout" — the company paying for notice it chooses to waive working out, rather than recovering a shortfall the employee leaves early — was not built; only the recovery direction was, since nothing in "done when" exercised the other one.

### Phase 19 — Loans and reimbursements

- **Loans and the EMI schedule**: `py_loan` (type, principal, rate, tenure, EMI, status, the approval request) and `py_loan_schedule`, generated once in full the moment a loan is approved — `computeEmi` (the standard reducing-balance formula; 0% just divides the principal evenly) and `generateSchedule` work out each instalment's interest on the balance it opened the month with, the rest recovering principal, with the last instalment absorbing whatever rounding left the others short, so the balance always closes at exactly zero — the same "last split absorbs the remainder" convention phase 18's cost splits already used. Each instalment reaches payroll through `py_it0015_additional_payment`, the one-off-payment rail leave encashment and overtime already queue onto, so the payroll engine itself needed no change to deduct it exactly once; a loan closes itself the moment its last instalment is queued.
- **Prepayment and a concessional loan's perquisite value**: a prepayment reduces the balance at once and regenerates every instalment not yet queued from the smaller balance at the same EMI — what shortens is how many instalments are left, not their size — and closes the loan if it clears the balance entirely. `py_loan_benchmark_rate` holds the dated rate rule 3(7)(i) compares a loan against: `monthlyPerquisite` is nothing below the ₹20,000 aggregate-principal exemption or once the loan's own rate already meets the benchmark, otherwise the rate gap on the opening balance, every month — computed and stored per instalment now, for phase 21's Form 12BA to read; nothing yet feeds it into TDS itself.
- **Claims, checked against their category's limit at submission**: `py_claim_category` (fuel, phone, medical, LTA — seeded with medical taxable, matching the 2018 budget folding the old medical-reimbursement exemption into the standard deduction) and `py_claim_category_limit` for a grade-specific override, most-specific-match first and falling back to the category's own default — the same precedent the leave policy engine already set for its own overrides. "Grade" is the existing `pa_it0008_basic_pay.pay_scale_group` field, the same concept headcount requests already call grade, not a new one. A claim's bills attach to its lines (a new `claim_line` owner type on the existing generic document store) and, once approved, it is queued as one `py_it0015_additional_payment` on CLAIM or REIMB by the category's own taxability — one wage type per taxability, not one per category, kept deliberately simple.
- **One rail, reached two ways**: a claim is approved either through the HRMS's own flow — manager, then anyone holding the Finance role — or arrives already approved from the ERP's own process through `POST /v1/claims`, checked against the same category limit either way (an HRMS payroll and tax policy the ERP's process has no reason to enforce itself) and paid through the same queueing step, `engines/claims.ts`, shared by both paths rather than duplicated. It sits apart from `services/claims.ts`, which calls the approval engine, so that `workflow/claim.ts` — itself loaded by the approval engine — can call it without the import cycle that would otherwise make, the same separation `engines/loans.ts` already kept from `services/loans.ts`.
- **Screens**: **Loans and claims** administration (claim categories, the benchmark rate) · **claim approval** with bills shown side by side · **My loans** (ask, a prepayment's effect on the schedule) · **My claims** (submit with bills, withdraw while pending).
- **API and events**: `GET /v1/loans`, each with its full schedule inline, so the ERP can book the receivable the moment `loan.approved` fires; `POST /v1/claims`; `loan.approved`, `loan.closed` (derived however a loan reaches Closed — the last instalment queued, a full prepayment, or HR closing it by hand, so none of the three paths is silently missed), `claim.approved`, `claim.paid`.
- **Where it differs from the plan**: the perquisite value is computed and stored, as planned, but nothing reads it yet — Form 12BA and TDS integration are phase 21's own work, not pulled forward. There is no `GET /v1/claims` or `POST /v1/loans`: a loan is asked for and decided inside the HRMS and only ever read outward; a claim the ERP sends already approved is paid, never read back through this resource — asymmetric on purpose, since each direction has exactly one system of record.

### Phase 18 — Salary structures and statutory payroll

- **Salary structures and CTC**: `py_salary_structure` names a shape (seeded: Standard, basic 40% of CTC, special allowance balancing) and `py_salary_structure_component` says how each wage type in it is worked out — a percentage of CTC, a percentage of basic, a fixed amount, or Balancing (exactly one per structure: whatever the others do not account for). `py_employee_ctc` is a dated slice like basic pay itself. Saving a CTC derives its structure's basic through the time-slice engine — the same mechanism a hire or a promotion uses — and its balancing allowance as a recurring payment, ending whatever was open before rather than stacking a second one; payroll's own reads of basic pay and recurring payments need no change to pick either up. `computeCtcBreakdown` solves the one real circularity — ESI eligibility depends on gross, and gross depends on the balancing line — in two passes: the first assumes no ESI, and only if the gross it produces is still within the ceiling does a second pass add the employer's share.
- **Statutory rates, all dated**: `py_pf_rate` (employee and employer PF, EPS as a share of the employer rate, EDLI, the admin charge, the wage ceiling), `py_esi_rate`, `py_professional_tax_slab` (per state, with a February-specific row where a state has one, beating the general row for the same band — Maharashtra's ₹200 eleven months and ₹300 in February reaches its ₹2,500 annual cap exactly), `py_lwf_rate` (per state, due only in its own cycle month), and `py_tax_constant` — the standard deduction, the 87A rebate and the cess rate `engines/tax.ts` used to hold as literals, seeded with the exact values the code held, so the switch to reading them is value-neutral. A new infotype, IT0011 (`pa_it0011_statutory_details`: UAN, ESI number, the state professional tax follows), was wired straight into the existing generic sliced-infotype machinery (`core-hr.ts`'s `SLICED_FORMS`, `infotypes.ts`) rather than a screen of its own — the same tab, history and time-slice engine basic pay and bank details already use.
- **A new wage-type kind, `EmployerContribution`**: employer PF, EPS, EDLI, the admin charge, employer ESI and employer LWF are computed alongside the employee-side deductions they sit beside, shown on the payslip as their own lines, and excluded from gross, deductions and net by the same filter that already separated Earning from Deduction — no change to that arithmetic was needed, only more lines of a new kind. ESI locks in for a whole contribution period (April–September, October–March): eligibility checks the current month's wages against the ceiling, or a prior ESI deduction earlier in the same period already loaded for retro, so a raise mid-period does not end it. Professional tax and LWF read the employee's own IT0011 state.
- **Posting extended, not replaced**: `postToLedger` debits an employer contribution to a new expense account (5030) and credits it to the wage type's own account, the same debit-expense/credit-liability shape a deduction already had, just doubled. `py_gl_mapping` overrides a wage type's GL account per company, checked before its own default. `py_cost_split` fans an employee's earnings and employer-contribution expense across more than one cost centre by percentage — rounded per split, the last absorbing the remainder so the total never drifts — in place of the single cost centre on their org assignment; the per-employee, per-wage-type aggregate the posting action already built just gained a cost-centre dimension inside it. Statutory remittances extend to ESI, professional tax and LWF authorities alongside PF and TDS, each its own due date.
- **The ECR file**: EPFO's published pipe-delimited ("#~#") format, eleven fields a member — UAN, name, PF/EPS/EDLI wages, employee and employer PF, EPS, NCP days, refund of advances — generated from a completed run's PF lines and each employee's UAN; a best-effort implementation of the public format, since validating an actual file against EPFO's own tools is phase 25. The GL journal also downloads as a CSV, the same pattern the bank file and the payroll-run export already used, for audit and as a fallback when the link to the ERP is down.
- **Screens**: **Salary structures** (a plain master list, each one opening to its own components editor that submits the whole set at once, since exactly one of a handful of rows must be Balancing) · **Statutory rates** (one screen, five sections — PF, ESI, professional tax, LWF, income-tax constants — each a compact list behind its own "Add", a lighter sibling of MasterScreen built for several master-data lists sharing one page) · **GL mapping** · a **CTC** tab on the employee record (revise CTC, its history, a live monthly breakdown at today's rates, and cost splits) · **Statutory details** alongside Bank details.
- **API and events**: `/v1/gl-postings`, `/v1/payment-batches` and `/v1/remittances` already existed and are generic over every line and every authority, so employer contributions, cost-centre splits and ESI/professional-tax/LWF remittances reach them, and the `gl.posting.created` event, without a line of code changed — the same "generic pass-through" the IT0015 payment rail proved in phase 16. What is genuinely new: `GET /salary-structures`; `ctc` and `statutory_details` as two more `record` kinds on the already-generic `GET /employees/{id}/history`; and `remittance.paid`, firing when a remittance already fetched through `/remittances` is marked paid.
- **Where it differs from the plan**: `/v1/payroll/periods/{id}/statutory-files` was not built — the ECR file is reachable today only through the authenticated screen download, not yet through the integration API, which would need the plain Next.js download route the ECR and GL-journal exports use to accept an API token as well as a session cookie. The ESI file and professional-tax/LWF summary files the plan mentioned alongside the ECR were not built either; the remittance rows (with their own authority, amount and due date) are what the API and the Statutory remittance screen expose instead, and nothing in "done when" needed a file for them specifically. Professional tax and LWF read gross from the same taxable-earnings figure TDS already computes, not a separately defined "ESI wages" or "PT wages" basis that excludes non-taxable reimbursements the way the real law's wage definitions do — a reasonable simplification for a prototype, noted here because it is the kind of difference a real payroll audit would ask about.

### Phase 17 — Attendance and shifts

- **Shifts and rosters**: `pt_shift` (start, end, a break, a grace period, and a night flag for one whose end is earlier than its start — it crosses midnight and belongs to the day it started) and `pt_roster_pattern`, a repeating cycle of shifts (`pt_roster_pattern_day`, one row per day of it). Assigning a pattern to a team and a date range writes `pt_roster` — day 0 of the cycle is the date it was assigned from, so assigning the same team, pattern and start date again writes the same roster, safe to repeat. A single day is then edited by exception without touching the rest.
- **Punches into attendance**: a daily job (`engines/attendance.ts`) turns a rostered day's punches into one `pt_attendance_day` row — first in, last out, worked minutes, a late mark past the shift's own grace period, and overtime past its own length — everything it needs (the roster, the shifts, the punches) read once for the whole batch, the same shape as time evaluation and payroll. A night shift's punches are read from its own start to its own end, not one calendar day. Overtime is logged as an attendance entry for the record, and paid at double the hourly rate (basic pay over the month's own working days, over an 8-hour day) as an IT0015 one-off payment — the same table leave encashment uses, so payroll pays it through the next run with no overtime-specific code of its own.
- **Devices and punches**: `pt_device`, optionally tied to a phase-12 API client — a physical clock, or any middleware in front of one. `POST /v1/punches` takes a batch; a punch missing its own device uses the one the calling client is registered as. Punches are unique on device, time and employee, so a re-sent batch, or a re-uploaded CSV, writes nothing twice.
- **Regularisation**: an employee's own account of a day — claimed in and out, and why — through a new one-step approval (their reporting manager, falling back to HR exactly as any step with nobody to fill it does). Approved, it adds the claimed times as punches from a "Regularised" pseudo-device and re-runs the same finalising logic a real punch would have triggered, so the day is corrected exactly as if the punch had never been missed; rejected, the day stands as its real punches show it.
- **Screens**: **Shifts**, **Roster patterns** (with each pattern's own day-by-day grid on its own page), **Roster** (a bulk assignment form and the week ahead, by employee and day), **Today's board** (in, late, absent, with a "run it now" for a day already past), **Devices**, and **My attendance** (punches, history and "ask for a correction") — all new tabs under Time, alongside a **My attendance** entry in Self-service.
- **API and events**: `POST /v1/punches`, `POST /v1/timesheets` (hours against the ERP's own projects, recorded as attendance), `GET /v1/rosters`, `GET /v1/attendance-days`; `attendance.day_finalised`, `regularisation.decided`.
- **Where it differs from the plan**: the roster planner is a bulk-assign form and a plain week-ahead table, not a drag-and-drop calendar grid — the same information, without the added interactivity a prototype does not need. Overtime's rate is a flat double time, not a configurable multiple by shift or day type (a Sunday or holiday premium is not modelled). A day's "working days" for time evaluation and payroll still comes from the calendar, not the roster — a roster decides a shift, lateness and overtime, not whether the day counts as one of the month's paid working days, which would need a larger change to how those two engines define that count for a rostered employee.

### Phase 16 — Leave policies

- **Regional holiday calendars**: `pt_holiday_calendar` replaces the single national list; every personnel area sits on one (seeded: National, Karnataka, Maharashtra), and a holiday belongs to exactly one calendar rather than a free-text region. The quota engine, time evaluation and the payroll engine all resolve an employee's own calendar — by their personnel area, as of the date in question — so Karnataka and Maharashtra genuinely see different holidays and payroll prorates each against its own, in the same batched read each engine already did.
- **The quota engine is now ledger-backed**: `pt_quota_ledger` holds every credit and debit — accrual, use, restore, carry-forward, lapse, encashment, a manual adjustment — and `pt_it2006_absence_quota` is a running total kept in the same statement as the ledger row that explains it, through one function (`postLedger`) that is the only place either table is written. A balance equalling its ledger's sum is true by construction, not convention, and is covered by its own test.
- **Leave policies** (`pt_leave_policy`) say what a quota type actually grants: how much a year, to whom (by grade and personnel area, the most specific policy winning), accrued monthly or yearly, pro-rated for a joiner or not, a carry-forward cap, a lapse date, how much is encashable, an optional per-request cap, and whether the sandwich rule applies. A daily job accrues whatever period is due and, on each policy's own lapse date, closes last year's balance: up to the cap moves into the new year as its own ledger entry, the rest lapses as another — both dated, both explained, safe to run daily since each is checked against the ledger before it posts.
- **Compensatory off**: recording attendance on a holiday or a weekend (HR's own screen, the direct action this codebase already used for a similar case) earns a comp-off, expiring in 90 days by default. Spending one, on a leave request against the new "Compensatory off" absence type, draws the earliest-expiring grant first and splits one across a partial use rather than wasting or double-spending it; a daily job expires whatever is still unspent past its date.
- **Encashment**: paid at the current daily rate (basic pay over the month's own working days, by calendar) and queued as an IT0015 one-off payment — the same table an off-cycle bonus already uses — so the very next payroll run pays it without any encashment-specific code in the payroll engine itself. Capped by what the governing policy allows for the year, checked against what has already been encashed.
- **Screens**: **Holiday calendars** and **Leave policies** (both plain master-data screens), a calendar picker on Personnel areas, and My leave gained a comp-off figure, a forecast ("on 31 Dec you will have —"), and a ledger detail table answering "why do I have what I have" from the same entries the balance is built from.
- **API and events**: `GET /v1/leave-policies`, `GET /v1/holiday-calendars`, `GET /v1/leave-ledger`, `GET /v1/leave-balances?as_of=` (adds a `forecast_days` projection), and `POST /v1/leave-requests` — writable, so the ERP's own portal can apply for leave exactly as My leave does, provided the employee has a linked sign-in to route the approval to. New events `leave_balance.changed` and `leave.encashed`.
- **Where it differs from the plan**: a policy matches by grade and personnel area only, not employment type — there is no employee-level field for it yet. A comp-off spent against a leave request that is later deleted is not restored, unlike quota-backed leave, which the deletion path already puts back; comp-off's per-grant expiry makes an "unspend" more than a balance nudge, and nothing in this phase's "done when" needed it. The forecast projects monthly accrual only; a yearly grant's exact date is not pinned down, so a yearly-accrual balance forecasts as today's balance, unmoved.

### Phase 15 — Org and data tools

- **Headcount requests**: a manager asks for a new position — department, job, title, grade and a monthly budget — and it goes through a new "headcount" approval flow: the requester's own manager, then HR, then a finance role, each configurable on the Approval flows screen like any other. Approved, it opens the position vacant and budgeted, exactly the way recruitment opens a requisition against any other vacant position; rejected, only the request is marked. A **Headcount requests** screen (top level, not under Org structure, so a manager without `org.view` can still reach it) lists a manager's own requests, or every one for HR. A seeded **Finance** role shows how HR would give the last step to someone real; nobody holds it in the demo, so it falls back to HR, exactly as the engine already does for any step nobody can fill.
- **Bulk import**: one engine, three kinds — positions (against departments and jobs that already exist), employees with the dated records payroll needs, and opening balances. Uploading a spreadsheet checks every row — a natural key, references, required fields — and writes nothing; the report shows what would happen, row by row, before HR confirms it. Confirming writes only the rows that passed, a batch of 100 at a time on the job table, so a file of thousands does not depend on one request surviving. A row whose key is already on record is skipped, which is what makes importing the same file twice a no-op. `POST /v1/imports` runs the identical checks over JSON, so the ERP's own bulk load faces exactly what a spreadsheet does.
- **Opening balances**: what an employee earned, paid in tax, and had left in leave before this system existed. Leave balances write straight into the quota an employee already has; pay and tax add a new `py_opening_balance` row that the TDS projection (`engines/payroll.ts`) now credits for the months it covers, in place of the assumption it always made for months before go-live — paid at today's rate with an even share of tax deducted. A mid-year switchover now taxes the rest of the year correctly instead of guessing.
- **The org chart, drawn**: boxes and hairline connectors in SVG, laid out from the same two hierarchies the existing indented list already walked, with search (which expands and centres on a match without disturbing what you had collapsed), collapse, pan and zoom, and vacancies as an outlined badge. A Chart/List toggle keeps the indented list exactly as it was, as the accessible view — screen readers and keyboard users get a plain nested list, never the canvas.
- **API and events**: `GET /org-chart` as a tree of departments, each with its positions; `POST /headcount-requests` and `GET /headcount-requests`; `POST /imports`, `GET /imports/{id}`, `GET /imports/{id}/rows` and `POST /imports/{id}/confirm`; `headcount_request.decided` and `import.completed`.
- **Where it differs from the plan:** the org-structure import loads positions only, against departments and jobs that already exist, and a position naming one to report to must name one already on record — a spreadsheet loads the managers' positions before the ones that report to them, in a load of its own if needed. Companies, personnel areas and departments stay a by-hand edit on the org screens: rarer, smaller changes that are not worth a spreadsheet's row-by-row validation. An imported employee gets none of a fresh hire's onboarding checklist or probation review — they joined long before today, under a process this system never ran.

### Phase 14 — Joining, moving and letters

- **Onboarding**: hiring someone — from Core HR, from recruitment's conversion, or through the API — starts their checklist from the one active template, each task assigned to their reporting manager or to HR and dated from the hire date; the checklist finishes itself once every task is done. A new **My tasks** screen lists what is assigned to you, and `POST /tasks/{id}/complete` lets the ERP close one it owns, such as issuing a laptop.
- **Probation**: a review is scheduled 90 days from the hire date. HR confirms it, extends it to a new date (the one it replaces stays on record), or ends the employment — the minimal primitive payroll already prorates a leaver by, not phase 20's full exit process. A **Probation due** screen lists what is due or overdue; HR is reminded once, the first time a review enters the window.
- **Transfers and promotions** are guided actions like hiring: one transaction writes the IT0000 action, org assignment and — for a promotion — basic pay, through the time-slice engine, and vacates and fills the two positions. A backdated promotion needs nothing extra: the next payroll run's retro finds the newer basic-pay slice and pays the arrears.
- **Letters**: HR keeps one or more letter kinds (**Letter templates**), each with a body of `{{merge_fields}}`; issuing one merges the template with the record as of the issue date and keeps the merged text verbatim, so it reads the same for good even if the record or the template changes afterwards. The Career tab (a new employee-record tab) shows onboarding progress, probation history and issued letters, with an Issue letter dialog.
- **API and events**: `POST /employees/{id}/actions` (`transfer`, `promotion`, or `confirmation` with an outcome), `GET /tasks` and `POST /tasks/{id}/complete`, `GET /letters` and `GET /letters/{id}/pdf` (re-rendered from the stored text, not the template); `employee.transferred`, `employee.promoted`, `employee.confirmed`, `onboarding.completed`, `letter.issued`.
- **Also shipped this phase** (asked for before it began): HR can delete a connected system that has never really called the API — no calls, deliveries, acknowledgements or sync issues on record; one that has is told to suspend it instead, so its history stays readable.
- **Fixed on the way:** `hire()` and `convertToEmployee`'s "next employee number" both ordered `pa_employee.employee_number` as text to find the highest one — correct only by luck while every number has the same digit count, and already wrong for any row whose number does not start `EMP`. Caught by a test that mixed a hire with a `createPerson` test fixture (whose numbers sort above any real one); both now order by the number itself.
- **Where it differs from the plan:** confirming probation is a **direct HR action**, not an approval — nobody but HR is asked to decide it, so there is no one else to route it to, and the live approval engine's binary decision was left alone rather than generalised for a three-outcome one. For the same reason, the review reminder goes to HR generally, not a specific reporting manager. The transfer and promotion screens are a single form each, not a numbered wizard with a live summary panel — the action is one decision, not the several hiring makes at once. Letters are read-only through the API: the ERP can list and download them, but issuing one — choosing a template — stays HR's own action, the way a letter is actually decided.

### Phase 13 — Self-service and payslips

- **Request a correction**: on My profile, an employee asks for a change to their personal details, an address, a contact or their bank account, from a date, with a note and proof (required for bank). It is an approval request — a new **Corrections** process — decided in the approvals inbox with the record and the request side by side. Approved, it is written through the time-slice engine from its effective date, keeping the history, and the change log says who asked and who approved. They see their requests, and can withdraw one still waiting.
- **Two approvers for a bank change**: HR, then the employee's manager by default; the engine now refuses anyone who approved an earlier step, and flows can have yes-or-no conditions ("only for bank account changes").
- **Year to date** on every payslip, line by line and in total, from the stored lines of the financial year.
- **PDF payslips**: Download PDF on each payslip; one A4 page drawn from the same data as the screen.
- **Payslips by email**: posting a month (or finishing an off-cycle run) publishes each payslip, tells the person, and — with "email payslips" on for the period, the default — queues one email each with the payslip as an AES-256 protected PDF; "Email again" sends one deliberately. The Outbox shows the attachment and opens it as sent.
- **Installable app**: manifest, icons, a service worker that caches only the app's code, and an offline page; checked in a real browser, and by a test that the worker stores nothing personal.
- **API**: `POST /employees/{id}/change-requests` and `GET /change-requests`; year to date and `published_at` on run results; `GET /payroll/results/{id}/payslip` as a PDF; events `change_request.decided` and `payslip.published`. The mock ERP now downloads a payslip.
- **For the client**: `README.md` became a plain-language feature list with a "Coming next" section.
- **Fixed on the way:** an employee could open their own payslip by its address before the month was posted; full-width form fields spanned three columns even in two-column forms, which quietly added a third column to every such form and dialog (now `col-span-full`).
- **Where it differs from the plan:** PDFs are drawn with pdf-lib rather than printed by a headless browser, decided on paper rather than by a spike (§7.3); the password uses name and date of birth because PANs are not held; the service worker keeps no payslips offline, since nothing personal should stay on a phone.

### Fixed after phase 13 — years of duplicated personal data

Found by looking at Arjun's live profile after the phase 13 push: his email, phone and address each showed six to eight times. Three repeating infotypes — addresses, communication and family members — have no unique index, because HR may genuinely record more than one of a type; the seed script's `.onConflictDoNothing()` on those inserts was therefore a silent no-op, and every re-run of `npm run db:seed` against the one production database (every phase since 9 has re-seeded it after migrating) inserted a fresh duplicate of every row. Fixed in two parts: `src/db/seed/personnel.ts` now checks whether a row already exists before inserting; migration 0012 collapses the duplicates already in Turso down to one row per group, matched on every column except `id` and `created_at`, so a row that is genuinely different (a second real address, a second child) is never touched. `tests/seed.test.ts` re-seeds an already-seeded database and fails if anything grows.

### Phase 12 — The integration API, the two-way ERP link, and the recruitment workflow

- **The API**: 47 endpoints under `/api/v1` over organisation, people, time, payroll, tax, recruitment and performance, from one list of definitions that also generates the OpenAPI document, the contract tests and `API.md`'s reference. OAuth client credentials with hashed, rotatable secrets; 18 scopes, with pay and bank behind their own; address allowlists, rate limits, idempotency keys, ETags and `If-Match`, cursor pagination, `fields`, `as_of`, `updated_since` and a deletions feed; RFC 9457 errors that link to `/developers/errors`.
- **Two ways**: the ERP pushes cost centres and GL accounts, changes the employee fields HR hands it, records absences when it owns them, adds one-off and recurring payments, acknowledges or rejects each journal, confirms each salary payment and pays remittances. Its ids live beside ours. Ownership is per record type and per employee field; what cannot be applied becomes a sync issue.
- **Events**: 19 types derived from the change log, sent as signed Standard Webhooks with retries, parking and replay, and served as a pull feed; a system never hears its own changes back.
- **For HR**: the Integrations screens — connect a system and see its secret once, scopes, companies and addresses, secrets and rotation, webhook deliveries with replay, recent calls; record ownership; sync issues; reconciliation of every journal against what the ERP booked. The posting screen shows each journal's state in the ERP and each salary's payment status.
- **For the client's developers**: `API.md`, `/developers`, the mock ERP (`tools/mock-erp`), `npm run sandbox`, and a certification checklist. The mock ERP's 18-step scenario runs in the tests and against the built app in CI.
- **The recruitment workflow, reworked** (asked for during the phase, shipped with it): requisitions describe the role (title, description, qualifications, skills, experience, type, place, budget, hiring manager) and are published on a new public **careers site**, where candidates apply with their resume and consent, protected by a hidden field and a daily limit per address; the candidate hears it arrived and recruiters are told. Each application is **screened** (reject the profile, or take it to interview), goes through **several interview rounds** with different interviewers, times and places, whose interviewers are told and record their own **notes, rating and recommendation** under **My interviews**; then the candidate is **approved or rejected**, offered, and converted. A new permission, `recruitment.interview`, is held by every built-in role and the Recruiter. The API's requisitions and applications carry all of it, rounds included, without the notes.
- **The sidebar folds**: each group's label opens and closes it; the current page's group opens itself, and each browser remembers the rest.
- **Fixed on the way:** the problem `type` pointed at a page with no anchors (now `/developers/errors`); the command menu had no icons for the phase 11 admin pages; the API's request log and idempotency keys were never cleared (now 30 and 7 days); the Outbox screen listed webhook deliveries as if they were emails (it shows emails only; deliveries are on each connected system's page).
- **Where it differs from the plan:** the service layer holds what the API writes rather than every module; HR's screens do not yet mark ERP-owned fields read-only; `?include=`, asynchronous bulk jobs, deprecation headers, a Postman collection and a generated TypeScript client were left for when a phase needs them (the OpenAPI document generates the last two in any tool); the careers site and interview rounds came forward from phase 22.

### Phase 11 — Permissions and approvals

- **Permissions instead of roles.** A catalogue of 29 permissions in ten groups, each one plain sentence; every Server Function, route and page asks for a permission. The three built-in roles hold exactly their old rights (HR also gained My profile, so it can hand over approvals). Permissions are read from the database per request, so changes apply without signing out.
- **Roles and permissions screen.** Create a role, tick what it can do (sensitive permissions marked), limit it to companies or personnel areas, give it to people; built-in roles can be renamed and regranted but not removed; nobody can remove the last person able to manage access.
- **Sensitive fields and scope.** Pay and bank details need their own permissions to see or change. A scoped role sees and changes only the employees in its companies or areas (employee list, record, search, documents, export).
- **The approval engine** with versioned flows, conditional steps, escalation after a number of days, delegation that records on whose behalf, and one **Approvals** inbox across processes. Leave moved onto it; pending leave was adopted by the migration. **Approval flows screen** edits a route as a form and saves a new version.
- **"While I am away"** on My profile.
- **A Recruiter role and demo account** (Neha Iyer): candidates and no pay, on screen and by direct POST.
- **The authorisation matrix**: every Server Function and route as five kinds of person, and a failure if a new function has no row.
- **Fixed on the way:** a manager could set or delete goals for anyone; `employeeCount` and `latestRunForPeriod` were public endpoints with no check (removed).
- **Where it differs from the plan:** scope covers employee records only until phase 12's service layer; a step's condition tests one fact per process and the first step always applies; escalation adds HR rather than moving the request up the reporting line.

### Phase 10 — Notifications, background jobs, the change log and CI

- **Notifications**: an inbox behind a bell with an unread count; five notices (leave asked for and decided, payslip ready, self review due, rating final), each to the right person, exactly once; per-kind preferences; every email built, queued in an outbox and readable on the Outbox screen, recorded rather than sent until a provider is connected.
- **Background jobs**: a database queue with dedupe keys, conditional claims, stale-lock takeover and backoff; work runs after the response and hands off to itself with a signed request; a daily Vercel Cron tick. **Payroll runs became jobs** and finish with the screen closed — the last known gap from phase 9.
- **The change log**: every write, before and after, in words; a tab on each employee record and an organisation-wide view with filters.
- **CI** on GitHub Actions: typecheck, lint, tests, build, and the UI audit against the built app on a fresh local database.
- **Fixed on the way:** a manager could decide any leave request, including their own, by calling the Server Function directly; two approvals at once could both succeed and both take the days; the quota engine read, changed and wrote back. A decision became one transaction with a conditional claim and a quota update that cannot overdraw. CI then caught an email delivery job keyed by the minute, which stranded an email queued after that minute's job had finished; there is now one reusable delivery job and a daily sweep.

### Phase 9 — The finish

- **Role dashboards**; the **command menu**; **documents** (resumes and employee documents through one storage module, recognised by content, downloads permission-checked and logged; the bank file as CSV); **print** stylesheets; designed **loading, error and not-found** states; every screen at **375px** and **accessible** (the UI audit started at 96 findings and ended at none); a **real test runner** replacing ad hoc health-check harnesses.
- **Closed the known gaps from phase 8:** pagination in SQL; lists that queried per row now read in one statement; an access log of reads; payroll in batches that resume; off-cycle runs; retro arrears; joiners and leavers paid by the day.
- **Features beyond the plan:** My profile; employee documents; team calendar; the payroll variance check; CSV exports; birthdays and work anniversaries; HR reports; one-click demo sign-in.
- **Bugs found and fixed:** employees could open the employee list with everyone's salary; TDS over-deducted every month after the first; no section 87A marginal relief; the tax register counted unposted months; the ledger ignored cost centres; a resume link could run script; every text field drew a double focus ring; dates showed as ISO strings.

### Phases 0 to 8 — The original build

| # | Phase | Delivered |
|---|---|---|
| 0 | Toolchain and repository | Per-user installs of Node, Git and the GitHub CLI (no administrator rights on the first machine), the repository, the Turso database, `.env.example` |
| 1 | Foundation | Next.js app, design tokens and component library, Drizzle on Turso, signed-cookie auth with three roles, the first Vercel deploy |
| 2 | Org management | OM-01…08 and the org tree from reporting lines |
| 3 | Core HR | CH-01…05, the time-slice engine, the hire wizard, eight infotype tabs, the as-of view |
| 4 | Time and absence | TM-01…05, the quota engine, request and approval |
| 5 | Payroll | PY-01…05, the payroll engine, period locking, payslips, the error row for missing bank details; the tax engine landed here because payroll needed real TDS |
| 6 | Recruitment | RC-01…05, the pipeline, hire conversion |
| 7 | Performance | PM-01…05, calibration, the increment push into basic pay |
| 8 | Tax and Form 16 | TDS-01…05, Part A and Part B reconciling |
