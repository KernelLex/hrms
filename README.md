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

## How it all fits together

The modules below are not separate tools bolted together — the same hire, the same leave request, the same rating, carries through automatically wherever it is needed next:

- **Hiring creates the employee.** Whether HR converts a candidate on screen or one accepts an offer through their own link, their job, personal details, working time and pay are created together, in one step — never a half-created record, and nothing retyped a second time.
- **Leave and payroll agree without anyone doing the sums.** An approved day of unpaid leave becomes a deduction in the very next payroll run; a day of leave encashed, or a holiday worked as overtime, is paid the same way.
- **A rating becomes a raise.** An increment agreed during an appraisal cycle becomes next month's basic pay automatically, in time for payroll to read it.
- **Tax follows the money.** Every payroll run adds to the record Form 16 is built from, so your tax return and what was actually deducted can never disagree.
- **Payroll and your ERP stay in step.** Every run posts its ledger entries by cost centre and sends the salaries and statutory dues to be paid; your ERP confirms what it booked and what it paid, both ways, automatically.
- **Nothing changes quietly.** A new hire, a changed address, an approved leave request, a posted payroll run — anything that changes becomes an event your ERP (or any other connected system) can act on as it happens, or catch up on in one request if it has been offline.

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

**How a change request flows:**
1. You fill in the new value and, for a bank change, attach proof.
2. HR reviews it — a bank change also needs a second approver, and whoever decided the first step can never decide the second.
3. Once approved, the change is written in from the date you chose; what it said before is kept, not overwritten.
4. You are notified either way, with the reason if it was turned down.

### Managers

- **Approvals** for their team, in one inbox.
- **Team calendar**: who is away, and when.
- **Ratings** for their team in each appraisal cycle.
- **Interviews** they are asked to take, with the candidate's details and a place to record their notes.

### Organisation

- Companies, locations, departments, jobs and positions, each with the dates it is valid for, so the structure has a history.
- Reporting lines between positions, and an **org chart** drawn as boxes and lines you can search, collapse, pan and zoom — with a plain list alongside it for anyone who needs one.
- Vacant positions, ready for hiring.
- **Headcount requests**: a manager asks for a new position, with its budget; approved by their manager, HR and finance, it opens vacant and ready to hire against.
- **Bulk import**: load positions, employees with their history, and opening balances — what someone earned, paid in tax and had left in leave before switching to this system — from a spreadsheet. Every row is checked before anything is written, and importing the same file twice changes nothing.

**How a headcount request flows:**
1. A manager asks for a new position and gives it a budget.
2. It goes to their own manager, then HR, then finance, in order.
3. Once all three have agreed, the position opens vacant.
4. Recruitment can open a requisition against it straight away.

### Employee records

- **Every fact is dated.** A change is added from the day it applies, and the old value is kept — so you can see anyone's pay, position or address as it was on any past date.
- **Guided hiring** that creates everything a new employee needs in one step: their job, personal details, working time and pay.
- Personal details, addresses, contacts, family, bank account, statutory details (UAN, ESI number, the state professional tax follows), working time and pay, each with its full history.
- **Documents** filed on each employee's record.
- **Mass updates** for many employees at once.
- **Change history** on every record: who changed what, when, and the value before and after.

### Joining and moving

- **Onboarding**: hiring someone starts a checklist of what needs doing — a laptop and accounts, documents, an induction — each task assigned to the right person and tracked to done. What is assigned to you shows up on **My tasks**.
- **Probation**: reviewed on a set date after joining. HR confirms it, pushes the date back, or ends it, with the earlier decision kept on record. A **Probation due** list shows what needs deciding, and HR is reminded.
- **Transfers and promotions** as guided steps, like hiring: a new position, department or company, and for a promotion, new pay — from a date you choose, with the record's history kept intact.
- **Letters**: keep one or more letter templates filled in from the employee's record, and issue one in a couple of clicks. It is kept exactly as issued, even if the record or the template changes afterwards.

**How joining flows, start to finish:**
1. HR runs the guided hire: job, personal details, working time and pay are all created together.
2. Onboarding starts on its own — a checklist of tasks lands on the right people, and on the new joiner's own **My tasks**.
3. On the date set for it, probation comes up on HR's **Probation due** list to confirm, extend or end.
4. Any later move — a transfer, a promotion, a letter — reuses the same record, with every earlier fact still readable on the date it applied.

### Leaving

- **Resign**, with a last working day and a notice period; your manager, then HR, decide.
- **The exit board**: every resignation, termination and retirement, with clearance progress and a settlement waiting to be paid.
- **Clearance checklist** on the way out — laptop and ID card returned, access revoked, the exit interview — the same kind of checklist onboarding already uses, assigned to the right person automatically.
- **One full and final settlement**, paid in a single run on the last day: salary to that day, unused leave encashed, a notice shortfall recovered (or waived by HR), **gratuity** after five years' service, and any outstanding loan recovered in full — with a statement showing every component and how it was worked out.
- **Relieving and experience letters**, from the same templates as any other letter.
- Sign-in stops working from the last day.

**How an exit flows:**
1. The employee resigns, or HR records a termination or retirement, with a last working day.
2. Their manager, then HR, decide — and a clearance checklist starts automatically, each task on the right person.
3. On the last working day, one settlement run pays everything owed together — salary, leave, notice, gratuity, any loan recovered — and produces one statement.
4. Sign-in stops working, and relieving and experience letters are ready to issue.

### Time and leave

- **Leave policies by grade and location**: how much a year, earned monthly or all at once, a joiner's first year pro-rated automatically, a cap on what carries into the new year, and what lapses.
- Balances down to half days, with a running ledger behind each one — "why do I have what I have" — and a forecast of what a balance will be on a future date.
- **State holiday calendars**: give each location its own public holidays, and leave, payroll and time evaluation all use the right one automatically.
- Leave requests that follow the approval route you set — by default the employee's manager, with HR added for longer leave — including the sandwich rule, where a policy asks for it.
- **Compensatory off**, earned by working a holiday or a weekend and spent like leave, and **leave encashment**, paid through the next payroll run at the going daily rate.
- Unpaid leave flows into payroll as a deduction automatically.
- **Shift rosters**: build a rotation once — a three-shift pattern, say — and assign it to a team for a date range; a single day is swapped by exception without touching the rest.
- **Attendance devices**: a punch clock, or anything sending punches to the generic endpoint in front of one, turns into daily attendance automatically — first in, last out, a late mark, overtime, paid at double the hourly rate through the very next payroll run. Sending the same punches twice changes nothing the second time.
- **Ask for a correction**: a missed or wrong punch, explained and sent to a manager to approve; approved, the day is corrected exactly as if the punch had never been missed.
- Work schedules, public holidays.
- A monthly time evaluation that gives payroll each person's paid days and overtime.

**How a leave request flows:**
1. The employee applies, picking the dates and the leave type; their balance and the policy's own rules (like the sandwich rule) are checked straight away.
2. It goes to their manager by default; a longer request also goes to HR. If nobody is set up to decide, it goes to HR anyway.
3. Approved, the balance moves immediately, and if any of it is unpaid, it becomes a deduction in the next payroll run automatically.
4. The employee is notified either way.

**How a punch correction flows:**
1. The employee opens the day in question and explains what was missed or wrong.
2. It goes to their manager to approve.
3. Approved, the day is recalculated exactly as if the original punch had been there — late marks, overtime and all.

### Payroll

- Monthly payroll periods that open, lock for processing and are posted.
- **Gross to net for every employee**: basic pay by days employed, allowances, recurring and one-off payments, unpaid-leave proration, provident fund, ESI, professional tax, the labour welfare fund and income tax.
- **Salary structures and CTC**: define how an annual cost-to-company splits into basic, allowances and a balancing figure, once per structure; assigning a CTC to someone derives their monthly pay from it automatically, from the date you choose. A live preview shows the monthly breakdown for any CTC before you save it.
- **Employer contributions** — the employer's share of PF, ESI and the labour welfare fund — show on the payslip as part of the cost of employing someone, never subtracted from what they are paid.
- **ESI continues correctly through a raise**: once someone is covered, a mid-year rise does not drop them out until the law's own six-month cycle ends.
- **Joiners, leavers and mid-month raises** paid correctly by the day.
- **Arrears** paid automatically, once, when a month already paid is corrected afterwards.
- **Off-cycle runs** for bonuses and corrections outside the monthly run.
- **A check before posting** that lists everyone new, and everyone whose pay moved by 10% or more.
- Runs continue in the background, so nobody waits on the screen.
- **Payslips** for every employee, itemised line by line with the year to date, as a page or a PDF.
- **Payslips by email**: posting a month emails each person their payslip as a password-protected PDF, once; HR can send one again.
- **The bank transfer file**, **the accounting journal** by cost centre (downloadable, and sent to your ERP automatically), and **statutory remittances** — provident fund, ESI, tax, professional tax and the labour welfare fund — each with its due date and a record of when it was paid.
- **The EPFO file** for provident fund, generated in the government's own published format.
- **Cost split across more than one cost centre**, by percentage, for anyone whose pay should not all land on one.
- **Dated statutory rates**: provident fund, ESI, professional tax (state by state) and the labour welfare fund are all rates you can see and change yourself, not figures buried in the software — a rate change is an edit, not a wait for a new release.

**How a month's payroll flows:**
1. HR opens the period. Everything that happened during it — leave, loans, claims, increments, referral bonuses — is already waiting to be picked up.
2. Running it works gross to net for everyone in the background, so nobody has to wait on the screen.
3. Before posting, a check lists everyone new and everyone whose pay moved 10% or more, so a mistake is caught before anyone is paid.
4. Posting locks the period, emails every payslip as a password-protected PDF, produces the bank transfer file, books the accounting journal to your ERP by cost centre, and schedules the statutory remittances with their due dates.

### Money

- **Loans and advances**: ask for a loan and see it approved with its whole EMI schedule generated at once; each instalment is then recovered through payroll automatically, closing the loan at zero. **Prepay** at any time to shorten what is left, at the same EMI. A concessional or interest-free loan's taxable value is worked out automatically, every month, and shown on Form 12BA.
- **Reimbursement claims**: submit a claim with its bills, checked against your category's limit — fuel, phone, medical and LTA, out of the box, with higher limits settable by grade — before it goes for approval. Approved claims, manager then finance, are paid through the very next payroll run. An expense already approved in your ERP arrives the same way, without anyone retyping it.

**How a loan flows:**
1. The employee asks for a loan.
2. Approved, the whole instalment schedule is generated at once, each instalment's interest worked out on the balance it opens the month with.
3. Each instalment is recovered through payroll automatically, with no one re-entering it month after month.
4. The employee can prepay at any time; the remaining instalments are rescheduled at the same EMI, and the loan closes the moment the balance reaches zero.

**How a claim flows:**
1. The employee submits a claim with its bills; it is checked against their category's limit straight away.
2. It goes to their manager, then finance.
3. Approved, it is paid through the very next payroll run — the same as a claim arriving already approved from your ERP.

### Tax and Form 16

- Tax sections and slabs for each year and both regimes.
- Employee declarations, with tax deducted evenly across the year.
- **A comparison of both regimes**, on your own declared figures, right on the declaration — the same arithmetic your monthly tax actually uses.
- **HRA worked out from your rent**: tell us the rent, the landlord and the city, and the exemption is computed for you — the least of three, as the law sets it out — instead of a figure you type in yourself.
- **Proof, verified**: HR opens a window for each year; file a receipt against what you declared, and HR verifies or rejects it. After the window closes, only what was verified still reduces your tax.
- The quarterly register of tax deducted and deposited, with a **24Q** file for each quarter.
- **Form 16**, Part A and Part B, which reconcile with each other, including the new regime's marginal relief under section 87A — with **Form 12BA** alongside it for perquisites, and **Section 89 relief** worked out for arrears that belong to an earlier year.

**How a year's tax flows:**
1. The employee declares their investments under either regime, with a side-by-side comparison on their own figures.
2. Tax is deducted evenly across the months that follow, using exactly what was declared.
3. When HR opens the proof window, the employee files a receipt for each investment; HR verifies or rejects it.
4. Once the window closes, only what was verified still reduces the tax taken — and Form 16, both parts, is built from exactly that figure, so it can never disagree with what was actually deducted.

### Recruitment

- **Requisitions** for vacant positions that describe the role: title, description, qualifications, skills, experience, place, and a salary budget only HR sees.
- **A public careers site** where candidates apply for published roles with their resume — no account needed. Candidates get an acknowledgement, and recruiters are told. Duplicates are caught by email or phone, so the same person is one record.
- **Screening**: reject a profile, or take it to interview.
- **Interview rounds**, as many as each candidate needs, each with its own interviewer, date, time and place. Interviewers are told, record their own notes against the role's own **scorecard** where it has one, and can download a calendar invite; the candidate gets a confirmation email.
- **Approve or reject** a candidate once the rounds are done, and **make the offer** — a CTC breakdown built into a letter, sent to a link only the candidate has. They accept or decline there, and accepting **turns them into an employee automatically**, with nothing retyped. An offer above a role's budgeted band needs a more senior sign-off.
- **Refer someone** — any employee can refer a candidate for an open role, and earns a bonus once the hire is still with us after a qualifying period.
- **Recruitment analytics**: time to hire, time in each stage, which sources turn into hires, offer acceptance, and where candidates are not taken forward.
- One record per candidate, whichever roles they apply for, with their resume and history.

**How hiring flows, start to finish:**
1. HR opens a requisition against a vacant position, with its budget, and publishes it to the careers site.
2. A candidate applies with their resume — no account needed — and gets an acknowledgement; duplicates by email or phone are caught automatically.
3. The recruiter screens the application: rejected, or taken to interview.
4. The candidate goes through as many interview rounds as the role needs; each interviewer is told, records notes against the role's scorecard, and the candidate gets a confirmation email for each one.
5. Once the rounds are done, the candidate is approved or rejected.
6. An approved candidate is made a formal offer — sent to a link only they have — needing a more senior sign-off first if it is above the role's budgeted band.
7. The candidate accepts or declines through their own link; accepting converts them into an employee immediately, with onboarding already queued and nothing retyped.
8. If an employee referred them, the referral bonus is paid once the new hire has stayed past the qualifying period — or forfeited if they do not.

### Performance

- Yearly appraisal cycles with goals, self reviews and manager ratings.
- **Goal check-ins** through the year — either side can add one — with a reminder while a goal has gone quiet.
- **360-degree feedback**: ask peers, a manager, reports and the person themself; peer answers are only ever shown averaged together, once three people have replied.
- **Calibration** of ratings across the organisation.
- **Improvement plans** with goals, dates, their own check-ins, and an outcome.
- **Increments** that become the next month's pay automatically.

**How an appraisal cycle flows:**
1. HR opens the cycle from a template; goals are set for each employee.
2. Through the year, either the employee or their manager can add a check-in against a goal; a goal that has gone quiet gets a reminder.
3. At the end, the employee writes a self review and the manager rates it; feedback from peers, reports and the manager can be asked for too, with peer answers shown only once three people have replied.
4. Ratings go through calibration across the organisation.
5. An agreed increment becomes next month's basic pay automatically — payroll needs nothing re-entered.

**How an improvement plan flows:**
1. A manager opens a plan with its own goals and dates.
2. Check-ins are added against it as it runs.
3. It is closed with an outcome recorded, kept on the employee's history.

### Training

- A **course catalogue** with scheduled sessions, place and cost.
- Employees **nominate themselves**, or are nominated; a nomination is refused once it would take its department over its training budget for the year.
- **Certifications** kept on each person's own record, with their issuer and expiry.
- A certificate due to expire **warns its holder and their manager** ahead of time.
- A **compliance report** flags anyone whose role needs a certificate they do not hold.

**How a nomination flows:**
1. An employee nominates themselves for a session, or is nominated by someone else.
2. It is checked against their department's training budget for the year; it is refused outright if approving it would take the department over budget.
3. Approved, attendance is recorded against the session once it runs.
4. Any certification that comes from it is kept on the employee's record with its issuer and expiry, warning the employee and their manager as that date approaches.

### Approvals

- **Approval routes you configure** for leave, corrections to employee records and headcount requests: who approves each kind of request, extra steps for larger requests or bank changes, and HR brought in when a request waits too long.
- **Two people for a bank change**: the person who approved one step can never approve the next.
- **One inbox** for everything waiting on each person.
- **Delegation** while someone is away, recorded as "approved on behalf of".

**How any approval route works:**
1. A request is raised and lands with whoever the configured route says decides its first step — by default the person's reporting manager.
2. Each step can add a condition (only above a certain size, say) and its own approver; a step that resolves to nobody goes to HR instead.
3. If a step waits too long, HR is brought in automatically.
4. While someone is away, their "While I am away" delegate decides in their place, with every such decision recorded as "approved on behalf of" — never silently as their own.

### Reports

- Headcount, payroll cost and leave by department, and attrition.
- A **24-month headcount trend**, built up automatically and kept current.
- **Leave liability**: what every encashable leave balance would cost if cashed out today — the figure finance provides for.
- **Schedule a report** to land in an inbox, as a spreadsheet, on the 1st of every month.
- Exports to spreadsheet (CSV).

**How a scheduled report flows:**
1. Pick a report and the inboxes it should reach.
2. On the 1st of every month, it is rendered fresh as a spreadsheet and emailed to each of them.
3. Nothing to remember and nothing stored in between — each month's copy is built from that month's own figures.

### Security and control

- **Roles you define**: HR builds roles from plain-language permissions and gives them to people — a recruiter who sees candidates but no pay, an auditor who reads but cannot change.
- **Ten areas of control** — organisation, people, time and leave, payroll, tax, recruitment, performance, reports, administration and self-service — so a role can be given exactly the areas a job needs, and nothing more.
- **Limits by company or location**, so a role sees only its own people.
- **Salaries and bank accounts are hidden** from anyone without the permission to see them.
- **Every change is recorded** with who made it and the value before and after.
- **Every look at sensitive data is recorded** — pay, bank details, tax and documents — and employees can see who looked at theirs.

### Connection to your ERP

- **Two-way exchange through a secure API.** The HRMS sends people, organisation, time and payroll as they change, including the payroll journal and the salaries to pay. Your ERP sends back what it owns — cost centres, accounts, payments made, punches from a device or a badge system, hours from your own project tracker — and confirms what it booked.
- **Each kind of record has one owner**, so the two systems never overwrite each other.
- **HR can see the connection at work**: what was sent, what the ERP booked, anything that could not be applied, and a reconciliation of every payroll journal against what the ERP recorded.
- **Remove a system you no longer use**: HR can delete one that has never really connected; one that has is suspended instead, so its history stays readable.
- **Your ERP's own employee portal can use it too**: show payslips as PDFs, let someone apply for leave, and send corrections employees ask for, which HR approves as usual.
- **A complete guide for your ERP's developers**, a live reference, and a practice environment to build against.

**How the two systems stay in step:**
1. HR agrees, once, who owns each kind of record — the default has the HRMS own people and pay, your ERP own cost centres and accounts — and connects your ERP with the scopes, companies and addresses it is allowed.
2. From then on, your ERP hears about every relevant change as it happens, or asks in one request for everything it has missed since it last checked.
3. Your ERP sends back what it owns — cost centres, accounts, payment confirmations, punches, hours — and the HRMS applies them the same way.
4. Every payroll run's journal is reconciled automatically against what your ERP actually booked, with anything that does not match shown to HR, not silently dropped.

---

## Coming next

- **Recruitment**: letting a candidate choose from several offered interview times, and signing the offer letter online.
- **Switching on**: email delivery, cloud storage for documents, and going live with your ERP.

---

## Good to know

- **Emails are prepared but not yet sent.** Every notification email is written and can be read on the Outbox screen; they go out once an email provider is connected.
- **Statutory bonus is not calculated yet.** Provident fund (including the employer's share), ESI, professional tax, the labour welfare fund, gratuity and income tax are.
- **The demo organisation** (Acme Manufacturing) is sample data, for trying the software.

A guide for connecting a system to it is in [API.md](API.md).
