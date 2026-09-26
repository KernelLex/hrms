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

### Turso CLI — deliberately skipped

The Turso CLI is not in the winget catalogue, and on Windows it is distributed for WSL. No WSL distro is installed here, and installing one just to create a database is not worth it.

We do not need it. The database is created once in the Turso dashboard, and every migration after that runs through `drizzle-kit`, which talks to Turso over HTTPS from Node. If the CLI becomes genuinely useful later, install a WSL distro then.

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
| Objects | Cloudflare R2, S3-compatible, `@aws-sdk/client-s3` | Presigned URLs, no egress fees |
| Auth | Auth.js v5, credentials provider | Seeded users, JWT cookie. Prototype-grade on purpose |
| Hosting | Vercel | Push to `main` deploys; branches get preview URLs |

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

```
hrms/
  README.md                  product document
  BUILD_PLAN.md              this file
  DESIGN_LANGUAGE.md         visual system, unchanged
  HR MODULE/                 original blueprint + HTML mockups, kept as reference
  db/
    schema/                  Drizzle schema, one file per module
    migrations/              generated .sql, committed
    seed/                    demo org, employees, wage types, tax slabs, holidays
  src/
    app/
      (auth)/sign-in/
      (app)/
        page.tsx             role-aware home
        org/ core-hr/ time/ payroll/ recruitment/ performance/ tax/
      api/
      layout.tsx
      globals.css            design tokens from DESIGN_LANGUAGE.md §15
    components/
      ui.tsx shell.tsx forms.tsx inputs.tsx tables.tsx progress.tsx charts.tsx
    lib/
      db.ts                  libSQL client
      auth.ts
      r2.ts                  presigned upload/download
      money.ts               paise <-> display, the only place formatting happens
      repositories/
      engines/               timeslice.ts quota.ts payroll.ts tax.ts
  .env.example
```

---

## 5. Data model

61 tables, prefixed by module. Every infotype table carries the same time-slice contract: `employee_id, valid_from, valid_to, seq, created_by, created_at`.

**Why one table per infotype rather than one table with a JSON blob.** The blueprint suggests `employee_infotype_records` with `data_json`. Reject it: payroll must read basic pay as a typed, indexed, foreign-keyed value, and a blob turns every engine query into string parsing. One table per infotype is also what SAP does — PA0001, PA0002, PA0008.

| Prefix | Tables |
|---|---|
| `om_` | company, personnel_area, personnel_sub_area, job, org_unit, position, reporting_line |
| `pa_` | employee, it0000_action, it0001_org_assignment, it0002_personal_data, it0006_address, it0007_planned_working_time, it0008_basic_pay, it0009_bank_details, it0021_family_member, it0105_communication |
| `pt_` | absence_type, attendance_type, quota_type, it2001_absence, it2002_attendance, it2006_absence_quota, leave_request, work_schedule_rule, holiday, time_evaluation_result |
| `py_` | wage_type, payroll_period, it0014_recurring_payment, it0015_additional_payment, payroll_run, payroll_result, payroll_result_line, bank_transfer_file, bank_transfer_line, gl_posting, gl_posting_line, statutory_remittance |
| `rc_` | requisition, candidate, application, application_stage_history, interview, hire_conversion |
| `pm_` | appraisal_template, appraisal_cycle, goal, appraisal, calibration, increment_recommendation |
| `tds_` | section_master, tax_slab, employee_declaration, deduction_register, form16_part_a, form16_part_b |
| `sec_` | app_user, role, user_role |
| `app_` | document — registry of every R2 object: key, content type, size, owning entity, uploaded_by |

Two tables exist that the mockups do not show but the features require:

- **`py_payroll_result_line`** — the per-wage-type gross-to-net detail. Without it the payslip has nothing real to render and PY-03's totals are decoration.
- **`tds_tax_slab`** — old and new regime slabs per financial year. Without it Form 16 Part B's tax figure can only be hardcoded, which the mockup does.

---

## 6. Engines

The line between a prototype and a clickable mockup. Everything else is CRUD.

1. **Time-slice** (`timeslice.ts`) — writing a new infotype row delimits the previous one to `valid_from - 1` in the same transaction, guarded by a partial unique index on `(employee_id, valid_from)`. Exposes an as-of-date read. Powers CH-02 history, CH-03's as-of viewer, and every salary lookup.
2. **Quota** (`quota.ts`) — generates entitlement rows; approving leave decrements used, rejection restores it. Balance is derived, never stored loose.
3. **Payroll** (`payroll.ts`) — basic pay as of period end → wage-type rules (fixed, % of basic, formula) → recurring and one-off payments landing in the period → unpaid-leave proration from absences → PF and TDS → net. Writes result and result lines. Emits the error row when bank details are missing, exactly as PY-03 shows.
4. **Tax** (`tax.ts`) — slab-based, old versus new regime, standard deduction, 87A rebate, 4% cess. Feeds both the monthly TDS wage type and Form 16 Part B, so Part B reconciles against Part A instead of being hardcoded.

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

**No employee photos.** §Avatars is explicit — initials on a `soft` circle, never photographs. R2 stores documents only.

---

## 9. Cloudflare R2

| What | Produced by |
|---|---|
| Candidate resumes | RC-02, upload replacing the mockup's "Resume Link" text field |
| Payslip PDFs | PY-04 |
| Form 16 Part A and Part B PDFs | TDS-04, TDS-05 |
| Bank transfer files (NEFT CSV) | PY-05 |

Uploads and downloads both go through presigned URLs so file bytes never pass through a Vercel function. Every object is registered in `app_document`; nothing is referenced by bare key.

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
```

Three databases: local development, Vercel preview, Vercel production. Never point local development at the production database. `.env.example` is committed; `.env.local` is not.

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
| 9 | Finish | Role dashboards, Ctrl-K command menu, R2 document storage, print stylesheets, empty/loading/error states, 375px pass, accessibility pass | §16 review checklist passes on every screen |

Phase order follows the blueprint's own recommendation, and it is right: every module foreign-keys into Org Management and Core HR, so those land first.

Phase 9 is not optional polish. §16 requires empty, loading and error states to be designed rather than left to chance, and every screen to work at 375px. The mockups have none of that.

---

## 12. Conventions

- Commit messages describe the change and carry **no** co-author or tool attribution.
- Money crosses no boundary as a float. Paise in, formatted string out, one helper.
- Every table write that changes employee master data goes through the time-slice engine, never a bare insert.
- Sentence case in UI copy, buttons are a verb plus an object, no emojis. §12 of the design language governs all user-visible text.
