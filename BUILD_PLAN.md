# Build plan

Developer-facing working document for the HRMS prototype. For what the product does and who it is for, see [README.md](README.md).

Target: **Next.js on Vercel, Turso for data, Cloudflare R2 for documents.** Every phase ends with a commit and a push.

---

## 1. Machine audit

Audited on 26 Sept 2026. Windows 11 Pro 10.0.26200, AMD64, Windows PowerShell 5.1.

### Present

| Tool | Where | Note |
|---|---|---|
| VS Code | `%LOCALAPPDATA%\Programs\Microsoft VS Code\Code.exe` | Installed, but the `code` shim is not on PATH |
| winget | `%LOCALAPPDATA%\Microsoft\WindowsApps\winget.exe` | v1.29.380, working — see the source caveat below |
| wsl.exe | `C:\WINDOWS\system32\wsl.exe` | Shim only. **No distro is installed** |
| .NET runtime | `C:\Program Files\dotnet` | Microsoft.NETCore.App 3.1.32 runtime only, no SDK. Not needed by this stack |

### Missing — everything this build needs

| Tool | Needed for | winget ID | Version seen |
|---|---|---|---|
| Node.js LTS | Next.js, npm, drizzle-kit, every build script | `OpenJS.NodeJS.LTS` | 24.19.0 |
| Git | Version control, pushing each phase | `Git.Git` | 2.55.0.3 |
| GitHub CLI | Auth against the remote without pasting tokens | `GitHub.cli` | 2.101.0 |
| Vercel CLI | Local env pull, manual deploys | npm global, after Node | — |
| Wrangler | R2 bucket management from the terminal (optional — the dashboard also works) | npm global, after Node | — |

### How these were actually installed — winget was not usable

Two blockers ruled winget out on this machine:

1. **The account is not an administrator.** `SUPERCOM-2\AMOG` is a standard user, `EnableLUA=1`, `ConsentPromptBehaviorAdmin=5`. A machine-scope winget install raises a UAC *credential* dialog, which a non-interactive shell cannot answer and which blocks until timeout.
2. **The `msstore` source agreement was never accepted**, so even a bare `winget search` aborts with *"One or more of the source agreements were not agreed to."* Pinning `--source winget --accept-source-agreements` fixes that part, but not the elevation problem.

**Resolution: per-user portable installs, no elevation.** Official upstream archives extracted to `C:\Users\AMOG\tools`, with those paths appended to the persistent user PATH (`HKCU:\Environment`).

| Tool | Source | Installed to |
|---|---|---|
| Node.js 24.21.0 LTS | `nodejs.org/dist/v24.21.0/node-v24.21.0-win-x64.zip` | `C:\Users\AMOG\tools\node` |
| Git 2.55.0.windows.5 | PortableGit self-extracting archive | `C:\Users\AMOG\tools\git` |
| GitHub CLI 2.101.0 | `gh_2.101.0_windows_amd64.zip` | `C:\Users\AMOG\tools\gh` |

Verified working: `node v24.21.0`, `npm 11.19.0`, `git 2.55.0.windows.5`, `gh 2.101.0`. npm reaches the registry in about 1.8s.

PATH entries added, including `%APPDATA%\npm` for future npm globals:

```
C:\Users\AMOG\tools\node
C:\Users\AMOG\tools\git\cmd
C:\Users\AMOG\tools\gh\bin
%APPDATA%\npm
```

A new terminal is required to pick these up. If this machine later gains admin rights, the winget route is the tidier long-term option:

```powershell
winget install --id OpenJS.NodeJS.LTS --exact --source winget --accept-source-agreements --accept-package-agreements
```

Then the npm globals:

```powershell
npm i -g vercel
```

### Cloud CLIs

| CLI | Version | How | Auth |
|---|---|---|---|
| Vercel | 60.1.3 | `npm i -g vercel` | `vercel login` — interactive |
| Wrangler (R2) | 4.141.0 | `npm i -g wrangler` | `wrangler login` — interactive |
| Turso | **not installable here** | see below | dashboard only |

Both npm CLIs run natively on Windows and are installed. Their logins open a browser, so they have to be run by hand once — an automated shell cannot complete the OAuth round trip.

### Turso CLI — not available on this machine

Verified against the release feed for `tursodatabase/turso-cli` v1.0.32. The published assets are:

```
turso-cli_Darwin_arm64.tar.gz   turso-cli_Linux_arm64.tar.gz
turso-cli_Darwin_x86_64.tar.gz  turso-cli_Linux_x86_64.tar.gz
```

There is **no Windows binary**. The documented `curl -sSfL https://get.tur.so/install.sh | bash` therefore needs WSL, and `wsl --install` requires administrator rights this account does not have. That route is closed.

It costs us nothing. The CLI only creates databases and mints tokens — both are available from the Turso dashboard, and everything afterwards (`drizzle-kit`, `db:migrate`, `db:seed`, the app itself) speaks to Turso over HTTPS from Node, which works fine on Windows. Local development runs against `file:./local.db` and needs no account at all.

If the CLI is ever genuinely needed, the options are a WSL distro (needs admin) or running it from a Linux CI job.

### The second machine

Phase 9 was built on a different Windows 11 machine (`C:\Users\Admin`), with a standard installer setup rather than the portable one above:

| Tool | Version | Note |
|---|---|---|
| Node.js | 24.16.0 | `C:\Program Files\nodejs` |
| Git | Git for Windows | Git Bash is the shell the scripts assume |
| GitHub CLI | logged in as `tfthushaar` | pushes and commits use that account |
| Wrangler | 4.141 through `npx` | logged in to the Cloudflare account of thushaarr.bsc23@rvu.edu.in; R2 not enabled there either |
| Chrome and Edge | 153 | `npm run audit:ui` drives whichever is installed |
| Python | 3.12 | used only for one-off edits, not by the project |

### Accounts to have ready

Vercel, Turso and Cloudflare (R2 enabled), plus push access to `github.com/KernelLex/hrms`. All three have free tiers that comfortably cover this prototype.

---

## 2. Stack

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js 16, App Router, TypeScript | Server Components query Turso directly; one codebase, one deploy |
| Styling | Tailwind CSS 4 | `DESIGN_LANGUAGE.md` §15 ships the token block and the Tailwind mapping ready to paste |
| Type | Geist via `next/font` | Named in the design language; free on Google Fonts |
| Icons | `lucide-react` | Named in the design language, outline, 24px grid |
| Database | Turso (libSQL) via `@libsql/client` | HTTP-based, so serverless functions need no connection pool |
| Queries | Drizzle ORM + drizzle-kit | First-class libSQL support, and `drizzle-kit generate` emits real SQL migration files we commit and review |
| Objects | Cloudflare R2 through `aws4fetch`, or the database until R2 is enabled | Presigned downloads, no egress fees; `aws4fetch` signs S3 requests with no dependencies, where the AWS SDK is megabytes |
| Auth | `jose` signed session cookie | One credentials provider, seeded users, three fixed roles — Auth.js would add adapters and beta churn for no gain |
| Hosting | Vercel | Push to `main` deploys; branches get preview URLs |
| Tests | Vitest | Runs the engines against a fresh SQLite file migrated and seeded each run, so tests never touch Turso |
| UI audit | `playwright-core` and `@axe-core/playwright` | Drives the installed Chrome through every screen as every role at 1280 and 375 pixels, with axe for WCAG A and AA |

**On Drizzle versus hand-written DDL.** You previously asked to own the full DDL. Drizzle keeps that: the TypeScript schema is the source of truth, `drizzle-kit generate` emits plain `.sql` migration files into `db/migrations/`, and those are committed and readable. What you gain is type-safe queries across 51 CRUD surfaces, which is most of this build. If you would rather hand-write the SQL and drop Drizzle to a query builder only, that is a one-line change to this plan.

---

## 3. SQLite porting rules

Turso is SQLite. These are not stylistic preferences — getting any of them wrong produces wrong numbers or a schema that will not build.

1. **No schemas.** SQLite has no `om.Company`. Use a table-name prefix: `om_company`, `pa_employee`, `py_payroll_run`.
2. **Money is `INTEGER` paise. Never `REAL`.** SQLite has no `DECIMAL`, and `REAL` is IEEE floating point — it will drift a payroll run. ₹72,000.00 is stored as `7200000`. Convert only at the render edge, and only through one helper.
3. **Dates are `TEXT`, ISO-8601 `YYYY-MM-DD`.** Sorts lexicographically, compares correctly, and the `9999-12-31` open-ended sentinel the mockups already use works natively. Timestamps are ISO-8601 UTC.
4. **Booleans are `INTEGER` 0/1.** There is no `BIT`.
5. **No stored procedures.** The time-slice routine moves into TypeScript at `src/lib/engines/timeslice.ts`, wrapped in a libSQL transaction.
6. **Partial indexes work**, so the time-slice uniqueness guard survives intact.
7. **Upserts are `INSERT … ON CONFLICT DO UPDATE`.** There is no `MERGE`.
8. **Generated columns work** (SQLite 3.31+) — useful for quota balance.
9. **Enforce foreign keys.** libSQL respects `PRAGMA foreign_keys = ON`; set it on client creation and assert it in a test.
10. **Transactions** use `client.transaction()` or `client.batch()`. Both are safe on serverless because the transport is HTTP.

---

## 4. Repository layout

Everything the app runs lives under `src/` so the `@/*` path alias reaches it.

```
hrms/
  README.md                  product document
  STATUS.md                  where the build stands
  BUILD_PLAN.md              this file
  PRODUCTION_READINESS.md    what stands between the prototype and real payroll
  ROADMAP.md                 features that could come next
  build_plan_extended_features.md   phases 10 to 25
  DESIGN_LANGUAGE.md         visual system, unchanged
  HR MODULE/                 original blueprint + HTML mockups, kept as reference
  drizzle.config.ts
  vercel.json                the daily cron tick
  .github/workflows/ci.yml   typecheck, lint, tests, build and the UI audit on every push
  vitest.config.mts          the test runner, pointed at .vitest/test.db
  scripts/
    ui-audit.ts              npm run audit:ui — every screen, role and width, with axe
    dev-session.ts           a signed session cookie for scripted checks
  tests/                     npm test — engines, repositories, Server Functions, exports
    support/                 global setup (migrate + seed), auth mocks, fixtures
  src/
    db/
      schema/                Drizzle schema, one file per module, re-exported by index.ts
      migrations/            generated .sql, committed (hand edits marked in the file)
      seed/index.ts          the demo organisation, as a function
      seed/run.ts            npm run db:seed
      migrate.ts             applies migrations against file: or Turso
      load-env.ts            .env.local loader for standalone scripts
    app/
      sign-in/               no shell; one-click demo accounts
      (app)/                 route group, everything behind the shell
        page.tsx             role-aware home
        me/                  the employee's own profile
        reports/             HR reports
        inbox/               notifications, and preferences
        change-log/          who changed what, organisation-wide
        outbox/              every email as it would be sent
        org/ core-hr/ time/ payroll/ recruitment/ performance/ tax/
        loading.tsx error.tsx not-found.tsx
      api/
        health/              liveness + database reachability
        documents/[id]/      permission-checked, logged downloads
        payroll/bank-file/   the NEFT file as CSV
        export/              employees, payroll runs, the tax register as CSV
        jobs/kick/           the job runner handing off to itself, signed
        cron/tick/           the daily tick
      actions/               Server Functions, grouped by module
      layout.tsx global-error.tsx not-found.tsx
      globals.css            design tokens from DESIGN_LANGUAGE.md §15
    components/
      ui.tsx                 buttons, cards, badges, tables, figures, tabs, empty states
      inputs.tsx             fields, selects, chips, form grid, error block
      shell.tsx              sidebar, mobile drawer, top bar, brand mark
      command-menu.tsx       Ctrl K
      home.tsx               needs attention, coming up
      charts.tsx             bar lists
      pagination.tsx         paging through the URL
      documents.tsx          a person's documents
      change-log.tsx         change-log entries as a table of sentences
      master-screen.tsx      list, dialog, edit and delete for master data
      payslip.tsx form16.tsx the printed documents
    lib/
      db.ts                  libSQL client
      auth.ts                session, hasRole, requireRole
      nav.ts commands.ts     role-filtered navigation and command menu entries
      money.ts dates.ts csv.ts   formatting at the edge, and CSV safety
      storage.ts             documents in R2 or the database
      access-log.ts          who read whose records
      change-log.ts          who changed what: diffs, recorded in the writing transaction
      change-format.ts       change-log entries as sentences
      notifications.ts       inbox rows, preferences, recipients
      email.ts               the outbox and its pluggable transport
      jobs/                  queue.ts handlers.ts runner.ts
      demo.ts                the demo accounts
      engines/               timeslice.ts quota.ts payroll.ts tax.ts time-evaluation.ts
      repositories/          SQL reads: employees, home, profile, calendar, reports, variance, change-log
    proxy.ts                 optimistic auth redirect (Next 16 renamed middleware)
  .env.example
```

---

## 5. Data model

69 tables, prefixed by module. Every infotype table carries the same time-slice contract: `employee_id, valid_from, valid_to, seq, created_by, created_at`.

**Why one table per infotype rather than one table with a JSON blob.** The blueprint suggests `employee_infotype_records` with `data_json`. Reject it: payroll must read basic pay as a typed, indexed, foreign-keyed value, and a blob turns every engine query into string parsing. One table per infotype is also what SAP does — PA0001, PA0002, PA0008.

| Prefix | Tables |
|---|---|
| `om_` | company, personnel_area, personnel_sub_area, job, org_unit, position, reporting_line |
| `pa_` | employee, it0000_action, it0001_org_assignment, it0002_personal_data, it0006_address, it0007_planned_working_time, it0008_basic_pay, it0009_bank_details, it0021_family_member, it0105_communication |
| `pt_` | absence_type, attendance_type, quota_type, it2001_absence, it2002_attendance, it2006_absence_quota, leave_request, work_schedule_rule, holiday, time_evaluation_result |
| `py_` | wage_type, payroll_period, it0014_recurring_payment, it0015_additional_payment, payroll_run, run_member, payroll_result, payroll_result_line, bank_transfer_file, bank_transfer_line, gl_posting, gl_posting_line, statutory_remittance |
| `rc_` | requisition, candidate, application, application_stage_history, interview, hire_conversion |
| `pm_` | appraisal_template, appraisal_cycle, goal, appraisal, calibration, increment_recommendation |
| `tds_` | section_master, tax_slab, employee_declaration, deduction_register, form16_part_a, form16_part_b |
| `sec_` | app_user, role, user_role |
| `app_` | document — registry of every stored file: key, content type, size, hash, owning entity, uploaded_by, and where the bytes live · document_content — the bytes, for files stored in the database · access_log — who read whose records · change_log — who changed what, before and after · notification and notification_pref — the inbox and each person's choices · outbox — every message waiting to go · job and job_run — background work and its history |

Two tables exist that the mockups do not show but the features require:

- **`py_payroll_result_line`** — the per-wage-type gross-to-net detail. Without it the payslip has nothing real to render and PY-03's totals are decoration.
- **`tds_tax_slab`** — old and new regime slabs per financial year. Without it Form 16 Part B's tax figure can only be hardcoded, which the mockup does.

Phase 10 added the six `app_` tables for the change log, notifications, the outbox and jobs (migration 0007).

Phase 9 added `py_run_member` (the people a run is to calculate, so it can proceed in batches and resume), `app_document_content` and `app_access_log`, and columns for run type and progress, the run that paid each one-off payment, the period an arrears line corrects, and working days employed.

---

## 6. Engines

The line between a prototype and a clickable mockup. Everything else is CRUD.

1. **Time-slice** (`timeslice.ts`) — writing a new infotype row delimits the previous one to `valid_from - 1` in the same transaction, guarded by a partial unique index on `(employee_id, valid_from)`. Exposes an as-of-date read. Powers CH-02 history, CH-03's as-of viewer, and every salary lookup.
2. **Quota** (`quota.ts`) — generates entitlement rows; approving leave decrements used, rejection restores it. Balance is derived, never stored loose.
3. **Payroll** (`payroll.ts`) — basic pay for each working day employed, slice by slice, less unpaid days → percentage allowances → recurring and one-off payments → arrears for earlier posted months whose inputs changed after they were paid → PF and TDS → net. Writes result and result lines. Emits the error row when bank details are missing, exactly as PY-03 shows.
   - **Runs in batches.** `startRun` fixes the people to calculate; `processRunBatch` calculates the next twenty, each person's reads in one batch and writes in one atomic batch.
   - **Regular and off-cycle.** An off-cycle run pays one-off payments still owed, even after the period is posted. Each one-off is paid exactly once.
   - **TDS** projects the year from what has been paid, subtracts what has been deducted, and spreads the rest; tax on a one-off amount is taken in the month it is paid.
4. **Tax** (`tax.ts`) — slab-based, old versus new regime, standard deduction, 87A rebate with the new regime's marginal relief, 4% cess. Feeds both the monthly TDS and Form 16 Part B, so Part B reconciles against Part A instead of being hardcoded.

5. **Jobs** (`jobs/`) — a queue in the database. Enqueueing is an insert that can join the caller's transaction; a dedupe key makes the same work a no-op the second time; claiming is one conditional update, so two workers never run one job; a job whose worker died is taken over after five minutes; failures retry after 30 seconds, then 1, 2, 4 minutes and so on up to an hour. Jobs run in `after()` once the response has gone, eight seconds at a time, and the runner hands off to a fresh invocation of itself with a signed request while work remains. A daily Vercel Cron tick queues the scheduled jobs and sweeps up anything left behind. Payroll runs are jobs.

**The change log** (`change-log.ts`) — every Server Function and the time-slice engine record who changed what: only the fields that changed, before and after. The time-slice engine, hiring and the leave decision write their entries inside their own transaction; elsewhere `audited()` reads the record before and after the write. Account numbers are masked. A new time slice records the values it replaced, so the log reads "₹65,000 → ₹72,000".

**Notifications** (`notifications.ts`, `email.ts`) — the inbox row and the outbox email are written with the change that caused them, each with a dedupe key per event and person, so a retried event tells nobody twice. Email goes through a transport that records messages until a provider is connected (phase 25).

Two cross-module transactions: **hire conversion** (RC-05 creates employee plus IT0000/0001/0002/0008 and flips the position's vacancy flag, atomically) and **increment push** (PM-05 writes a new basic-pay slice the next payroll run picks up).

---

## 7. Screen inventory

38 top-level screens. Five carry 18 nested tabs between them, so **51 distinct form surfaces**.

| Module | Screens | Nested tabs |
|---|---|---|
| Org Management | OM-01…08 | — |
| Core HR | CH-01…05 | CH-02: IT0002, 0001, 0006, 0007, 0008, 0009, 0021, 0105 |
| Time / Absence | TM-01…05 | TM-01: IT2001, IT2002 · TM-05: schedules, holidays |
| Payroll | PY-01…05 | PY-02: wage types, IT0014, IT0015 · PY-05: bank, GL, remittance |
| Recruitment | RC-01…05 | — |
| Performance | PM-01…05 | — |
| Tax / Form 16 | TDS-01…05 | — |

Phase 9 added seven screens outside the blueprint: the employee's own profile, HR reports, the team calendar, the employee record's Documents and Access log tabs, and the not-found and error screens. Two more gained tabs of their own: payroll runs switch between the regular run and each off-cycle run, and the run screen carries the variance check.

---

## 8. Design translation

The mockups define **features**. `DESIGN_LANGUAGE.md` defines **appearance**, and the two disagree on nearly every visual decision. Where they conflict, the design language wins.

| Mockup does | Build instead |
|---|---|
| Green accent `#2f6f5e` on chips, buttons, badges, hover rows | Ink `#171717`. One colour, no second accent |
| `UPPERCASE` panel headings, letter-spaced kickers | Sentence case throughout, 15px/600 card titles |
| A coloured pill on every table row | 8px dot plus 13px label in tables; badges only beside a page title |
| Amber "VACANT", green "Active", four stage colours | Status by shape and word, legible in greyscale |
| Dark `#1f2422` sidebar | White, 240px, hairline right edge, `soft` fill on the active item |
| Four equal buttons per form | One primary ("Save"), the rest secondary, ghost or destructive |
| `alert()` on every action | Toast: ink pill, bottom centre, past tense, 3.5s |
| Panels with both border and heavy heading rules | Cards: 1px `--line`, 16px radius, no shadow |

Specific screen translations:

- **CH-01 hire wizard** → numbered 24px ink circles with a live summary panel that stays in view (§Tasks and steps).
- **TM-03 balance cards** → figure row: one card split by hairlines, 4 across, label 13 muted / value 26 semibold / hint 13 muted.
- **PM-04 rating distribution** → bar list, ink bars on `soft` tracks, values at the bar tip.
- **RC-03 pipeline** → progress track segments with labels beneath.
- **OM-08 org tree** → hairline tree, ink text, vacancy as an outlined badge.
- **PY-04 payslip and TDS-04/05 Form 16** → the printed-document pattern (§11): A4, ink only, letterhead, right-aligned tabular figures, totals at weight 600.

Red appears only where it is earned: PY-03's missing-bank-details error, overdue statutory remittances, and a negative Form 16 balance.

**One deliberate departure.** DESIGN_LANGUAGE.md puts navigation group labels, tab counts and upcoming stage labels in `text-faint`. At 12px that measures 2.6 : 1 and fails WCAG AA, and the same document's §13 says text people must read is `text-muted` or darker. The accessibility pass sided with §13.

**No employee photos.** §Avatars is explicit — initials on a `soft` circle, never photographs. R2 stores documents only.

---

## 9. Cloudflare R2

| What | Produced by | Stored? |
|---|---|---|
| Candidate resumes | RC-02, replacing the mockup's "Resume Link" text field | Yes |
| Employee documents | The employee record's Documents tab | Yes |
| Payslips | PY-04 | No — rendered from the result lines, printed or saved as PDF |
| Form 16 Parts A and B | TDS-04, TDS-05 | No — rendered from the certificate record |
| Bank transfer files (NEFT CSV) | PY-05 | No — rendered from the transfer lines on download |

Every stored object is registered in `app_document`; nothing is referenced by bare key. Generated documents are rendered from the records they come from, because posted records do not change and a stored copy could only agree with them or be wrong.

`src/lib/storage.ts` stores in R2 when all four R2 variables are set, and in `app_document_content` otherwise. Each row records which, so switching needs no migration. Uploads pass through a Server Function (4 MB cap, under Vercel's 4.5 MB request limit) and are recognised by their first bytes, not their name; downloads from R2 redirect to a presigned URL valid for five minutes, so the bytes never pass through a Vercel function.

**Status: pending.** R2 is not enabled on either Cloudflare account tried (API error 10042). The steps to finish are in STATUS.md.

---

## 10. Environment variables

```
TURSO_DATABASE_URL=
TURSO_AUTH_TOKEN=
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=
AUTH_SECRET=
DEMO_SIGN_IN=          # "off" to remove one-click sign-in
APP_URL=               # where links in emails point; Vercel supplies it in production
CRON_SECRET=           # when set, the daily tick refuses calls without it
```

Three databases: local development, Vercel preview, Vercel production. Never point local development at the production database.

**Where this stands.** There is one Turso database, and `.env.local` points at it. For work that changes data, run against a local copy instead:

```bash
TURSO_DATABASE_URL=file:.local/dev.db npm run db:reset   # migrate and seed a local file
TURSO_DATABASE_URL=file:.local/dev.db npx next dev       # the app against it
```

A value already in the environment wins over `.env.local`, for both Next.js and the scripts. `.env.example` is committed; `.env.local` is not.

---

## 11. Phases

Each phase ends with a commit and a push to `main`, which triggers a Vercel deploy. No phase is batched with another.

| # | Phase | Delivers | Done when |
|---|---|---|---|
| 0 | Toolchain and repo | winget installs, `git init`, remote wired, Turso database created, R2 bucket created, `.env.example` | `node -v`, `git --version` resolve; first commit is on the remote |
| 1 | Foundation | Next.js app, design tokens, component library, Drizzle wired to Turso, auth, three roles, first Vercel deploy | Sign in as each role on a live URL |
| 2 | Org Management | OM-01…08, live org-chart tree | A company can be built down to a position and rendered as a tree |
| 3 | Core HR | CH-01…05, time-slice engine, hire wizard, 8 infotype tabs | An employee hired via the wizard; CH-03 shows correct data for a past date |
| 4 | Time and absence | TM-01…05, quota engine, request and approval | Employee applies, manager approves, balance decrements |
| 5 | Payroll | PY-01…05, payroll engine, period locking, payslip | A period runs gross-to-net and produces a payslip; missing bank details raise the error row |
| 6 | Recruitment | RC-01…05, pipeline, hire conversion | An offered candidate becomes an employee with infotypes created |
| 7 | Performance | PM-01…05, calibration, increment push | An approved increment writes a new basic-pay slice the next run picks up |
| 8 | Tax and Form 16 | TDS-01…05, tax engine, Part A and Part B | Part B's tax reconciles against Part A's deducted total |
| 9 | Finish | Role dashboards, Ctrl-K command menu, document storage, print stylesheets, empty/loading/error states, 375px pass, accessibility pass, a test runner, and the known gaps from phase 8 | §16 review checklist passes on every screen — **done**; the audit script checks what can be checked mechanically, and R2 waits on the account |

Phases 10 onwards are planned in [build_plan_extended_features.md](build_plan_extended_features.md). Phase 10 — notifications, background jobs, the change log and CI — is **done**.

Phase order follows the blueprint's own recommendation, and it is right: every module foreign-keys into Org Management and Core HR, so those land first.

Phase 9 is not optional polish. §16 requires empty, loading and error states to be designed rather than left to chance, and every screen to work at 375px. The mockups have none of that.

---

## 12. Gotchas hit while building

Recorded so they are not rediscovered.

**PowerShell 5.1 writes a BOM.** `Set-Content -Encoding utf8` prefixes the file with `EF BB BF`. In `.env.local` that turns the first key into `﻿TURSO_DATABASE_URL`, so the first variable silently goes missing while every later one loads — a confusing failure. Write files with `[System.IO.File]::WriteAllText($path, $text, (New-Object System.Text.UTF8Encoding($false)))`, and note that `File.ReadAllText` strips BOMs on read, so a BOM check must inspect raw bytes.

**`tsx` cannot resolve extensionless re-exports in `.mts`.** A namespace import of `src/db/schema` comes back empty under the ESM loader, so `db.query.*` appears undefined. This is a script-runner quirk, not an app bug — Turbopack resolves them correctly, confirmed by `/api/health` reporting `relationalQueryApi: true`. Standalone scripts should use `.ts`, as `migrate.ts` and `seed/run.ts` do.

**winget needs `--source winget --accept-source-agreements`** on this machine, and cannot install machine-wide without admin. See §1.

**Unlayered CSS beats every Tailwind utility.** Tailwind 4 puts utilities in `@layer utilities`, and CSS outside any layer outranks all layers whatever the specificity. A global `:focus-visible` rule therefore could not be switched off by `focus-visible:outline-none`, and every text field drew an outline on top of its border and ring. Base rules belong in `@layer base`.

**An `sr-only` label can widen the page.** It is absolutely positioned; inside a table's scroll wrapper that is not `position: relative`, it escapes the clip at its static position past the right edge and makes the whole page scroll sideways at 375px. The table wrapper is `relative`.

**A grid with no column template grows to fit its content.** `lg:grid-cols-[1fr_320px]` alone leaves one implicit `auto` column on phones, which widens to a table's min-content. Use `grid-cols-1` and `minmax(0,1fr)`.

**A local SQLite file does not enforce foreign keys**, and the libsql client opens a pool of connections with no hook to switch them on. Anything that relies on `ON DELETE CASCADE` works on Turso and silently leaves orphans locally. The payroll engine deletes a run's dependents explicitly.

**drizzle-kit drops `ON DELETE` from `ALTER TABLE … ADD COLUMN … REFERENCES`.** Migration 0006 restores it by hand; read generated SQL before applying it.

**Git Bash rewrites arguments that look like paths.** `/` becomes `C:/Program Files/Git/`. Prefix a command with `MSYS_NO_PATHCONV=1` when passing URL paths to a script.

**A "use server" file may only export async functions.** Constants a Server Function shares with the client go in a plain module (`src/lib/document-kinds.ts`).

**`after()` needs a request.** Tests call route handlers and Server Functions directly, so the test setup replaces `after` with an immediate call, and replaces `kickJobs` with nothing: a test works the queue itself with `processJobs()`, so no background job races it for SQLite's one writer.

**Vercel Hobby runs cron at most once a day.** The daily tick is a safety net; the job runner keeps itself going by handing off to a fresh invocation with a signed request, so nothing waits a day.

**axe waits forever on a frame that cannot run scripts.** The outbox previews each email in an `<iframe sandbox>`; axe injects itself into every frame and never hears back from that one, so the audit hung without an error. The audit excludes sandboxed frames.

**A disabled checkbox is not submitted.** A form that disables a box must send its value some other way, or saving turns it off.

---

## 13. Conventions

- Commit messages describe the change and carry **no** co-author or tool attribution.
- Money crosses no boundary as a float. Paise in, formatted string out, one helper.
- Every table write that changes employee master data goes through the time-slice engine, never a bare insert.
- Sentence case in UI copy, buttons are a verb plus an object, no emojis. §12 of the design language governs all user-visible text.
- Dates are formatted by `src/lib/dates.ts` and nowhere else: "26 Sept 2026", "2:30 pm", India time.
- Engine and repository changes come with tests, and a test that cannot fail is not a test: check that it fails when the code is broken.
- Before pushing: `npx tsc --noEmit`, `npm run lint`, `npm test`, and `npm run audit:ui` against a running dev server. CI runs all of them on every push.
- Every write records a change-log entry: through the time-slice engine, `changeStatement` inside a transaction, or `audited()`, `recordCreated()` and `recordDeleted()` around a plain write.
- Anything slow, or anything that tells someone something, is a job or an outbox row written with the change — never work the user waits for.
- Hand-written SQL reads live in `src/lib/repositories/`; a list that grows with headcount is paged in SQL, never sliced in JavaScript.
