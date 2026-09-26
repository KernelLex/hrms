# HR Module Blueprint — SAP-Style Reference
### For building a Core HR / Absence / Payments / Recruitment / Performance / Tax Deduction module in your own ERP

This document is the **conceptual + transactional reference** you asked for, before we start building screen-by-screen. It mirrors how SAP HCM (now SAP SuccessFactors on-prem equivalent = SAP HCM) structures its HR sub-modules, along with the relevant T-codes, so you can map each piece to an equivalent table/screen/API in your own ERP.

---

## 1. Overall HR Module Architecture (SAP HCM Analogy)

```
HR MODULE
│
├── 1. Organizational Management (OM)     → Company structure backbone
├── 2. Core HR / Personnel Administration (PA)  → Employee master data
├── 3. Time Management / Absence (PT)     → Attendance, leave, quotas
├── 4. Payroll / Payments (PY)            → Salary processing, payslips
├── 5. Recruitment (RC)                   → Hiring lifecycle
├── 6. Performance Management (PM)        → Appraisals & yearly increments
└── 7. Yearly Tax Deduction (TDS)         → Form 16 Part A & Part B
```

**Design principle:** In SAP, everything hangs off two backbones:
- **Org structure (OM)** — positions, jobs, org units, reporting lines
- **Infotypes (PA)** — time-stamped data records for each employee (this is the single biggest concept to replicate — see Section 2.3)

If you build your schema around "infotype-like" versioned records per employee, the rest becomes much easier to extend later (Absence, Payroll, Recruitment all just read/write infotypes).

---

## 2. CORE HR (Personnel Administration + Org Management)

### 2.1 Purpose
Maintains the single source of truth for employee master data: personal info, org assignment, job, pay scale, bank details, etc.

### 2.2 Key Sub-Areas & T-Codes

| Area | T-Code | Description |
|---|---|---|
| Org structure creation | **PPOCE** | Create org unit/position/job (org chart) |
| Org structure maintenance | **PPOME** | Change/maintain org structure |
| Org structure display | **PPOSE** | Display org structure |
| Hire an employee (action) | **PA40** | Personnel action (hire, transfer, termination) |
| Maintain HR master data | **PA30** | Maintain infotypes for one employee |
| Display HR master data | **PA20** | Display infotypes (read-only) |
| Mass data maintenance | **PA70/PA71** | Fast entry for multiple employees |
| Employee search | **PA10** | Personnel file / search employee |
| Organizational assignment | **PA10/PA20 (IT0001)** | Company, personnel area, cost center |

### 2.3 Core Concept: Infotypes (the heart of Core HR)

Every piece of employee data is stored as an **Infotype** — a time-sliced record with validity dates (Start Date/End Date). This is what makes SAP HR "historical" — you can see what an employee's salary or address was as of any past date.

| Infotype # | Name | Holds |
|---|---|---|
| IT0000 | Actions | Employment status history (hire, promotion, leave, termination) |
| IT0001 | Organizational Assignment | Company code, personnel area/sub-area, cost center, position |
| IT0002 | Personal Data | Name, DOB, gender, marital status |
| IT0006 | Addresses | Permanent/temp address |
| IT0007 | Planned Working Time | Work schedule rule |
| IT0008 | Basic Pay | Pay scale, salary components |
| IT0009 | Bank Details | Bank account for salary payment |
| IT0021 | Family Members | Dependents |
| IT0041 | Date Specifications | Custom important dates |
| IT0105 | Communication | Email, phone, system user ID |

**→ Build equivalent:** In your ERP, create an `employee_infotype_records` table with columns: `employee_id, infotype_code, valid_from, valid_to, data_json (or normalized fields), created_by, created_at`. This single pattern will power Core HR, Absence, and parts of Payroll.

### 2.4 Personnel Actions (Hiring/Transfer/Termination workflow)
T-code **PA40** triggers a chain of infotypes automatically (Action → Org Assignment → Personal Data → Basic Pay, etc.) — this is a **wizard-style multi-step form**, not a single save. Replicate this as a guided multi-step "Action" wizard in your ERP.

---

## 3. ABSENCE / TIME MANAGEMENT

### 3.1 Purpose
Tracks attendance, leave requests, absence quotas, and integrates with Payroll (unpaid leave deductions) and Core HR (infotypes).

### 3.2 Key T-Codes

| Area | T-Code | Description |
|---|---|---|
| Maintain time data | **PA30 (IT2001/2002)** | Record absences/attendances directly |
| Time Manager's Workplace | **PTMW** | Central time management cockpit |
| Absence quota generation | **PT_QTA00** | Generate leave quotas (e.g., annual leave balance) |
| Quota overview | **PT_QTA10** | View employee quota balances |
| Absence request (ESS) | **PT_ARQ / PT-ARQ (Self-Service)** | Employee applies for leave |
| Time evaluation | **PT60** | Run time evaluation (calculates balances, overtime) |
| Time statement | **PT61/PT_ERL01** | Display time evaluation results |
| Attendance/absence report | **S_AHR_61016401** | Absence overview report |
| Public holiday calendar | **SCAL** | Maintain holiday calendar |
| Work schedule rules | **PT01/PT02/PT03** | Define shift/work schedules |

### 3.3 Key Infotypes for Absence
| Infotype | Name |
|---|---|
| IT2001 | Absences (leave, sick, unpaid) |
| IT2002 | Attendances |
| IT2006 | Absence Quotas (leave balance) |
| IT2007 | Attendance Quotas |
| IT0007 | Planned Working Time (work schedule link) |

### 3.4 Build Blueprint
- `leave_types` master (Annual, Sick, Unpaid, Maternity, etc.) — equivalent to Absence Types (e.g., 0100 = Sick, 0200 = Annual Leave)
- `leave_quota_balance` table per employee/year — replicate IT2006
- `leave_requests` table with workflow states: Draft → Submitted → Approved/Rejected → Posted to Payroll
- Approval workflow engine (manager approval chain, mirrors SAP Workflow)
- Integration hook: Approved unpaid leave → feeds into Payroll deduction

---

## 4. PAYMENTS / PAYROLL

### 4.1 Purpose
Calculates gross-to-net pay using wage types, runs payroll periods, generates payslips, handles statutory deductions (PF, ESI, TDS for India; or relevant local statutory).

### 4.2 Key T-Codes

| Area | T-Code | Description |
|---|---|---|
| Payroll driver (Run payroll) | **PC00_M99_CALC** (country-specific e.g. **PC00_M40_CALC** for India) | Execute payroll run |
| Release payroll | **PA03** | Release/lock payroll control record |
| Payroll control record | **PA03** | Manage payroll period status |
| Display payroll results | **PC_PAYRESULT** | View calculated results per employee |
| Remuneration statement (payslip) | **PC00_M99_CEDT / PC00_M40_CEDT** | Generate payslip |
| Wage type maintenance | **PU30 / OH11** | Configure wage types |
| Off-cycle payroll | **PUOC_XX** | Bonus/off-cycle payments |
| Posting to Finance | **PC00_M99_CIPE** | Post payroll results to GL/FI |
| Bank transfer (DME) | **PC00_M99_CDTA** | Generate bank payment file |
| Third-party remittance | **PC00_M99_URME** | Statutory remittance (PF, tax authorities) |

### 4.3 Key Infotypes for Payroll
| Infotype | Name |
|---|---|
| IT0008 | Basic Pay (salary structure) |
| IT0014 | Recurring Payments/Deductions |
| IT0015 | Additional Payments (one-time) |
| IT0009 | Bank Details |
| IT0057 | Membership Fees |
| IT0416 | Time Quota Compensation |

### 4.4 Build Blueprint
- `wage_types` master (earnings/deductions codes, e.g., BASIC, HRA, PF, TDS) — equivalent to SAP Wage Types
- `payroll_period` table (month, status: Open/Locked/Posted)
- `payroll_run` engine: Gross → Deductions → Net (formula-driven, configurable per wage type — like SAP's PCR/Schema logic, but you can start simpler with a rules table)
- `payslip` generation (PDF) per employee per period
- Integration hooks:
  - **From Absence:** unpaid leave days reduce basic pay
  - **From Core HR:** IT0008-equivalent basic pay table feeds gross salary
  - **To Finance/GL module:** payroll posting journal entries (if you already built Finance module, this is your integration point)
- Bank file (DME-equivalent) export for salary disbursement

---

## 5. RECRUITMENT

### 5.1 Purpose
End-to-end hiring: requisition → job posting → candidate applications → screening → interview → offer → hire (which feeds into Core HR's PA40 hiring action).

### 5.2 Key T-Codes (Classic Recruitment — SAP also has E-Recruiting as a separate web-based module)

| Area | T-Code | Description |
|---|---|---|
| Create requisition (vacancy) | **PB40** | Trigger recruitment action (create vacancy) |
| Applicant master data | **PB10** | Simple applicant data entry |
| Applicant actions | **PB20** | Full applicant actions (status changes) |
| Applicant maintenance | **PB30** | Maintain applicant infotypes |
| Applicant selection/short list | **PB60** | Applicant overview & selection |
| Integration to HR (hire applicant) | **PB40** (action: "Hire") | Converts applicant → employee (feeds PA40) |
| Vacancy assignment | **PQ01/PQ02/PQ03** | Assign vacancies to org units/positions |
| Print applicant correspondence | **PB50** | Rejection letters, offer letters |

### 5.3 Key Infotypes for Recruitment
| Infotype | Name |
|---|---|
| IT4000 | Applicant Actions |
| IT4001 | Applications |
| IT4002 | Vacancy Assignment |
| IT4003 | Applicant Activities (interview schedule, status) |
| IT4004 | Applicant Activity Status |

### 5.4 Build Blueprint
- `job_requisitions` (position, department, headcount, status)
- `candidates` / `applicants` master
- `applications` (candidate ↔ requisition, with status pipeline: Applied → Screened → Interviewed → Offered → Hired/Rejected)
- `interview_schedule` table
- **Hire conversion:** Approved candidate → triggers Core HR "Hire" action (auto-creates employee record + org assignment + basic pay infotype) — this is the critical integration point, exactly like SAP's PB40 "Hire" action calling PA40 internally

---

## 6. PERFORMANCE MANAGEMENT & YEARLY INCREMENT

### 6.1 Purpose
Runs the annual appraisal cycle — goal setting, self/manager ratings, calibration — and converts the final rating into a salary increment recommendation that feeds directly into Payroll's Basic Pay (IT0008).

### 6.2 Key T-Codes (SAP Objective Setting & Appraisals / OSA)

| Area | T-Code | Description |
|---|---|---|
| Appraisal template & cycle setup | **PHAP_CATALOG_PA** | Define appraisal templates and criteria catalog |
| Appraisal cycle administration | **PHAP_ADMIN_PA** | Open/close appraisal cycles for a population |
| Goal/objective setting | **APPCREATE** | Create objective-setting or appraisal document |
| Start appraisal (self/manager) | **PHAP_START_PA** | Launch self-review and manager-review forms |
| Search/review appraisals | **PHAP_SEARCH_PA** | HRBP/committee view for calibration across a team |
| Appraisal document display | **PHAP_PREPARE_PA** | Display/print a completed appraisal document |

### 6.3 Key Infotype
| Infotype | Name | Holds |
|---|---|---|
| IT0025 | Appraisals | Historical appraisal ratings per employee, per period |

Performance doesn't get its own large infotype family in SAP the way PA/PT/PY do — the appraisal *document* itself (goals, ratings, comments) is usually stored in a separate OSA data model, and only the **final rating** gets written back to IT0025 against the employee, where it becomes visible to Payroll/HR reporting.

### 6.4 Build Blueprint
- `appraisal_cycles` (name, period, template, status: Draft/Active/Closed)
- `appraisal_goals` (employee, cycle, category, description, weightage %, target date)
- `appraisal_ratings` (employee, cycle, self-rating, manager-rating, overall rating, comments, status: Pending Self-Review → Pending Manager Review → Completed)
- `calibration_log` (employee, manager rating, calibrated rating, committee comments, status: Pending → In Review → Finalized)
- `increment_recommendations` (employee, final rating, current basic salary, increment %, new salary, effective date, approval status)
- **Integration hook:** an approved increment record updates the employee's Basic Pay (the same table IT0008 feeds in Payroll) with a new valid-from row — exactly the infotype versioning pattern from Section 2.3, applied to salary changes triggered by performance rather than a manual edit.

---

## 7. YEARLY TAX DEDUCTION (TDS) / FORM 16

### 7.1 Purpose
Computes and tracks income tax deducted at source on employee salaries across the financial year, and generates the annual salary TDS certificate — **Form 16 Part A** (TRACES-style quarterly TDS summary) and **Form 16 Part B** (detailed salary/exemption/tax computation annexure) — that every employee needs for their personal tax filing.

> Note: "Form 16A" and "Form 16B" are commonly used loosely to mean Part A and Part B of the *salary* TDS certificate (Form 16), which is what this section covers. The Income Tax Act separately defines a standalone "Form 16A" (TDS certificate for non-salary payments, e.g. vendor/contractor fees) and "Form 16B" (TDS certificate on sale of property under Section 194-IA) — those are different certificates outside the payroll/salary flow and would need their own module if required.

### 7.2 Key T-Codes / Transactions (SAP India Payroll — Statutory)

| Area | T-Code | Description |
|---|---|---|
| TDS section/rate configuration | *(custom/view config)* | Maintain Income Tax Act sections (192, 194C, 194J, etc.) and rates |
| Employee investment declaration | **PC00_M40_ESIA** (analogous IT declaration transactions) | Capture Section 80C/80D/HRA declarations for tax computation |
| TDS deduction & challan tracking | **J1INCHLN** | Record challans used to deposit TDS with the government |
| Quarterly e-TDS return (Form 24Q) | **PC00_M40_QTDS** | Generate the quarterly salary TDS return filed with the IT department |
| Form 16 generation (Part A + B) | **PC00_M40_F16** | Generates the annual Form 16 certificate for employees |
| TDS certificate print/reprint | **PC00_M40_CTDS** | Print/reprint TDS certificates |

### 7.3 Key Data Points (feeds from Payroll's IT0008/IT0014/IT0015)
| Source | Used For |
|---|---|
| IT0008 — Basic Pay | Gross salary for the year (Form 16 Part B) |
| IT0014/IT0015 — Recurring/Additional Payments | Taxable allowances and one-time payments |
| Payroll wage type results (Section 4) | Actual TDS deducted per period (Form 16 Part A) |
| Employee tax declaration | Section 80C/80D/HRA exemptions (Form 16 Part B computation) |

### 7.4 Build Blueprint
- `tds_section_master` (section code, description, rate %, threshold limit, applicable to: Employee/Vendor)
- `employee_tax_declarations` (employee, financial year, regime: Old/New, 80C amount, 80D amount, HRA exemption claimed, other income, status: Declared/Verified)
- `tds_deduction_register` (employee, quarter, gross salary paid, TDS deducted, challan/BSR code, deposit date) — this is your Form 24Q source data
- `form16_part_a` (generated certificate: employer TAN/PAN, employee PAN, quarterly TDS summary, certificate number)
- `form16_part_b` (generated certificate: gross salary → exemptions u/s 10 → Chapter VI-A deductions → taxable income → tax + cess → less TDS deducted → net payable/refundable)
- **Integration hook:** Form 16 Part A pulls its quarterly totals from `tds_deduction_register` (fed by the Payroll run each period); Part B pulls its annual salary figures from IT0008/IT0014/IT0015 and its exemption figures from `employee_tax_declarations`.

---

## 8. Cross-Module Integration Map

```
RECRUITMENT  →  (Hire action)          →  CORE HR (creates employee, IT0000/0001/0002/0008)
CORE HR      →  (Work schedule, Basic Pay) → ABSENCE (quota generation) + PAYROLL (gross pay)
ABSENCE      →  (Approved unpaid leave) →  PAYROLL (deduction)
PERFORMANCE  →  (Approved increment)    →  CORE HR (new Basic Pay/IT0008 row) → PAYROLL (next run picks up new salary)
PAYROLL      →  (Quarterly TDS deducted)→  TAX DEDUCTION (tds_deduction_register → Form 16 Part A)
CORE HR/PAYROLL → (Annual salary + declarations) → TAX DEDUCTION (Form 16 Part B computation)
PAYROLL      →  (Posting)               →  FINANCE/GL module (if already built)
CORE HR      →  (Org assignment/cost center) → FINANCE (cost center postings)
```

---

## 9. Suggested Build Sequence (Transaction-Wise, next steps)

Since you've already built other ERP modules, I'd suggest we build HR in this order — each phase produces a working, testable slice:

1. **Org Management** — Company → Personnel Area → Sub-area → Department → Position/Job master
2. **Core HR** — Employee master + Infotype-style versioned data model + Hire action wizard (PA40-style)
3. **Absence** — Leave types, quota engine, leave request + approval workflow
4. **Payroll** — Wage types, basic pay structure, payroll run engine, payslip generation
5. **Recruitment** — Requisition → Application pipeline → Hire conversion into Core HR
6. **Performance Management** — Appraisal cycle → Goal setting → Ratings → Calibration → Increment recommendation feeding back into Payroll's Basic Pay
7. **Yearly Tax Deduction (TDS)** — Section/rate master → Employee tax declarations → Quarterly deduction register → Form 16 Part A & Part B generation

I'd recommend we start with **Org Management + Core HR** first since every other sub-module depends on the employee master and org structure.

---

*Status: all seven modules above now have clickable HTML reference screens built against this blueprint (Org Management, Core HR, Time Management, Payroll, Recruitment, Performance, Tax Deduction). Stack: VB.NET (WinForms) + SQL Server. Next step: implement the actual VB.NET code and database tables module by module, starting from Org Management.*
