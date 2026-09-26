# Roadmap

Features that would make this HRMS better, kept to what belongs in the HR module of an ERP for an Indian company. What is needed to make the existing features safe for real data is a separate list, in [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md); this one is about what the product could do next.

**Size** is a rough guide: **S** is days, **M** is one to two weeks, **L** is longer.

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

---

## Employee self-service

| Feature | Why it matters | Size |
|---|---|---|
| Request a correction | Employees can see their record but must ask HR to change it. A request that HR approves keeps the dated history intact. | M |
| Investment proofs (Form 12BB) | Employees upload rent receipts and 80C proofs against their declaration; HR verifies them before the year-end tax recalculation. | M |
| Tax regime comparison | Shows an employee their tax under both regimes from their own figures before they choose. | S |
| Year-to-date on the payslip | Gross, tax and PF so far this year, which employees need for their own filing. | S |
| Payslips by email | Posted payslips delivered as a PDF, password-protected. | M |
| Leave balance forecast | What the balance will be on a future date, counting approved leave and accrual. | S |
| Installable phone app | The phone layouts already exist; a web app manifest and offline payslips make it feel native. | S |

## Managers

| Feature | Why it matters | Size |
|---|---|---|
| Delegate approvals | A manager on leave hands their queue to someone for the dates they are away. | M |
| Team attendance regularisation | Approve a forgotten check-in or a missed punch. | M |
| Headcount requests | A manager asks for a new position; HR and finance approve it before a requisition opens. | M |

## Core HR

| Feature | Why it matters | Size |
|---|---|---|
| Onboarding checklists | Laptop, accounts, documents, induction — tasks assigned from the hire action and tracked to done. | M |
| Probation and confirmation | A due date from the hire date, a manager's recommendation, and a confirmation action. | S |
| Transfers and promotions as actions | Guided actions like hiring, writing org assignment and pay together, effective from a date. | M |
| Exit management | Resignation, notice period, clearance from each department, and full and final settlement. | L |
| Letters from templates | Offer, appointment, experience and relieving letters filled from the record and stored as documents. | M |
| Bulk import | Load employees and their history from a spreadsheet, with a check before anything is written. | M |
| A drawn org chart | The hierarchy as boxes and lines, not only an indented list. | M |

## Time and absence

| Feature | Why it matters | Size |
|---|---|---|
| Shift rosters | Who works which shift on which day, for plants and support teams. | L |
| Attendance devices | Import punches from biometric devices instead of recording attendance by hand. | M |
| Leave accrual, carry-forward and lapse | Entitlement earned monthly, part carried into next year, the rest lapsing, per policy. | M |
| Leave encashment | Paying unused leave, on exit or yearly, through payroll. | S |
| Compensatory off | Time off earned for working a holiday, with an expiry. | S |
| Regional holiday calendars | Holidays differ by state; today there is one national list. | S |
| Policies by grade | Different entitlements for different grades or locations. | M |

## Payroll

| Feature | Why it matters | Size |
|---|---|---|
| ESI, professional tax, LWF, employer PF | Statutory deductions and contributions still missing — see PRODUCTION_READINESS.md. | L |
| ECR file for EPFO | The monthly provident fund upload in EPFO's format. | M |
| Salary structures and CTC | Components by grade, a CTC letter, and the breakdown shown to the employee. | M |
| Loans and advances | EMI schedules with an outstanding balance, recovered through payroll. | M |
| Reimbursement claims | Claims with bills and approval, paid through payroll. | M |
| Full and final settlement | Leave encashment, notice recovery and gratuity in one off-cycle run on exit. | M |
| Accounting export | The ledger posting as a file Tally or SAP FI can import. | S |
| Split cost centres | One person's cost shared across projects by percentage. | M |

## Tax

| Feature | Why it matters | Size |
|---|---|---|
| HRA computed from rent | The exemption worked out from salary, rent and city, not typed in. | S |
| 24Q return file | The quarterly return generated from the register, ready for the government's validation utility. | M |
| Form 12BA | Perquisites statement, issued with Form 16. | S |
| Section 89 relief | Relief on arrears that belong to earlier years. | M |

## Recruitment

| Feature | Why it matters | Size |
|---|---|---|
| Careers page | Applicants apply to open requisitions directly, with a resume upload. | M |
| Interview scheduling | Propose slots, invite interviewers through their calendar, and remind them. | M |
| Structured scorecards | The same questions for every candidate for a role, so feedback compares. | S |
| Offer letters with e-signature | Generated from the offer, signed online, converting on acceptance. | M |
| Referral tracking | Who referred whom, and the referral bonus through payroll on joining. | S |
| Recruitment analytics | Time to hire, source effectiveness, drop-off by stage. | S |

## Performance

| Feature | Why it matters | Size |
|---|---|---|
| Goal check-ins | Progress through the year, not only at the review. | M |
| 360-degree feedback | Peers and reports contribute to a review. | M |
| Calibration distribution | The spread of ratings as a bar list, against a guideline, during calibration. | S |
| Improvement plans | A plan with goals and dates for someone who is struggling. | S |

## Learning

| Feature | Why it matters | Size |
|---|---|---|
| Training catalogue and nominations | Courses, who attended, and certificates. | M |
| Certification expiry | Alerts before a safety or professional certificate lapses — important in a factory. | S |

## Reports and analytics

| Feature | Why it matters | Size |
|---|---|---|
| Trends over time | Headcount, cost and attrition month by month, not only today. | M |
| Leave liability | The value of untaken leave, which finance must provide for. | S |
| Scheduled reports | A report emailed to someone every month. | S |

## Platform

| Feature | Why it matters | Size |
|---|---|---|
| Notifications | Email, and later Teams or Slack, for every workflow event. | M |
| Configurable approvals | Who approves what, set by HR rather than code. | L |
| Roles and permissions screen | Defining roles from permissions, instead of three fixed roles. | M |
| Change log viewer | Every field change, by whom and when, alongside the read log. | M |
| API and webhooks | So other systems can read the org structure and react to hires and exits. | M |
| More than one country | Currencies, calendars and statutory rules per country. | L |
| Hindi and other languages | For employees who work in them. | M |
