# HRMS

The HR module of your ERP. It holds your organisation and the people in it, and runs what has to be right every month: pay, leave, hiring, performance and tax. It is built for Indian companies (Indian payroll and income tax, rupees, Indian dates), works on phones as well as computers, and exchanges data with your ERP in both directions.

**Try it:** [hrms-amogh24.vercel.app](https://hrms-amogh24.vercel.app). Choose an account on the sign-in page to see the software as that person sees it:

| Account | Sees |
|---|---|
| Priya Sharma — HR administrator | The whole back office |
| Ravi Kumar — manager | Their team's approvals, ratings and calendar, and their own records |
| Arjun Mehta — employee | Their own profile, leave, payslips, tax and appraisal |
| Neha Iyer — recruiter | Hiring, and no salaries anywhere |

The public careers site is at [/careers](https://hrms-amogh24.vercel.app/careers).

---

## What it does

### For everyone

- **A home screen made for each person**: only what they need to act on, the figures that matter to them, and what is coming up — leave, holidays, interviews, birthdays and work anniversaries.
- **Search everything** from anywhere with Ctrl K (⌘K on a Mac): pages, actions, and — for those allowed — people.
- **Notifications** in an inbox, and by email, for leave decisions, approvals waiting, payslips, reviews and interviews. Each person chooses what they hear about.
- **Works on phones and computers**, built to the WCAG 2.1 AA accessibility standard and checked against it automatically on every change.
- **Install it on your phone**: add HRMS to the home screen and it opens full screen, like an app. Nothing about you is stored on the phone.

### Employees

- **My profile**: everything the company holds about you, and who in HR has opened your pay, bank or documents, with the time.
- **Request a change** to your personal details, addresses, contacts or bank account. HR checks it, and it applies from the date you choose, with your record keeping what it said before. A bank change needs proof and two approvers.
- **Leave**: apply, see your balances, and follow each request to its decision.
- **Payslips**: every month's payslip, itemised line by line with the year to date, to download as a PDF — and emailed to you as a password-protected PDF when the month is posted.
- **Tax**: declare your investments under either tax regime, and download your Form 16.
- **Appraisal**: write your self review and see your final rating.
- **While I am away**: hand your approvals to a colleague for the dates you are out.

### Managers

- **Approvals** for their team, in one inbox.
- **Team calendar**: who is away, and when.
- **Ratings** for their team in each appraisal cycle.
- **Interviews** they are asked to take, with the candidate's details and a place to record their notes.

### Organisation

- Companies, locations, departments, jobs and positions, each with the dates it is valid for, so the structure has a history.
- Reporting lines between positions, and an **org chart** drawn from them.
- Vacant positions, ready for hiring.

### Employee records

- **Every fact is dated.** A change is added from the day it applies, and the old value is kept — so you can see anyone's pay, position or address as it was on any past date.
- **Guided hiring** that creates everything a new employee needs in one step: their job, personal details, working time and pay.
- Personal details, addresses, contacts, family, bank account, working time and pay, each with its full history.
- **Documents** filed on each employee's record.
- **Mass updates** for many employees at once.
- **Change history** on every record: who changed what, when, and the value before and after.

### Time and leave

- Leave types, yearly entitlements and balances, down to half days.
- Leave requests that follow the approval route you set — by default the employee's manager, with HR added for longer leave.
- Unpaid leave flows into payroll as a deduction automatically.
- Attendance and overtime, work schedules, public holidays.
- A monthly time evaluation that gives payroll each person's paid days and overtime.

### Payroll

- Monthly payroll periods that open, lock for processing and are posted.
- **Gross to net for every employee**: basic pay by days employed, allowances, recurring and one-off payments, unpaid-leave proration, provident fund and income tax.
- **Joiners, leavers and mid-month raises** paid correctly by the day.
- **Arrears** paid automatically, once, when a month already paid is corrected afterwards.
- **Off-cycle runs** for bonuses and corrections outside the monthly run.
- **A check before posting** that lists everyone new, and everyone whose pay moved by 10% or more.
- Runs continue in the background, so nobody waits on the screen.
- **Payslips** for every employee, itemised line by line with the year to date, as a page or a PDF.
- **Payslips by email**: posting a month emails each person their payslip as a password-protected PDF, once; HR can send one again.
- **The bank transfer file**, **the accounting journal** by cost centre, and **statutory remittances** with their due dates.

### Tax and Form 16

- Tax sections and slabs for each year and both regimes.
- Employee declarations, with tax deducted evenly across the year.
- The quarterly register of tax deducted and deposited.
- **Form 16**, Part A and Part B, which reconcile with each other, including the new regime's marginal relief under section 87A.

### Recruitment

- **Requisitions** for vacant positions that describe the role: title, description, qualifications, skills, experience, place, and a salary budget only HR sees.
- **A public careers site** where candidates apply for published roles with their resume — no account needed. Candidates get an acknowledgement, and recruiters are told.
- **Screening**: reject a profile, or take it to interview.
- **Interview rounds**, as many as each candidate needs, each with its own interviewer, date, time and place. Interviewers are told, and record their own notes, rating and recommendation.
- **Approve or reject** a candidate once the rounds are done, **make the offer**, and **turn them into an employee** without retyping anything.
- One record per candidate, whichever roles they apply for, with their resume and history.

### Performance

- Yearly appraisal cycles with goals, self reviews and manager ratings.
- **Calibration** of ratings across the organisation.
- **Increments** that become the next month's pay automatically.

### Approvals

- **Approval routes you configure** for leave and for corrections to employee records: who approves each kind of request, extra steps for larger requests or bank changes, and HR brought in when a request waits too long.
- **Two people for a bank change**: the person who approved one step can never approve the next.
- **One inbox** for everything waiting on each person.
- **Delegation** while someone is away, recorded as "approved on behalf of".

### Reports

- Headcount, payroll cost and leave by department, and attrition.
- Exports to spreadsheet (CSV).

### Security and control

- **Roles you define**: HR builds roles from plain-language permissions and gives them to people — a recruiter who sees candidates but no pay, an auditor who reads but cannot change.
- **Limits by company or location**, so a role sees only its own people.
- **Salaries and bank accounts are hidden** from anyone without the permission to see them.
- **Every change is recorded** with who made it and the value before and after.
- **Every look at sensitive data is recorded** — pay, bank details, tax and documents — and employees can see who looked at theirs.

### Connection to your ERP

- **Two-way exchange through a secure API.** The HRMS sends people, organisation, time and payroll as they change, including the payroll journal and the salaries to pay. Your ERP sends back what it owns — cost centres, accounts, payments made — and confirms what it booked.
- **Each kind of record has one owner**, so the two systems never overwrite each other.
- **HR can see the connection at work**: what was sent, what the ERP booked, anything that could not be applied, and a reconciliation of every payroll journal against what the ERP recorded.
- **Your ERP's own employee portal can use it too**: show payslips as PDFs, and send corrections employees ask for, which HR approves as usual.
- **A complete guide for your ERP's developers**, a live reference, and a practice environment to build against.

---

## Coming next

- **Joining and moving**: onboarding checklists, probation and confirmation, transfers and promotions as guided steps, and letters from templates.
- **Organisation**: requests for new positions with approval, bulk import from spreadsheets, and a drawn org chart.
- **Leave**: policies by grade and location, state holiday calendars, monthly accrual with carry-forward and lapse, balance forecasts, compensatory off and leave encashment.
- **Attendance**: shift rosters, attendance devices, and approving missed punches.
- **Payroll**: salary structures and CTC; ESI, professional tax, labour welfare fund and the employer's PF share; the EPFO file; costs split across cost centres; loans and advances; reimbursement claims.
- **Exits**: resignation, clearance, and full and final settlement.
- **Tax**: investment proofs, HRA worked out from rent, a comparison of the two regimes, Form 12BA, relief on arrears, and the quarterly TDS return file.
- **Recruitment**: interview slots and calendar invitations, scorecards, offer letters signed online, referrals, and hiring reports.
- **Performance and learning**: check-ins through the year, 360-degree feedback, improvement plans, and training with certificate expiry alerts.
- **Reports**: trends over time, the value of untaken leave, and reports emailed on a schedule.
- **Switching on**: email delivery, cloud storage for documents, and going live with your ERP.

---

## Good to know

- **Emails are prepared but not yet sent.** Every notification email is written and can be read on the Outbox screen; they go out once an email provider is connected.
- **Statutory coverage is employee provident fund and income tax.** ESI, professional tax, labour welfare fund, gratuity and the employer's PF share are not calculated yet.
- **The demo organisation** (Acme Manufacturing) is sample data, for trying the software.

connecting a system to it is in [API.md](API.md).
