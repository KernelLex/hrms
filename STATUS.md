# Project status

**Last updated:** 26 Sept 2026 · **Current phase:** 3 of 9 (core HR, next)

Updated at the end of every milestone. For the full plan see [BUILD_PLAN.md](BUILD_PLAN.md); for what the product does see [README.md](README.md).

---

## At a glance

| | |
|---|---|
| Phases complete | 3 of 10 (phases 0, 1 and 2) |
| Real screens built | 8 of 38 |
| Placeholder screens | 10 |
| Database tables | 10 of ~61 |
| Engines built | 0 of 4 |
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
| 3 | Core HR — CH-01…05, time-slice engine | **next** |
| 4 | Time and absence — TM-01…05, quota engine | not started |
| 5 | Payroll — PY-01…05, payroll engine | not started |
| 6 | Recruitment — RC-01…05, hire conversion | not started |
| 7 | Performance — PM-01…05, increment push | not started |
| 8 | Tax and Form 16 — TDS-01…05, tax engine | not started |
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

---

## What is left

### Screens — 38 total, 8 built

| Module | Screens | Nested tabs |
|---|---|---|
| ~~Org management~~ | ~~OM-01…08~~ — done | — |
| Core HR | CH-01…05 | 8 infotype tabs on CH-02 |
| Time and absence | TM-01…05 | 4 across TM-01 and TM-05 |
| Payroll | PY-01…05 | 6 across PY-02 and PY-05 |
| Recruitment | RC-01…05 | — |
| Performance | PM-01…05 | — |
| Tax and Form 16 | TDS-01…05 | — |

51 distinct form surfaces once nested tabs are counted.

### Engines — 0 of 4

1. **Time-slice** — delimit-on-insert plus as-of-date reads. Blocks Core HR.
2. **Quota** — entitlement generation, decrement on approval. Blocks time.
3. **Payroll** — gross to net with proration, PF and TDS. Blocks payroll.
4. **Tax** — slab-based, both regimes, feeding Form 16 Part B.

### Cross-module transactions — 0 of 2

- **Hire conversion** — recruitment creates an employee plus four infotypes atomically.
- **Increment push** — performance writes a new basic-pay slice payroll then reads.

### Remaining tables — about 51

`pa_*` (10), `pt_*` (10), `py_*` (12), `rc_*` (6), `pm_*` (6), `tds_*` (6), `app_document` (1).

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
