# HRMS

The HR module of an ERP. It holds the org structure, the people in it, and the four things a company has to get right every month: pay them, track their time, hire their replacements, and account for their tax.

Modelled on how SAP HCM organises the same problem, built to be operated by people who have never used SAP.

---

## Who uses it

**HR administrators** run the back office. They build the org structure, hire and transfer people, maintain employee records, run payroll, and produce statutory returns.

**Managers** approve their team's leave, rate their team's performance, and recommend increments.

**Employees** apply for leave, watch their own balances, read their payslips, declare their tax investments, and download their Form 16.

Each role opens to a different home screen showing only what that person has to decide or act on.

---

## What it covers

### Org management
The backbone everything else hangs from. Company, location, sub-location, job, department and position, each with validity dates so the structure has a history rather than just a current state. Positions carry their own reporting lines, so the org chart is derived from real data, not drawn by hand.

### Core HR
Employee master data held the way SAP holds it: every fact about a person is a dated record, not a field that gets overwritten. Change someone's salary and the old figure is delimited rather than destroyed, so you can always ask what an employee's pay, position or address was on any past date and get a truthful answer.

Hiring is a guided action rather than a form. Choose the action, the org assignment, the personal details and the starting pay, and the underlying records are created together or not at all.

### Time and absence
Leave types, annual entitlements, and a request that actually travels: an employee applies, their manager approves or rejects, the balance moves, and unpaid leave reaches payroll as a deduction. Attendance, overtime, shift patterns and the public holiday calendar sit alongside it.

### Payroll
A payroll period opens, locks for processing, and closes once posted — so nobody edits the inputs to a run that has already been paid.

The run itself works gross to net: basic pay, allowances, recurring deductions, one-off payments, unpaid-leave proration, provident fund and tax, ending in a net figure and a payslip that itemises every line. Employees missing bank details are flagged rather than silently skipped.

Downstream it produces the bank transfer file, the journal entries for the finance ledger, and the statutory remittances owed to each authority.

### Recruitment
Requisitions against vacant positions, candidates and their applications, a pipeline from applied through screened, interviewed and offered, and interview rounds with feedback and ratings.

When an offer is accepted, the candidate converts into an employee — the same hiring action Core HR uses, with the position, department and job carried across from the requisition. The vacancy closes automatically.

### Performance and increments
An annual cycle: goals with weightings at the start, self and manager ratings at the end, then calibration so ratings mean the same thing across teams before anyone is told a number.

A finalised rating becomes an increment recommendation. Approve it and it becomes the employee's new basic pay, effective from a date you choose, and the next payroll run picks it up. No re-keying.

### Tax and Form 16
Investment declarations under the old and new regimes, a quarterly register of tax deducted and deposited with challan references, and both halves of the annual certificate — Part A's quarterly summary and Part B's full computation from gross salary through exemptions and deductions to tax payable.

Part B reconciles against Part A, so the certificate an employee files with is internally consistent.

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

Prototype under construction. The seven modules are being built in dependency order, starting with org management, and each phase ships to a live deployment as it completes.

Developer documentation, including the environment setup and the phase plan, is in [BUILD_PLAN.md](BUILD_PLAN.md).
