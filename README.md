# HRMS

The HR module of an ERP. It holds the org structure, the people in it, and the four things a company has to get right every month: pay them, track their time, hire their replacements, and account for their tax.

Modelled on how SAP HCM organises the same problem, built to be operated by people who have never used SAP.

---

## Who uses it

**HR administrators** run the back office. They build the org structure, hire and transfer people, maintain employee records, run payroll, and produce statutory returns.

**Managers** approve their team's leave, rate their team's performance, and recommend increments.

**Employees** see what the company holds about them, apply for leave, watch their own balances, read their payslips, declare their tax investments, and download their Form 16.

Each role opens to a different home screen showing only what that person has to decide or act on: one card of what needs attention, the four figures that matter to them, and what is coming up this fortnight.

While this is a prototype, the sign-in page lists one demo account per role, and a click signs straight in.

---

## What it covers

### Org management
The backbone everything else hangs from. Company, location, sub-location, job, department and position, each with validity dates so the structure has a history rather than just a current state. Positions carry their own reporting lines, so the org chart is derived from real data, not drawn by hand.

### Core HR
Employee master data held the way SAP holds it: every fact about a person is a dated record, not a field that gets overwritten. Change someone's salary and the old figure is delimited rather than destroyed, so you can always ask what an employee's pay, position or address was on any past date and get a truthful answer.

Hiring is a guided action rather than a form. Choose the action, the org assignment, the personal details and the starting pay, and the underlying records are created together or not at all.

HR keeps each person's documents — offer letters, identity and address proofs — on their record, and every time someone opens a person's pay, bank details, tax or documents, it is logged. HR sees that log on the record; the employee sees it on their own profile, under "Who has viewed your records".

### Time and absence
Leave types, annual entitlements, and a request that actually travels: an employee applies, their manager approves or rejects, the balance moves, and unpaid leave reaches payroll as a deduction. Attendance, overtime, shift patterns and the public holiday calendar sit alongside it.

A team calendar shows who is away on which day, including requests still waiting on a decision.

### Payroll
A payroll period opens, locks for processing, and closes once posted — so nobody edits the inputs to a run that has already been paid.

The run itself works gross to net: basic pay for the days each person was employed, allowances, recurring and one-off payments, unpaid-leave proration, arrears, provident fund and tax, ending in a net figure and a payslip that itemises every line. Employees missing bank details are flagged rather than silently skipped.

- **Joiners, leavers and mid-month raises** are paid for exactly the working days each rate applied.
- **Corrections to months already paid** — a raise backdated by an increment, unpaid leave recorded late — are paid or recovered as arrears in the next run, once.
- **Tax is spread evenly across the year**, from what has been paid and deducted so far; tax on a bonus is taken in the month it is paid.
- **Off-cycle runs** pay a bonus or a final settlement outside the monthly run, even after the month is posted.
- **Before posting**, the run lists everyone new or whose pay moved by 10% or more since last month, with the likely reason.
- Runs are calculated on the server in small batches, so a large organisation never meets a time limit, and a run finishes whether or not anyone keeps the screen open.

Downstream it produces the bank transfer file as a download, the journal entries for the finance ledger by cost centre, and the statutory remittances owed to each authority. Any run exports to a spreadsheet with a column per wage type.

### Recruitment
Requisitions against vacant positions, candidates and their applications, a pipeline from applied through screened, interviewed and offered, and interview rounds with feedback and ratings.

When an offer is accepted, the candidate converts into an employee — the same hiring action Core HR uses, with the position, department and job carried across from the requisition. The vacancy closes automatically.

### Performance and increments
An annual cycle: goals with weightings at the start, self and manager ratings at the end, then calibration so ratings mean the same thing across teams before anyone is told a number.

A finalised rating becomes an increment recommendation. Approve it and it becomes the employee's new basic pay, effective from a date you choose, and the next payroll run picks it up. No re-keying.

### Tax and Form 16
Investment declarations under the old and new regimes, a quarterly register of tax deducted and deposited with challan references, and both halves of the annual certificate — Part A's quarterly summary and Part B's full computation from gross salary through exemptions and deductions to tax payable.

Part B reconciles against Part A, so the certificate an employee files with is internally consistent. Section 87A's rebate includes the new regime's marginal relief just above ₹12 lakh.

### Notifications and the change log
People hear about what concerns them: a manager when someone asks for leave, an employee when it is decided, when their payslip is ready, when a self review is due and when their rating is final. It arrives in an inbox behind the bell, with an unread count, and by email once an email provider is connected. Each person chooses what they hear about, and how. HR can read every email in the outbox exactly as it would be sent.

Every change anyone makes is recorded with who made it and the value before and after — on each employee's record ("Basic pay from 1 Apr 2025: ₹65,000 → ₹72,000") and across the organisation, filtered by what changed, who changed it and when. With the read log, that is the whole audit trail: who looked, and who changed what.

### Reports
Headcount and payroll cost by department, leave taken by kind, joiners, leavers and attrition — the numbers someone asks for in a meeting — and CSV exports of the employee list, payroll runs and the tax register.

---

## How the modules connect

Nothing here is a standalone screen. The value is in the seams:

- A hire in **recruitment** creates the employee record in **core HR**.
- An approved unpaid leave in **time** becomes a deduction in **payroll**.
- An approved increment in **performance** becomes the new basic pay that **payroll** reads next month.
- Tax deducted by **payroll** each quarter becomes the register that **Form 16** is built from.
- Payroll results post to the **finance** ledger against the cost centre from the employee's org assignment.

---

## Design

One typeface, near-black ink on white, separated by hairlines. Red appears only where something is wrong — money overdue, a record that failed to process — and never as decoration. Status is carried by shape and words, so it survives a greyscale print and a colour-blind reader. Every screen has at most one obvious next step.

The full specification is in [DESIGN_LANGUAGE.md](DESIGN_LANGUAGE.md).

---

## Status

A working prototype. All seven modules and every screen in the original blueprint are built, with role dashboards, a command menu (Ctrl K), print-ready payslips and certificates, and phone layouts. Notifications, background jobs and the change log are in (phase 10 of the extended plan). Every push is typechecked, linted, tested, built and audited for accessibility by CI, and deploys to a live URL.

It is not production software yet — the statutory scope is partial and the authentication is a demo's. What it would take is written down in [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md), what could come next in [ROADMAP.md](ROADMAP.md), and the phase-by-phase plan for building it — including the two-way API through which the client's ERP and this module exchange data — in [build_plan_extended_features.md](build_plan_extended_features.md).

Where the build stands is in [STATUS.md](STATUS.md). Developer documentation — environment setup, the data model, the engines and the phase plan — is in [BUILD_PLAN.md](BUILD_PLAN.md).
