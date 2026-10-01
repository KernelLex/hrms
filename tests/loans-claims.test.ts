import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { rawClient } from "@/lib/db";
import { submitLoan, submitClaim } from "@/app/actions/loans-claims";
import { decideApproval } from "@/app/actions/approvals";
import { requestFor } from "@/lib/workflow/engine";
import { computeEmi, generateSchedule, monthlyPerquisite, prepayLoan, queueDueLoanInstallments } from "@/lib/engines/loans";
import { deriveEvents } from "@/lib/api/events";
import { actAs, createPerson, type Person } from "./support/people";
import { form } from "./support/fixtures";
import { apiClient, call } from "./support/api";

/**
 * Loans and reimbursement claims: an EMI schedule computed once and
 * recovered one instalment at a time through the same one-off payment rail
 * every other kind of extra pay already uses, a prepayment that reschedules
 * the rest, a claim checked against its category's limit at submission, and
 * the perquisite value a concessional loan carries.
 */

const rupees = (n: number) => n * 100;
const one = async (sql: string, args: (string | number)[] = []) =>
  (await rawClient().execute({ sql, args })).rows[0] as Record<string, unknown> | undefined;
const all = async (sql: string, args: (string | number)[] = []) => (await rawClient().execute({ sql, args })).rows;

let employee: Person;
let manager: Person;

beforeAll(async () => {
  manager = await createPerson({ roles: ["MANAGER", "EMPLOYEE"] });
  employee = await createPerson({ reportsTo: manager.position, roles: ["EMPLOYEE"] });
});
afterEach(() => actAs(null));

/**
 * deriveEvents() only turns a bounded batch of change-log rows into events at
 * a time, same as the daily job calling it repeatedly until none are left —
 * one call is not enough once other test files ahead of this one (imports'
 * 5,000-employee batch among them) have left a backlog bigger than its
 * default limit.
 */
async function drainEvents(): Promise<void> {
  while ((await deriveEvents()) > 0) {
    // keep going until none are left
  }
}

/** Decides every step still pending, as HR — the test default session — until the request is final. */
async function decideAllSteps(subjectType: string, subjectId: number, decision: "Approved" | "Rejected"): Promise<void> {
  for (let guard = 0; guard < 5; guard += 1) {
    const request = await requestFor(subjectType, subjectId);
    if (!request || request.status !== "Pending") return;
    const r = await decideApproval({}, form({ requestId: request.id, decision, comment: "" }));
    if (!r.ok) throw new Error(r.error);
  }
  throw new Error("The request did not finish after 5 decisions.");
}

describe("the EMI schedule", () => {
  it("recovers ₹1,20,000 over 12 months at ₹10,000 a month and closes at zero", () => {
    const principal = rupees(120_000);
    const emi = computeEmi(principal, 0, 12);
    expect(emi).toBe(rupees(10_000));

    const schedule = generateSchedule({ principalPaise: principal, annualRateBasisPoints: 0, tenureMonths: 12, emiPaise: emi, startDate: "2026-01-01" });
    expect(schedule).toHaveLength(12);
    expect(schedule.every((s) => s.principalPaise === rupees(10_000))).toBe(true);
    expect(schedule[11].closingBalancePaise).toBe(0);
  });

  it("charges interest on a declining balance, the EMI covering both", () => {
    const principal = rupees(100_000);
    const emi = computeEmi(principal, 1200, 12); // 12% a year
    const schedule = generateSchedule({ principalPaise: principal, annualRateBasisPoints: 1200, tenureMonths: 12, emiPaise: emi, startDate: "2026-01-01" });
    expect(schedule[0].interestPaise).toBeGreaterThan(0);
    expect(schedule[11].interestPaise).toBeLessThan(schedule[0].interestPaise); // less interest as the balance falls
    expect(schedule[11].closingBalancePaise).toBe(0);
    // Every instalment but the last is exactly the EMI (principal + interest); the last absorbs rounding.
    for (const s of schedule.slice(0, -1)) expect(s.principalPaise + s.interestPaise).toBe(emi);
  });
});

describe("the perquisite value", () => {
  it("is nothing for a loan at or above the benchmark rate", () => {
    expect(monthlyPerquisite(rupees(100_000), rupees(100_000), 900, 850)).toBe(0); // charges more than the benchmark
    expect(monthlyPerquisite(rupees(100_000), rupees(100_000), 850, 850)).toBe(0); // charges exactly the benchmark
  });

  it("is nothing for a loan at or under the ₹20,000 exemption", () => {
    expect(monthlyPerquisite(rupees(20_000), rupees(20_000), 0, 850)).toBe(0);
  });

  it("is the rate gap on the opening balance, for the month, for a larger concessional loan", () => {
    // ₹1,00,000 outstanding, interest-free, an 8.5% benchmark: 1,00,000 * 8.5% / 12.
    const value = monthlyPerquisite(rupees(100_000), rupees(100_000), 0, 850);
    expect(value).toBe(Math.round((rupees(100_000) * 850) / 10_000 / 12));
    expect(value).toBeGreaterThan(0);
  });
});

describe("loans end to end", () => {
  it("generates the schedule on approval, and queues the first instalment once it is due", async () => {
    actAs(employee.session);
    const r = await submitLoan({}, form({ loanType: "Personal", principal: 120_000, annualRate: "0", tenureMonths: 12, startDate: "2020-01-01", reason: "Test" }));
    expect(r.ok).toBe(true);
    actAs(null);

    const loan = await one("SELECT * FROM py_loan WHERE employee_id = ? ORDER BY id DESC LIMIT 1", [employee.employeeId]);
    expect(loan!.status).toBe("Pending");

    await decideAllSteps("py_loan", Number(loan!.id), "Approved");
    const active = await one("SELECT * FROM py_loan WHERE id = ?", [Number(loan!.id)]);
    expect(active!.status).toBe("Active");

    const schedule = await all("SELECT * FROM py_loan_schedule WHERE loan_id = ? ORDER BY installment_no", [Number(loan!.id)]);
    expect(schedule).toHaveLength(12);
    expect(Number(schedule[0].principal_paise)).toBe(rupees(10_000));

    // Every instalment is already in the past (the loan started in 2020), so queuing today picks up all 12.
    const queued = await queueDueLoanInstallments(new Date().toISOString().slice(0, 10));
    expect(queued).toBe(12);

    const payments = await all("SELECT * FROM py_it0015_additional_payment WHERE employee_id = ? AND wage_type_code = 'LOAN'", [employee.employeeId]);
    expect(payments).toHaveLength(12);
    expect(payments.reduce((s, p) => s + Number(p.amount_paise), 0)).toBe(rupees(120_000));

    const closed = await one("SELECT status FROM py_loan WHERE id = ?", [Number(loan!.id)]);
    expect(closed!.status).toBe("Closed"); // the last instalment queuing closes it

    // Queuing again finds nothing new to do.
    const queuedAgain = await queueDueLoanInstallments(new Date().toISOString().slice(0, 10));
    expect(queuedAgain).toBe(0);
  });

  it("reschedules the remainder on a prepayment, at the same EMI", async () => {
    const other = await createPerson({ reportsTo: manager.position, roles: ["EMPLOYEE"] });
    actAs(other.session);
    await submitLoan({}, form({ loanType: "Personal", principal: 120_000, annualRate: "0", tenureMonths: 12, startDate: "2026-06-01", reason: "" }));
    actAs(null);
    const loan = await one("SELECT * FROM py_loan WHERE employee_id = ? ORDER BY id DESC LIMIT 1", [other.employeeId]);
    await decideAllSteps("py_loan", Number(loan!.id), "Approved");

    const tx = await rawClient().transaction("write");
    const result = await prepayLoan(tx, { loanId: Number(loan!.id), amountPaise: rupees(60_000), date: "2026-06-15", createdBy: "test" });
    await tx.commit();
    tx.close();
    if ("error" in result) throw new Error(result.error);

    // Half the principal gone at the same ₹10,000 EMI: roughly 6 instalments left, not 12.
    expect(result.schedule.length).toBeLessThan(12);
    expect(result.schedule.length).toBeGreaterThan(0);
    expect(result.schedule.at(-1)!.closingBalancePaise).toBe(0);
    expect(result.closed).toBe(false);

    const remaining = await all("SELECT * FROM py_loan_schedule WHERE loan_id = ? AND additional_payment_id IS NULL", [Number(loan!.id)]);
    expect(remaining).toHaveLength(result.schedule.length);
  });
});

describe("claims", () => {
  it("refuses a claim over its category's limit at submission", async () => {
    actAs(employee.session);
    const r = await submitClaim(
      {},
      form({
        categoryCode: "PHONE", // seeded with a ₹12,000 annual limit
        claimDate: "2026-01-15",
        line_date_0: "2026-01-15",
        line_description_0: "Way over the limit",
        line_amount_0: 50_000,
      }),
    );
    expect(r.error).toMatch(/limit/i);
  });

  it("pays an approved claim once, through the one-off payment rail", async () => {
    actAs(employee.session);
    const r = await submitClaim(
      {},
      form({
        categoryCode: "FUEL",
        claimDate: "2026-01-20",
        line_date_0: "2026-01-20",
        line_description_0: "Petrol",
        line_amount_0: 2_000,
      }),
    );
    expect(r.ok).toBe(true);
    actAs(null);

    const claim = await one("SELECT * FROM py_claim WHERE employee_id = ? ORDER BY id DESC LIMIT 1", [employee.employeeId]);
    expect(claim!.status).toBe("Pending");

    await decideAllSteps("py_claim", Number(claim!.id), "Approved");
    const approved = await one("SELECT * FROM py_claim WHERE id = ?", [Number(claim!.id)]);
    expect(approved!.status).toBe("Approved");
    expect(approved!.additional_payment_id).not.toBeNull();

    const payment = await one("SELECT * FROM py_it0015_additional_payment WHERE id = ?", [Number(approved!.additional_payment_id)]);
    expect(payment!.wage_type_code).toBe("REIMB"); // FUEL is not taxable
    expect(Number(payment!.amount_paise)).toBe(rupees(2_000));
  });

  it("pays a taxable category's claim on the CLAIM wage type, not REIMB", async () => {
    actAs(employee.session);
    await submitClaim(
      {},
      form({
        categoryCode: "MEDICAL", // seeded taxable
        claimDate: "2026-02-01",
        line_date_0: "2026-02-01",
        line_description_0: "Consultation",
        line_amount_0: 1_000,
      }),
    );
    actAs(null);
    const claim = await one("SELECT * FROM py_claim WHERE employee_id = ? AND category_code = 'MEDICAL' ORDER BY id DESC LIMIT 1", [employee.employeeId]);
    await decideAllSteps("py_claim", Number(claim!.id), "Approved");
    const approved = await one("SELECT additional_payment_id FROM py_claim WHERE id = ?", [Number(claim!.id)]);
    const payment = await one("SELECT wage_type_code FROM py_it0015_additional_payment WHERE id = ?", [Number(approved!.additional_payment_id)]);
    expect(payment!.wage_type_code).toBe("CLAIM");
  });

  it("only marks a rejected claim — nothing is queued to pay", async () => {
    actAs(employee.session);
    await submitClaim(
      {},
      form({
        categoryCode: "PHONE",
        claimDate: "2026-03-01",
        line_date_0: "2026-03-01",
        line_description_0: "Rejected",
        line_amount_0: 500,
      }),
    );
    actAs(null);
    const claim = await one("SELECT * FROM py_claim WHERE employee_id = ? AND category_code = 'PHONE' ORDER BY id DESC LIMIT 1", [employee.employeeId]);
    await decideAllSteps("py_claim", Number(claim!.id), "Rejected");
    const decided = await one("SELECT * FROM py_claim WHERE id = ?", [Number(claim!.id)]);
    expect(decided!.status).toBe("Rejected");
    expect(decided!.additional_payment_id).toBeNull();
  });
});

describe("the API", () => {
  it("lists a loan with its schedule once approved, and derives loan.approved and loan.closed", async () => {
    const other = await createPerson({ reportsTo: manager.position, roles: ["EMPLOYEE"] });
    actAs(other.session);
    await submitLoan({}, form({ loanType: "Personal", principal: 60_000, annualRate: "0", tenureMonths: 6, startDate: "2020-01-01", reason: "" }));
    actAs(null);
    const loan = await one("SELECT * FROM py_loan WHERE employee_id = ? ORDER BY id DESC LIMIT 1", [other.employeeId]);
    await decideAllSteps("py_loan", Number(loan!.id), "Approved");

    const c = await apiClient(["payroll:read", "pay:read"]);
    const listed = await call("GET", `/loans?employee_id=${other.employeeId}`, { token: c.token });
    expect(listed.status, JSON.stringify(listed.body)).toBe(200);
    type LoanRep = { id: number; status: string; principal: { amount: string }; schedule: { installment_no: number; principal: { amount: string } }[] };
    const body = listed.body as { data: LoanRep[] };
    const rep = body.data.find((l) => l.id === Number(loan!.id));
    expect(rep?.status).toBe("Active");
    expect(rep?.principal.amount).toBe("60000.00");
    expect(rep?.schedule).toHaveLength(6);

    await drainEvents();
    const approvedEvents = await all("SELECT type FROM int_event WHERE subject = ?", [`loans/${Number(loan!.id)}`]);
    expect(approvedEvents.map((e) => String(e.type))).toContain("loan.approved");

    // Every instalment is already due (the loan started in 2020), so queuing closes it.
    await queueDueLoanInstallments(new Date().toISOString().slice(0, 10));
    await drainEvents();
    const closedEvents = await all("SELECT type FROM int_event WHERE subject = ? AND type = 'loan.closed'", [`loans/${Number(loan!.id)}`]);
    expect(closedEvents.length).toBeGreaterThan(0);
  });

  it("refuses GET /loans without pay:read, even with payroll:read", async () => {
    const c = await apiClient(["payroll:read"]);
    const refused = await call("GET", "/loans", { token: c.token });
    expect(refused.status).toBe(403);
  });

  it("accepts a claim already approved in the ERP, pays it once, and derives claim.approved and claim.paid", async () => {
    const c = await apiClient(["payroll:write"]);
    const posted = await call("POST", "/claims", {
      token: c.token,
      body: {
        employee_id: employee.employeeId,
        category: "FUEL",
        claim_date: "2026-04-01",
        lines: [{ date: "2026-04-01", description: "Mileage to the client site", amount: { amount: "500.00", currency: "INR" } }],
      },
    });
    expect(posted.status, JSON.stringify(posted.body)).toBe(201);
    const body = posted.body as { id: number; status: string; wage_type: string; total_amount: { amount: string } };
    expect(body.status).toBe("Approved");
    expect(body.wage_type).toBe("REIMB"); // FUEL is not taxable
    expect(body.total_amount.amount).toBe("500.00");

    const claim = await one("SELECT * FROM py_claim WHERE id = ?", [body.id]);
    expect(claim!.additional_payment_id).not.toBeNull();

    await drainEvents();
    const approvedEvents = await all("SELECT type FROM int_event WHERE subject = ?", [`claims/${body.id}`]);
    expect(approvedEvents.map((e) => String(e.type))).toContain("claim.approved");
    const paidEvents = await all("SELECT data FROM int_event WHERE type = 'claim.paid'");
    const mine = paidEvents.find((e) => (JSON.parse(String(e.data)) as { claim_id: number }).claim_id === body.id);
    expect(mine).toBeTruthy();
  });

  it("refuses an ERP claim over its category's limit, the same as one entered on screen", async () => {
    const c = await apiClient(["payroll:write"]);
    const posted = await call("POST", "/claims", {
      token: c.token,
      body: {
        employee_id: employee.employeeId,
        category: "PHONE",
        claim_date: "2026-05-01",
        lines: [{ date: "2026-05-01", description: "Way over the limit", amount: { amount: "50000.00", currency: "INR" } }],
      },
    });
    expect(posted.status).toBe(422);
    expect((posted.body as { code: string; detail: string }).detail).toMatch(/limit/i);
  });
});
