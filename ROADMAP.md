# Roadmap

Features that would make this HRMS better, kept to what belongs in the HR module of an ERP for an Indian company — here, the ERP the client is building, which this module connects to both ways. What is needed to make the existing features safe for real data is a separate list, in [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md); this one is about what the product could do next.

The phase-by-phase plan to build all of them is in [build_plan_extended_features.md](build_plan_extended_features.md).

---

## Built in phase 9, beyond the original plan

| Feature | Why it matters |
|---|---|
| My profile | Employees see what the company holds about them, their documents, and who has opened their records — the question the access log exists to answer. |
| Employee documents | Offer letters and identity proofs live with the record they belong to, with every download logged. |
| Team calendar | Managers plan around who is away without opening each request. |
| Payroll variance check | The check a payroll clerk makes before posting — who is new, whose pay moved and why — done for them. |
| CSV exports | Employees, payroll runs by wage type, and the tax register, for finance and the 24Q return. |
| Birthdays and work anniversaries | Small, and the kind of thing that makes a home screen worth opening. |
| HR reports | Headcount, cost and leave by department, and attrition. |
| One-click demo sign-in | A walkthrough without a password. |

## Built in phase 10

| Feature | Why it matters |
|---|---|
| Notifications | Leave asked for and decided, payslips ready, self reviews due and ratings finalised reach the right person in an inbox with an unread count, and by email once a provider is connected. Each person chooses what they hear about. |
| Change log viewer | Every change, by whom and when, with the value before and after — on each employee's record and across the organisation, alongside the read log. |
| Background jobs | Payroll runs and every notice are worked on the server; nothing waits for a browser. |
| An outbox | Every email the system writes can be read exactly as it would be sent, before any provider is connected. |

---

## Employee self-service

| Feature | Why it matters |
|---|---|
| Request a correction | Employees can see their record but must ask HR to change it. A request that HR approves keeps the dated history intact. |
| Investment proofs (Form 12BB) | Employees upload rent receipts and 80C proofs against their declaration; HR verifies them before the year-end tax recalculation. |
| Tax regime comparison | Shows an employee their tax under both regimes from their own figures before they choose. |
| Year-to-date on the payslip | Gross, tax and PF so far this year, which employees need for their own filing. |
| Payslips by email | Posted payslips delivered as a PDF, password-protected. |
| Leave balance forecast | What the balance will be on a future date, counting approved leave and accrual. |
| Installable phone app | The phone layouts already exist; a web app manifest and offline payslips make it feel native. |

## Managers

| Feature | Why it matters |
|---|---|
| Delegate approvals | A manager on leave hands their queue to someone for the dates they are away. |
| Team attendance regularisation | Approve a forgotten check-in or a missed punch. |
| Headcount requests | A manager asks for a new position; HR and finance approve it before a requisition opens. |

## Core HR

| Feature | Why it matters |
|---|---|
| Onboarding checklists | Laptop, accounts, documents, induction — tasks assigned from the hire action and tracked to done. |
| Probation and confirmation | A due date from the hire date, a manager's recommendation, and a confirmation action. |
| Transfers and promotions as actions | Guided actions like hiring, writing org assignment and pay together, effective from a date. |
| Exit management | Resignation, notice period, clearance from each department, and full and final settlement. |
| Letters from templates | Offer, appointment, experience and relieving letters filled from the record and stored as documents. |
| Bulk import | Load employees and their history from a spreadsheet, with a check before anything is written. |
| A drawn org chart | The hierarchy as boxes and lines, not only an indented list. |

## Time and absence

| Feature | Why it matters |
|---|---|
| Shift rosters | Who works which shift on which day, for plants and support teams. |
| Attendance devices | Import punches from biometric devices instead of recording attendance by hand. |
| Leave accrual, carry-forward and lapse | Entitlement earned monthly, part carried into next year, the rest lapsing, per policy. |
| Leave encashment | Paying unused leave, on exit or yearly, through payroll. |
| Compensatory off | Time off earned for working a holiday, with an expiry. |
| Regional holiday calendars | Holidays differ by state; today there is one national list. |
| Policies by grade | Different entitlements for different grades or locations. |

## Payroll

| Feature | Why it matters |
|---|---|
| ESI, professional tax, LWF, employer PF | Statutory deductions and contributions still missing — see PRODUCTION_READINESS.md. |
| ECR file for EPFO | The monthly provident fund upload in EPFO's format. |
| Salary structures and CTC | Components by grade, a CTC letter, and the breakdown shown to the employee. |
| Loans and advances | EMI schedules with an outstanding balance, recovered through payroll. |
| Reimbursement claims | Claims with bills and approval, paid through payroll. |
| Full and final settlement | Leave encashment, notice recovery and gratuity in one off-cycle run on exit. |
| Accounting export | The payroll journal as a file, for audit, and as a fallback when the link to the ERP is down. |
| Split cost centres | One person's cost shared across projects by percentage. |

## Tax

| Feature | Why it matters |
|---|---|
| HRA computed from rent | The exemption worked out from salary, rent and city, not typed in. |
| 24Q return file | The quarterly return generated from the register, ready for the government's validation utility. |
| Form 12BA | Perquisites statement, issued with Form 16. |
| Section 89 relief | Relief on arrears that belong to earlier years. |

## Recruitment

| Feature | Why it matters |
|---|---|
| Careers page | Applicants apply to open requisitions directly, with a resume upload. |
| Interview scheduling | Propose slots, invite interviewers through their calendar, and remind them. |
| Structured scorecards | The same questions for every candidate for a role, so feedback compares. |
| Offer letters with e-signature | Generated from the offer, signed online, converting on acceptance. |
| Referral tracking | Who referred whom, and the referral bonus through payroll on joining. |
| Recruitment analytics | Time to hire, source effectiveness, drop-off by stage. |

## Performance

| Feature | Why it matters |
|---|---|
| Goal check-ins | Progress through the year, not only at the review. |
| 360-degree feedback | Peers and reports contribute to a review. |
| Calibration distribution | The spread of ratings as a bar list, against a guideline, during calibration. |
| Improvement plans | A plan with goals and dates for someone who is struggling. |

## Learning

| Feature | Why it matters |
|---|---|
| Training catalogue and nominations | Courses, who attended, and certificates. |
| Certification expiry | Alerts before a safety or professional certificate lapses — important in a factory. |

## Reports and analytics

| Feature | Why it matters |
|---|---|
| Trends over time | Headcount, cost and attrition month by month, not only today. |
| Leave liability | The value of untaken leave, which finance must provide for. |
| Scheduled reports | A report emailed to someone every month. |

## Platform

| Feature | Why it matters |
|---|---|
| Configurable approvals | Who approves what, set by HR rather than code. |
| Roles and permissions screen | Defining roles from permissions, instead of three fixed roles. |
| Two-way integration with the client's ERP | This HRMS is a module of the ERP the client is building. The two must exchange data in both directions through an API: the HRMS sends people, organisation, time and payroll changes and the payroll journal as they happen; the ERP sends back what it owns — accounts and cost centres, payment confirmations, earnings and deductions that start on its side — and acknowledges what it received. A documented contract their developers build against, with a sandbox to test in. |
