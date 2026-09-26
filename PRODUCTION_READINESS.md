# Production readiness

What it would take to run real people's pay on this system, rather than a demo organisation of three.

The prototype is feature-complete against its blueprint, tested (133 automated tests, a mutation check on the payroll engine, and an accessibility and phone-width audit of every screen, all run by CI on every push), and deployed. Every change is logged with who made it and what it was before. None of that makes it production software. This document lists the gap, in the order it has to close.

**How to read it.** Items are grouped by when they must be done:

- **Before real data** — must be done before any real employee's personal data goes in.
- **Before the first real payroll** — must be done before the system pays anyone.
- **After go-live** — needed for a system people depend on, but not blocking day one.

Each item says why it matters, because the reason decides how much effort it deserves.

---

## 1. Before real data

### Identity and sign-in

| What | Why | What to do |
|---|---|---|
| Replace demo sign-in | One click signs anyone into the HR administrator account. That is the point of a demo and the end of a real system. | Set `DEMO_SIGN_IN=off` and delete the three seeded accounts. |
| Single sign-on | Staff should use the company's identity provider, so leavers lose access the day they leave and passwords are not stored here. | OIDC or SAML against Microsoft Entra ID or Google Workspace. Keep the `jose` session, mint it after the provider's callback. |
| Multi-factor authentication | An HR account can read every salary and bank account. | Enforce MFA at the identity provider for every role, and step-up for payroll release and posting. |
| Revocable sessions | The session is a signed cookie valid for eight hours; there is no way to end it early. A stolen laptop keeps access for the rest of the day. | Keep a server-side session record the cookie points at, so sign-out and "sign out everywhere" actually end the session. |
| Rate limiting on sign-in | The password form has no limit on attempts. | Limit by account and by IP, with lockout and an alert. Moot once single sign-on replaces passwords. |
| Accounts follow employment | Today accounts are seeded by hand and not tied to hire or termination. | Create the account at hire, disable it on the termination date, automatically. |

### Secrets

| What | Why | What to do |
|---|---|---|
| **Rotate the Turso token now** | It has been pasted into chat transcripts more than once. Anyone with it can read and change every record. | Rotate in the Turso dashboard, update Vercel and `.env.local`. |
| One set of secrets per environment | Production, preview and local share one database and one token today. | A database and a token per environment; production secrets only in Vercel's production scope. |
| Secret scanning | So the next leak is caught at the commit, not afterwards. | Enable GitHub secret scanning and push protection. |

### Who can see and do what

| What | Why | What to do |
|---|---|---|
| Finer roles | Three roles is a demo. A recruiter should not see salaries; a payroll clerk should not edit the org structure. | Add roles such as HR generalist, payroll administrator, recruiter, auditor (read-only); map each screen and Server Function to permissions rather than roles. |
| Maker and checker | One person can today change a salary, run payroll, post it and generate the bank file. | Require a second person to approve salary changes above a threshold, payroll release, posting and the bank file. |
| Scope by company and location | HR at one company can see every company's people. | Scope HR roles to companies or personnel areas, enforced in the repositories, not only on screens. |
| An authorisation test matrix | A missing check was found in this prototype — the employee list had none, and employees could read everyone's salary. There will be others. | A test per Server Function and route, per role, asserting allowed or refused. |

### Protecting personal data

| What | Why | What to do |
|---|---|---|
| Encrypt sensitive fields | Bank account numbers, PAN and Aadhaar sit in plain text; a database leak exposes them directly. | Application-level encryption for those columns, with keys outside the database; decrypt only where shown. |
| Mask by default | The profile masks the bank account; HR screens do not. | Mask everywhere, reveal on an explicit action, and log the reveal. |
| Keep data in India | The Turso database is in `aws-us-west-2`. Indian employee data leaving India needs a reason and a contract. | Move the database to an Indian region (AWS ap-south-1) or document the transfer basis. |
| Security headers | No content security policy, HSTS or frame protection is set. | Add CSP, HSTS, `frame-ancestors 'none'`, `Referrer-Policy` and `Permissions-Policy` in `next.config.ts`. |
| Scan uploads | Uploads are checked by content type but not for malware. | Scan on upload (for example ClamAV in a function, or a scanning service) before the file can be downloaded. |
| Keep dependencies patched | The production dependencies are clean today; `npm audit` reports four moderate issues in development tooling. That changes weekly. | Dependabot or Renovate with automatic security updates, and `npm audit --omit=dev` in CI. |
| A penetration test | Nobody has attacked this system on purpose yet. | Before go-live, by someone independent. |

### The Digital Personal Data Protection Act, 2023

| What | Why | What to do |
|---|---|---|
| Privacy notice | Employees must be told what is held, why, and for how long. | A notice at first sign-in, recorded as seen. |
| Retention schedule | Payroll records must be kept for years under tax and labour law; other data should not be kept forever. | A schedule per record type, agreed with legal counsel, and a job that applies it. |
| Correction requests | "Ask HR" is the only route today. | A request on the profile that HR approves, feeding the dated history like any other change. |
| Breach response | The law sets deadlines for notifying the Board and the people affected. | A written runbook, and contacts at Turso, Vercel and Cloudflare. |
| Processor agreements | Turso, Vercel and Cloudflare process employee data. | Data processing agreements with each. |
| Log retention and review | The read log and the change log exist; nobody reviews them and nothing ages them out. The change log also holds personal data as it was before each change. | Keep each for a defined period, review unusual access such as bulk exports, and include both in the retention schedule. |

---

## 2. Before the first real payroll

### Statutory coverage in India

The engine handles provident fund (the employee's share) and income tax. A real payroll needs more.

| What | Why |
|---|---|
| **Employer PF, EPS and EDLI** | The employer's 12% splits into EPF and EPS (capped), plus EDLI and admin charges — none are calculated, so the ledger understates cost and the remittance is short. |
| **ECR file for EPFO** | Provident fund is remitted by uploading an Electronic Challan cum Return in EPFO's format, with each member's UAN. |
| **ESI** | Employees earning up to ₹21,000 a month contribute 0.75% and the employer 3.25%. Not calculated. |
| **Professional tax** | Levied by most states on their own slabs (Karnataka, Maharashtra and others). Not calculated. |
| **Labour Welfare Fund** | State-specific, often half-yearly. Not calculated. |
| **Gratuity and bonus** | Gratuity must be provided for and paid on leaving after five years; the Payment of Bonus Act applies to many salaries. |
| **Income tax completeness** | Surcharge above ₹50 lakh; perquisites; income from a previous employer in the year (Form 12B); relief under section 89 for arrears; HRA exemption computed from rent paid rather than a declared figure; proof collection (Form 12BB) and verification before the year end. |
| **The 24Q return** | Quarterly TDS returns are filed as an FVU file generated from the government's utility; the register is the source, but the file is not produced. |
| **Form 16 as issued** | Part A is downloaded from TRACES and Part B is issued by the employer, digitally signed. The certificate here is a faithful computation, not the issued document. |
| **Tax rules as data** | Standard deduction, the 87A limits, cess and the PF wage ceiling are constants in code. Budget changes happen every February. Move them into dated configuration the way tax slabs already are. |

### Running payroll safely

| What | Why | What to do |
|---|---|---|
| **A parallel run** | The only real proof a payroll is right. | Run alongside the existing payroll for two or three payroll cycles and reconcile every payslip to the paisa before switching over. |
| Full and final settlement | Leavers are paid to their last day, but leave encashment, notice-period recovery and gratuity are not calculated. | A settlement action that produces an off-cycle run with those lines. |
| Loans and advances | A loan is a recurring deduction today, with no balance or schedule. | A loan record with an EMI schedule and an outstanding balance. |
| Reimbursements | A one-off payment with no claim, bill or approval behind it. | Claims with receipts and an approval step, paid through payroll. |
| Salary structures | Allowances are percentages of basic for everyone. Real organisations offer a CTC broken into components by grade. | Structures per grade, and the CTC shown to the employee. |
| Retro limits | Retro sees records *added* after a month was paid, not records deleted, and stops at the financial year. | Read deletions from the change log, which now records them, and extend retro across the year end with the tax effect on the right year. |
| Bank formats and reconciliation | The bank file is a generic NEFT CSV. Banks each have their own bulk formats, and failed credits come back. | Formats per bank (or host-to-host), and reconciliation of what was actually credited. |
| Payroll inputs cut-off | Inputs can change up to the moment of the run. | A cut-off date per period after which changes go to next month or through retro. |

### Data migration

| What | Why |
|---|---|
| Import from the current system | Every employee, their dated history, year-to-date pay and tax already deducted. Without year-to-date figures, the TDS projection assumes months before go-live were paid at today's rate — a documented approximation, not a substitute. |
| Remove the demo organisation | Acme Manufacturing, the three employees, candidates and appraisals are seeded into the production database today. |
| Verify the import | Headcount, salary totals and year-to-date tax reconciled against the old system before anyone is paid from the new one. |

---

## 3. After go-live

### Environments and data

| What | Why | What to do |
|---|---|---|
| Separate databases | Local development currently points at production unless told otherwise. One mistake in a script changes live records. | Turso databases for production and preview; local development on `file:.local/dev.db` by default. |
| Migrations in the pipeline | Migrations are applied by hand from a laptop. | Apply them in CI before the deploy that needs them, and fail the deploy if they fail. |
| Backups you have restored | Turso keeps point-in-time history; nobody has tried restoring from it. | Schedule a restore drill, and write down how long it took. |
| Employee pickers that scale | Forms that choose an employee list everyone. Fine at hundreds, unusable at thousands. | A searchable picker that queries as you type, like the command menu. |
| Cloudflare R2 | Documents are stored in the database until R2 is enabled. Fine for resumes, costly for years of payslips and proofs. | Enable R2 on the account and set the four variables — see STATUS.md. |

### Operations

| What | Why | What to do |
|---|---|---|
| Error monitoring | Errors surface only in Vercel's function logs today. | Sentry or similar, with the error boundary's digest linked. |
| Uptime and alerts | `/api/health` exists; nothing watches it. | An uptime check every minute, alerting whoever is on call. |
| Payroll-day runbook | Payroll day is when an outage costs most. | What to check before, during and after a run, and who decides to delay payment. |
| Load test | Payroll has run for three people and for test organisations, not for five thousand. | Run a 5,000-person month against a copy of production and time each stage. |
| Email delivery | Notifications reach the inbox, and emails are written to the outbox, but nothing is sent: no provider is connected. | Choose a provider, verify the sending domain (SPF, DKIM, DMARC) and switch the transport on — phase 25. |
| Job frequency | Vercel Hobby runs the scheduled tick once a day. The runner keeps itself going between ticks, but weekly reminders land at the day's tick. | Set `CRON_SECRET`, and on a paid plan tick every few minutes. |

### Quality

| What | Why | What to do |
|---|---|---|
| Protect `main` | GitHub Actions runs typecheck, lint, `npm test`, a build and `npm run audit:ui` on every push and pull request, but nothing stops a red commit reaching `main`. | Require the CI check and a review before merging. |
| End-to-end flows | Unit and integration tests cover the engines; nothing drives hire → pay → Form 16 through the browser. | Playwright journeys for the main flows, using the same drivers the UI audit uses. |
| Accessibility with real assistive technology | The automated audit catches perhaps a third of accessibility problems. | Walk the main flows with NVDA and VoiceOver, and fix what they find. |

### For the people using it

| What | Why |
|---|---|
| Configuration screens | Leave policies, allowance percentages and statutory constants are seed data or code. HR should change them without a developer. |
| Help and training | Short guides for each role, and inline help on the payroll and tax screens where a mistake costs money. |
| A support route | Who employees ask when their payslip looks wrong, and how HR escalates to whoever maintains the system. |

---

## Go-live checklist

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
