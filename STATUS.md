# Project status

**Last updated:** 26 Sept 2026 · **Current phase:** 8 of 9 (tax and Form 16, next)

Updated at the end of every milestone. For the full plan see [BUILD_PLAN.md](BUILD_PLAN.md); for what the product does see [README.md](README.md).

---

## At a glance

| | |
|---|---|
| Phases complete | 8 of 10 (phases 0 to 7) |
| Real screens built | 33 of 38 |
| Placeholder screens | 1 |
| Database tables | 59 of ~61 |
| Engines built | 4 of 4, plus time evaluation |
| Cross-module transactions | 2 of 2 |
| Deployed | yes, but gated — see blockers |

---

## Infrastructure

| Service | Status | Detail |
|---|---|---|
| GitHub | working | `KernelLex/hrms`, pushes on every phase |
| Turso | working | `hrms-kernellex.aws-us-west-2.turso.io`, migrated and seeded |
| Vercel | deployed | project `amogh24/hrms`, production build green |
| Cloudflare R2 | **blocked** | R2 not enabled on the account (API error 10042) |

### Local toolchain

Installed per-user under `C:\Users\AMOG\tools` because the account is not an administrator. See BUILD_PLAN §1.

| Tool | Version |
|---|---|
| Node.js | 24.21.0 |
| npm | 11.19.0 |
| Git | 2.55.0.windows.5 |
| GitHub CLI | 2.101.0 |
| Vercel CLI | 60.1.3 |
| Wrangler | 4.141.0 |
| Turso CLI | not installable on Windows — dashboard used instead |

---

## Phase progress

| # | Phase | Status |
|---|---|---|
| 0 | Toolchain and repo | done |
| 1 | Foundation — design system, shell, auth, data layer | done |
| 2 | Org management — OM-01…08 | done |
| 3 | Core HR — CH-01…05, time-slice engine | done |
| 4 | Time and absence — TM-01…05, quota engine | done |
| 5 | Payroll — PY-01…05, payroll engine | done |
| 6 | Recruitment — RC-01…05, hire conversion | done |
| 7 | Performance — PM-01…05, increment push | done |
| 8 | Tax and Form 16 — TDS-01…05 screens | **next** (engine already done) |
| 9 | Finish — dashboards, command menu, R2, print, a11y | not started |

---

## What is built

**Design system** — all tokens from DESIGN_LANGUAGE.md §2/§5/§6/§8. Buttons in four variants and three sizes, cards, tables, figure rows, badges and status dots across five tones, key-value lists, tabs, avatars, notices, empty states, and the full form control set. Light-only, ink and greys, red reserved for problems.

**Shell** — 240px white sidebar with a hairline edge, mobile drawer behind a scrim, navigation filtered by role so the three personas get different products.

**Auth** — signed session cookie via `jose`, three roles, optimistic redirect in `proxy.ts`, real enforcement in `requireRole`. Three seeded accounts, all with password `demo1234`:

| Username | Role |
|---|---|
| `hr.admin` | HR administrator |
| `ravi.kumar` | Manager and employee |
| `arjun.mehta` | Employee |

**Data** — 10 tables (`om_*`, `sec_*`), generated migrations committed, seed mirroring the reference mockups: 2 companies, 2 personnel areas, 2 sub-areas, 2 jobs, 3 org units, 4 positions (2 vacant), 2 reporting lines. Foreign key enforcement verified on both SQLite and Turso.

**Money handling** — integer paise throughout, with formatting helpers. SQLite has no `DECIMAL` and `REAL` would drift a payroll run.

**Health endpoint** — `/api/health` reports database reachability, excluded from the auth redirect.

**Org management — all eight screens (phase 2).** Companies, personnel areas, sub-areas, jobs, departments, positions, reporting lines and the org chart, reached through a tab bar with live counts. Full create, edit and delete on each, driven by a shared master-data screen so the eight cannot drift apart visually.

Behaviour worth noting:

- **Cycle guards.** A department cannot become its own ancestor and a position cannot end up in its own reporting chain; both walk the parent chain before saving.
- **Deletes name what blocks them.** "CO01 still has 2 personnel areas. Remove or reassign them first." rather than a foreign key error.
- **Reporting lines are append-only.** Recording one writes the dated history row and moves the position's live manager in the same action; deleting one falls back to the previous line.
- **Codes lock once in use**, since other records point at them.
- **The org chart is derived**, never stored — it walks `parent_code` and `reports_to_code`. A position whose manager sits in another department is shown at the top of its own department rather than vanishing.

Verified: 8 of 8 data integrity checks pass (no cycles, valid references, foreign keys reject orphans, insert/update/delete round-trip), and all eight screens render real seeded data over HTTP as an authenticated HR admin.

**Core HR — all five screens and the time-slice engine (phase 3).** The hire action, maintain master data across eight infotype tabs, the as-of-date viewer, employee search and mass update.

**The time-slice engine** is the part everything later depends on. Writing a record for a date delimits whatever was true before it rather than overwriting it, inside one transaction. It handles all four overlap cases, including the one people forget: a short correction inserted into the middle of an open-ended record splits it in three and leaves the later period carrying its own original value.

Verified by `/api/health/timeslice-check` — 6 of 6 pass:

- predecessor delimited on a later insert
- as-of read returns the historical value, not the current one
- a straddling insert splits the record into three
- the period after a correction keeps its own value
- deleting a slice extends its predecessor over the gap
- no overlapping slices remain

Proof it works end to end: Arjun Mehta's as-of viewer reads ₹65,000 on 1 June 2024 and ₹72,000 on 1 June 2025, from two dated records rather than one mutable field.

Also in this phase: the hire action creates the employee and five infotypes atomically and marks the position occupied; terminating frees the chair again; mass update routes every row through the engine so a bulk change leaves the same clean history a single edit does.

**Time and absence — all five screens, the quota engine and time evaluation (phase 4).** Absences, attendance, quotas, time evaluation, work schedules and holidays for HR; an approval queue for managers; self-service leave for employees.

The chain closes end to end: an employee applies, their manager approves, the approval writes the absence record and decrements the quota in the same action, and an unpaid absence becomes the unpaid-day count payroll will prorate against.

Details that matter:

- **Working days, not calendar days.** Leave skips weekends and public holidays, so 23–27 January spans five calendar days but costs two days of entitlement.
- **Balances move on approval, not submission.** A pending request that may never be granted does not hold days.
- **Half days are exact.** Quotas are stored in half-day units, never as 0.5 floats.
- **An overdraw is refused with the numbers in the message** — "That needs 20 days but only 7 remain."
- **Deleting an absence that came from a request** hands the days back and cancels the request.
- **Managers see only their direct reports**, so the queue is finishable rather than company-wide.

Verified by `/api/health/quota-check` — 7 of 7 pass.

**Payroll and tax — all five screens and both engines (phase 5).** Payroll periods, wage types, recurring and one-off payments, the run, payslips, and the bank file, ledger posting and statutory remittance that follow it.

The run works gross to net in the order each step feeds the next: basic pay valid in the period, prorated for unpaid absence, then percentage allowances computed on the prorated basic, then recurring and one-off payments, then provident fund and tax.

The tax engine landed here rather than in phase 8, because payroll needs real TDS and a stub would have been thrown away. Slabs are data for both regimes, so a rate change is a row edit.

- **The control record bites.** An open period refuses to run; a period cannot be posted without a run; a posted period is final.
- **Anyone who cannot be paid is reported, not skipped.** No bank details produces an error row naming the missing record, rather than a run that quietly pays fewer people.
- **Payslip lines sum exactly to the totals**, because they are the same numbers — the totals are derived from the lines.
- **PF respects the ₹15,000 wage ceiling.**
- **The ledger journal balances** by construction: both sides come from the same result lines, and the screen says so if they ever disagree.
- **Statutory due dates fall out of the posting date**, and overdue money is the one thing on that screen shown in red.

Verified by `/api/health/payroll-check` — 13 of 13 pass, including cumulative slab arithmetic (₹40,000 on ₹10,00,000, not a flat rate) and 4% cess on tax after rebate.

**Recruitment — all five screens and the hire conversion (phase 6).** Requisitions, candidates, the pipeline, interview scheduling, and the conversion that turns an offered candidate into an employee.

The conversion is the point of the module. It creates the employee and six infotypes in one transaction, marks the position filled, moves the application to hired, records which candidate became which employee, and closes the requisition once its openings are used up. It deliberately does exactly what the Core HR hire action does — two ways of creating an employee would drift apart, and one of them would end up missing an infotype payroll needs.

Other behaviour:

- **Requisitions only open against vacant positions**, and the department and job follow from the position rather than being re-entered.
- **Stages advance one step at a time** and every move is written to a history table, so the pipeline is a record rather than a single mutable field.
- **Moving to offered asks for the salary**, which is then carried into the conversion.
- **A position filled between offer and conversion** blocks the conversion with an explanation rather than failing at the database.
- **A hired candidate cannot be deleted or rejected**, so the audit trail survives.
- The pipeline uses a progress track — ink for reached, `control` for unreached, `danger-mark` for rejected — rather than the mockup's four differently coloured pills, which carry no meaning in greyscale.

**Performance and increments — all five screens and the increment push (phase 7).** Cycles, goals, self and manager ratings, calibration, and the increment recommendation that becomes a salary.

The push is the point of the module. An approved increment goes through the time-slice engine rather than updating the salary in place, so the old figure is delimited rather than destroyed and the next payroll run picks the new one up because it reads whatever is valid in the period. Verified end to end by `/api/health/increment-check` — 9 of 9 pass:

- a finalised rating produces a draft increment, sized from the rating
- a draft cannot be pushed; only an approved one can
- basic pay ends with two records, not one overwritten
- the old salary is delimited to the day before the effective date
- payroll reads ₹60,000 in January and ₹65,400 in June, either side of the change
- the new record names the cycle it came from
- pushing twice does nothing

Other behaviour:

- **Opening a cycle creates an appraisal for every active employee**, so the rating screens start with rows rather than an empty list someone populates by hand.
- **Goal weightings are capped at 100% per person**, and the screen says who is short.
- **A manager rating needs the self review first**, and a manager can only rate their own reports.
- **Calibration keeps the manager's rating separately** from the moderated one, so agreeing a different number does not erase what the manager thought.
- **Only a finalised calibration earns an increment.**
- **The employee sees the calibrated rating, not the manager's**, and only once it is finalised.

---

## What is left

### Screens — 38 total, 23 built

| Module | Screens | Nested tabs |
|---|---|---|
| ~~Org management~~ | ~~OM-01…08~~ — done | — |
| ~~Core HR~~ | ~~CH-01…05~~ — done | 8 infotype tabs — done |
| ~~Time and absence~~ | ~~TM-01…05~~ — done | — |
| ~~Payroll~~ | ~~PY-01…05~~ — done | — |
| ~~Recruitment~~ | ~~RC-01…05~~ — done | — |
| ~~Performance~~ | ~~PM-01…05~~ — done | — |
| Tax and Form 16 | TDS-01…05 | — |

### Engines — all four done

1. ~~**Time-slice**~~ — 6 of 6 checks pass.
2. ~~**Quota**~~ — 7 of 7 checks pass.
3. ~~**Time evaluation**~~ — produces the unpaid-day count payroll prorates against.
4. ~~**Payroll** and **tax**~~ — 13 of 13 checks pass.

### Cross-module transactions — both done

- ~~**Hire conversion**~~ — recruitment creates the employee and six infotypes atomically, using the same path as the Core HR hire action.
- ~~**Increment push**~~ — performance writes a new basic-pay record through the time-slice engine; 9 of 9 checks pass.

### Remaining tables

`app_document` (1), for R2 objects in phase 9.

---

## Blockers

**Vercel Deployment Protection is on.** The production build is green but every request returns Vercel's SSO page instead of the app. Disable at Vercel → `hrms` → Settings → Deployment Protection → Vercel Authentication. Note this makes the app publicly reachable; it still has its own sign-in, but the demo passwords are printed on that page.

**R2 is not enabled.** `wrangler r2 bucket create` fails with API error 10042 — R2 must be switched on in the Cloudflare dashboard first, which usually needs a payment method even on the free tier. Not needed until phase 9.

**The Turso auth token was pasted into a chat transcript.** Rotate it in the dashboard before this is anything other than a prototype.

---

## Decisions worth remembering

- **Next.js 16, not 15.** Turbopack is default, `params`/`cookies`/`headers` are async, and middleware is now `proxy.ts`.
- **`jose` cookie, not Auth.js.** One credentials provider and three fixed roles did not justify the adapter surface.
- **One table per infotype, not a JSON blob.** Payroll needs typed, indexed, foreign-keyed salary values.
- **Database connects lazily.** Throwing at module scope failed the Vercel build while collecting page data.
- **The mockups supply features, not appearance.** Their green accent, uppercase headings and per-row pills all contradict DESIGN_LANGUAGE.md and were discarded. See BUILD_PLAN §8.
