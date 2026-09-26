# Project status

**Last updated:** 26 Sept 2026 · **Current phase:** 9 of 9 (finish, next)

Updated at the end of every milestone. For the plan see [BUILD_PLAN.md](BUILD_PLAN.md); for what the product does see [README.md](README.md).

---

## At a glance

| | |
|---|---|
| Phases complete | 9 of 10 (phases 0 to 8) |
| Screens built | **38 of 38** |
| Placeholder screens | 0 |
| Database tables | 59 |
| Engines | 4 of 4, plus time evaluation |
| Cross-module transactions | 2 of 2 |
| Automated checks passing | 45 of 45 |
| Live | https://hrms-amogh24.vercel.app |

Every screen in the original blueprint now exists and works against live data. What remains is phase 9: the cross-cutting finish.

---

## Infrastructure

| Service | Status | Detail |
|---|---|---|
| GitHub | working | `KernelLex/hrms`, a commit and push per phase |
| Turso | working | `hrms-kernellex.aws-us-west-2.turso.io`, migrated and seeded |
| Vercel | working | `amogh24/hrms`, production green, deploys on push |
| Cloudflare R2 | **blocked** | R2 not enabled on the account (API error 10042) |

### Local toolchain

Installed per-user under `C:\Users\AMOG\tools`, because the account is not an administrator. See BUILD_PLAN §1.

| Tool | Version |
|---|---|
| Node.js | 24.21.0 |
| npm | 11.19.0 |
| Git | 2.55.0.windows.5 |
| GitHub CLI | 2.101.0 |
| Vercel CLI | 60.1.3 |
| Wrangler | 4.141.0 |
| Turso CLI | not installable on Windows — the dashboard is used instead |

### Demo accounts

All three use the password `demo1234`.

| Username | Role | Sees |
|---|---|---|
| `hr.admin` | HR administrator | the whole back office |
| `ravi.kumar` | Manager and employee | approvals, their team's appraisals, and their own records |
| `arjun.mehta` | Employee | their own leave, payslips, declaration and appraisal |

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
| 9 | Finish — dashboards, command menu, R2, print, a11y | **next** |

---

## What is built

### Foundation

The design system carries every token from `DESIGN_LANGUAGE.md`: buttons in four variants and three sizes, cards, tables, figure rows, badges and status dots across five tones, key–value lists, tabs, avatars, notices, empty states, progress tracks, and the form controls. Light-only, ink and greys, red reserved for problems.

The shell is a 240px white sidebar with a hairline edge and a mobile drawer behind a scrim, with navigation filtered by role so the three personas get genuinely different products rather than one product with things greyed out.

Authentication is a signed session cookie via `jose`. Every Server Function re-checks the caller's role, because a Server Function is reachable by direct POST and not only through the UI.

### Org management (8 screens)

Companies, personnel areas, sub-areas, jobs, departments, positions, reporting lines and the org chart.

- Cycle guards on both hierarchies: a department cannot become its own ancestor, a position cannot enter its own reporting chain.
- Deletes name what blocks them — "CO01 still has 2 personnel areas. Remove or reassign them first." — rather than surfacing a foreign key error.
- Reporting lines are append-only: saving writes the dated history row and moves the position's live manager together.
- The org chart is derived by walking both hierarchies, never stored. A position managed from another department renders at the top of its own rather than disappearing.

### Core HR (5 screens, 8 infotype tabs)

The hire action, maintain master data, the as-of-date viewer, employee search and mass update.

The time-slice engine underneath is what the whole model rests on. Writing a record for a date delimits whatever was true before it, inside one transaction, handling all four overlap cases — including the one people forget, where a short correction inserted into an open-ended record splits it in three and leaves the later period carrying its own original value.

Arjun Mehta reads **₹65,000 on 1 June 2024 and ₹72,000 on 1 June 2025**, from two dated records rather than one mutable field.

### Time and absence (5 screens)

Absences, attendance, quotas, time evaluation, work schedules and holidays for HR; an approval queue for managers; self-service leave for employees.

- Working days, not calendar days: 23–27 January spans five calendar days but costs two days of entitlement.
- Balances move on approval, not submission — a request that may never be granted holds no days.
- Half days are exact, stored in half-day units rather than 0.5 floats.
- Managers see only their direct reports, so the queue is finishable.

### Payroll (5 screens)

Periods, wage types, recurring and one-off payments, the run, payslips, and the bank file, ledger posting and statutory remittance that follow.

Gross to net in the order each step feeds the next: basic pay valid in the period, prorated for unpaid absence, percentage allowances on the prorated basic, recurring and one-off payments, then provident fund and income tax.

- The control record bites: an open period refuses to run, a period cannot be posted without a run, a posted period is final.
- Anyone who cannot be paid is reported with the missing record named, not silently skipped.
- Payslip lines sum exactly to the totals, because the totals are derived from the lines.
- The ledger journal balances by construction, both sides built from the same result lines.

### Recruitment (5 screens)

Requisitions, candidates, the pipeline, interviews, and the hire conversion.

The conversion creates the employee and six infotypes in one transaction, fills the position, and closes the requisition once its openings are used. It takes the same path as the Core HR hire action deliberately: two ways of creating an employee would drift apart, and one would end up missing an infotype payroll needs.

### Performance (5 screens)

Cycles, goals, self and manager ratings, calibration, and the increment recommendation.

An approved increment becomes a new basic-pay record through the time-slice engine rather than an update in place, so the old salary is delimited and the next payroll run picks the new one up because it reads whatever is valid in the period.

- Calibration keeps the manager's rating separately from the moderated one, so agreeing a different number does not erase what they thought.
- The employee is shown the calibrated rating, not the manager's, and only once finalised.

### Tax and Form 16 (5 screens)

Sections and rates, declarations, the quarterly deduction register, and the certificate.

The register is built from what payroll actually deducted — read from the stored result lines rather than recomputed — so the register, the payslips and the certificate all quote the same numbers. Part A summarises what was deducted and deposited; Part B recomputes the year's liability from the same gross and the employee's declaration, so the two halves reconcile and the balance at the bottom is a real figure.

- Tax slabs are data for both regimes, so a rate change is a row edit.
- Under the new regime, declared exemptions are stored but not applied, so switching regime loses nothing.
- Tax deducted but not recorded as deposited is flagged in red on the register and on the certificate — it is money owed to the government.
- 80C is capped at ₹1,50,000 and 80D at ₹25,000 at entry.

---

## Verification

Each engine has a harness under `/api/health/*`. They create throwaway data and remove it afterwards. All require an authenticated HR session.

| Harness | Checks | Covers |
|---|---|---|
| `/api/health` | — | database reachability, used by deployment checks |
| `/api/health/timeslice-check` | 6 of 6 | delimiting, as-of reads, the three-way split, gap healing |
| `/api/health/quota-check` | 7 of 7 | working days, overdraw refusal, half-day exactness |
| `/api/health/payroll-check` | 13 of 13 | gross to net, cumulative slabs, 87A rebate, 4% cess |
| `/api/health/increment-check` | 9 of 9 | the push into basic pay, and that it cannot double-apply |
| `/api/health/form16-check` | 10 of 10 | quarterly bucketing, and Part A reconciling with Part B |

**45 of 45 passing.** Two of these initially passed vacuously — a cess assertion where tax was zero, and a Form 16 case where the salary fell under the rebate limit — and were rewritten with figures that actually exercise the arithmetic. A check that cannot fail is not a check.

These are harnesses, not a test suite. Phase 9 should replace them with a real runner.

---

## What is left

### Phase 9 — the finish

- **Role dashboards.** The home screen shows real figures for HR but a placeholder notice for managers and employees.
- **Command menu.** Ctrl-K, per DESIGN_LANGUAGE §9.
- **R2 documents.** Resume uploads, stored payslip and Form 16 PDFs, the bank transfer file as a download. Needs the `app_document` table and R2 enabled.
- **Print stylesheets.** Payslips and Form 16 render to the printed-document pattern on screen; the print path needs a proper pass.
- **Empty, loading and error states.** Empty states exist throughout; loading and error boundaries do not.
- **375px pass.** The shell adapts and tables scroll sideways, but no screen has been walked at phone width.
- **Accessibility pass.** Focus states, labels and status-without-colour are built in; nothing has been checked with a screen reader.
- **A real test runner**, replacing the `/api/health/*` harnesses.

### Known gaps worth naming

- **No pagination anywhere.** Every list loads every row. Fine at seed scale, wrong at a thousand employees.
- **Some list pages issue a query per row** — the approvals screen fetches a balance per pending request, and the ledger posting aggregates by looping results. Correct, but N+1.
- **No audit trail on reads**, only on writes.
- **Payroll runs synchronously** in the request. A few hundred employees would exceed a serverless timeout.
- **Off-cycle payroll, retroactive runs and mid-period joiners** are not handled; the run assumes a whole month.

---

## Blockers

**R2 is not enabled.** `wrangler r2 bucket create` fails with API error 10042 — R2 must be switched on in the Cloudflare dashboard first, which usually needs a payment method even on the free tier. Blocks the document parts of phase 9 and nothing else.

**The Turso auth token was pasted into a chat transcript.** Rotate it in the dashboard before this is anything other than a prototype.

---

## Decisions worth remembering

- **Next.js 16, not 15.** Turbopack is default, `params`/`cookies`/`headers` are async, and middleware is now `proxy.ts`.
- **`jose` cookie, not Auth.js.** One credentials provider and three fixed roles did not justify the adapter surface.
- **One table per infotype, not a JSON blob.** Payroll needs typed, indexed, foreign-keyed salary values.
- **Money is integer paise; quotas are half-day units.** SQLite has no `DECIMAL`, and `REAL` would drift across a payroll run.
- **The database connects lazily.** Throwing at module scope failed the Vercel build while it collected page data.
- **`readEnv` strips a BOM from every environment variable.** PowerShell prepends one when piping to a native command's stdin, which silently corrupted the Turso URL on Vercel and is invisible in any dashboard.
- **The tax engine landed in phase 5, not 8**, because payroll needed real TDS and a stub would have been thrown away.
- **The mockups supply features, not appearance.** Their green accent, uppercase headings and per-row coloured pills all contradict `DESIGN_LANGUAGE.md` and were discarded. See BUILD_PLAN §8.
