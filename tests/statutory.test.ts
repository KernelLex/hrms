import { describe, expect, it } from "vitest";
import { rawClient } from "@/lib/db";
import { runPayroll, previewCtc } from "@/lib/engines/payroll";
import { professionalTaxFromSlabs, generateEcrText, type PtSlabRow } from "@/lib/engines/statutory";
import { postToLedger } from "@/app/actions/payroll";
import { saveInfotypeSlice } from "@/app/actions/core-hr";
import { form, createBareEmployee } from "./support/fixtures";
import { createArea, createPeriod, hireForPayroll, storedResult } from "./support/payroll-fixtures";

/**
 * PF, ESI, professional tax, the labour welfare fund, employer contributions
 * and the CTC breakdown they all feed into.
 */

const rupees = (n: number) => n * 100;

describe("CTC breakdown", () => {
  it("matches a hand calculation for a ₹6,00,000 CTC on the standard structure", async () => {
    const b = await previewCtc("STANDARD", rupees(600_000), "2026-04-01");
    const line = (code: string) => b.lines.find((l) => l.wageTypeCode === code)?.amountPaise ?? 0;

    expect(b.monthlyCtcPaise).toBe(rupees(50_000));
    expect(line("BASIC")).toBe(rupees(20_000)); // 40% of 50,000
    expect(line("HRA")).toBe(rupees(8_000)); // 40% of basic
    expect(line("CONV")).toBe(rupees(2_000)); // 10% of basic
    expect(b.employerPfPaise).toBe(rupees(1_950)); // 13% of the 15,000 ceiling: 12% + 0.5% EDLI + 0.5% admin
    expect(b.employerEsiPaise).toBe(0); // gross is well above the ESI ceiling
    expect(line("SPECIAL")).toBe(b.monthlyCtcPaise - line("BASIC") - line("HRA") - line("CONV") - b.employerPfPaise);
    expect(b.grossPaise).toBe(line("BASIC") + line("HRA") + line("CONV") + line("SPECIAL"));
  });
});

describe("ESI", () => {
  it("continues through a raise until the contribution period ends", async () => {
    const area = await createArea();
    const employee = await hireForPayroll({
      area,
      hireDate: "2020-01-01",
      pay: [
        { from: "2020-01-01", to: "2026-08-31", amountRupees: 14_000 }, // gross 21,000 — exactly the ceiling
        { from: "2026-09-01", amountRupees: 20_000 }, // gross 30,000 — well over it
      ],
    });

    const august = await createPeriod(area, 2026, 8);
    const augustRun = await runPayroll({ periodId: august, runBy: "test" });
    const augustResult = await storedResult(augustRun.runId, employee);
    expect(augustResult?.line("ESI")).toBeGreaterThan(0);
    expect(augustResult?.line("ESI_ER")).toBeGreaterThan(0);

    // Same April–September contribution period as August, and the raise took
    // gross over the ceiling — real law keeps them enrolled anyway.
    const september = await createPeriod(area, 2026, 9);
    const septemberRun = await runPayroll({ periodId: september, runBy: "test" });
    const septemberResult = await storedResult(septemberRun.runId, employee);
    expect(septemberResult?.line("ESI")).toBeGreaterThan(0);
    expect(septemberResult?.line("ESI_ER")).toBeGreaterThan(0);
  });

  it("never enrols someone whose wages start the period over the ceiling", async () => {
    const area = await createArea();
    const employee = await hireForPayroll({ area, hireDate: "2026-09-01", pay: [{ from: "2026-09-01", amountRupees: 20_000 }] });
    const september = await createPeriod(area, 2026, 9);
    const run = await runPayroll({ periodId: september, runBy: "test" });
    const result = await storedResult(run.runId, employee);
    expect(result?.line("ESI")).toBe(0);
  });
});

describe("professional tax", () => {
  const slabs: PtSlabRow[] = [
    { state: "KARNATAKA", validFrom: "2020-01-01", validTo: "9999-12-31", fromPaise: rupees(25_000), toPaise: null, amountPaise: rupees(200), isFebruary: false },
    { state: "MAHARASHTRA", validFrom: "2020-01-01", validTo: "9999-12-31", fromPaise: rupees(10_000), toPaise: null, amountPaise: rupees(200), isFebruary: false },
    { state: "MAHARASHTRA", validFrom: "2020-01-01", validTo: "9999-12-31", fromPaise: rupees(10_000), toPaise: null, amountPaise: rupees(300), isFebruary: true },
  ];

  it("charges Karnataka's flat rate above its threshold, nothing below it", () => {
    expect(professionalTaxFromSlabs(slabs, "KARNATAKA", "2026-06-15", rupees(30_000))).toBe(rupees(200));
    expect(professionalTaxFromSlabs(slabs, "KARNATAKA", "2026-06-15", rupees(20_000))).toBe(0);
  });

  it("charges Maharashtra more in February, reaching the ₹2,500 annual cap", () => {
    expect(professionalTaxFromSlabs(slabs, "MAHARASHTRA", "2026-06-15", rupees(30_000))).toBe(rupees(200));
    expect(professionalTaxFromSlabs(slabs, "MAHARASHTRA", "2027-02-15", rupees(30_000))).toBe(rupees(300));
    // 11 months at 200 plus one at 300 is 2,500 — the statutory annual cap.
    expect(11 * 200 + 300).toBe(2_500);
  });
});

describe("employer contributions", () => {
  it("reach the payslip as their own line, never net pay", async () => {
    const area = await createArea();
    const employee = await hireForPayroll({ area, hireDate: "2020-01-01", pay: [{ from: "2020-01-01", amountRupees: 80_000 }] });
    const period = await createPeriod(area, 2026, 5);
    const run = await runPayroll({ periodId: period, runBy: "test" });
    const result = await storedResult(run.runId, employee);
    expect(result).toBeDefined();

    const employerLines = result!.lines.filter((l) => l.kind === "EmployerContribution");
    expect(employerLines.length).toBeGreaterThan(0);
    expect(employerLines.some((l) => l.code === "EPF_ER")).toBe(true);
    const employerTotal = employerLines.reduce((s, l) => s + l.amount, 0);
    expect(employerTotal).toBeGreaterThan(0);

    // Net pay is gross earnings less deductions only — employer contributions
    // are neither paid to the employee nor deducted from them, so they are
    // absent from both totals even though their lines are on the payslip.
    expect(result!.net).toBe(result!.gross - result!.deductions);
    const earningTotal = result!.lines.filter((l) => l.kind === "Earning").reduce((s, l) => s + l.amount, 0);
    const deductionTotal = result!.lines.filter((l) => l.kind === "Deduction").reduce((s, l) => s + l.amount, 0);
    expect(earningTotal).toBe(result!.gross);
    expect(deductionTotal).toBe(result!.deductions);
  });

  it("post to the ledger as a debit to expense and a credit to a payable, balanced", async () => {
    const area = await createArea();
    await hireForPayroll({ area, hireDate: "2020-01-01", pay: [{ from: "2020-01-01", amountRupees: 80_000 }] });
    const period = await createPeriod(area, 2026, 6);
    const run = await runPayroll({ periodId: period, runBy: "test" });

    const posted = await postToLedger({}, form({ runId: run.runId, postingDate: "2026-06-30" }));
    expect(posted.error).toBeUndefined();

    const lines = await rawClient().execute({
      sql: `SELECT l.gl_account, l.debit_paise, l.credit_paise
            FROM py_gl_posting_line l JOIN py_gl_posting p ON p.id = l.posting_id
            WHERE p.run_id = ?`,
      args: [run.runId],
    });
    const debit = lines.rows.reduce((s, l) => s + Number(l.debit_paise), 0);
    const credit = lines.rows.reduce((s, l) => s + Number(l.credit_paise), 0);
    expect(debit).toBe(credit);
    const employerExpense = lines.rows.filter((l) => l.gl_account === "5030");
    expect(employerExpense.length).toBeGreaterThan(0);
    expect(employerExpense.every((l) => Number(l.debit_paise) > 0)).toBe(true);
  });
});

describe("cost splits", () => {
  it("posts a 60/40 split to two cost centres", async () => {
    const area = await createArea();
    const employee = await hireForPayroll({ area, hireDate: "2020-01-01", pay: [{ from: "2020-01-01", amountRupees: 50_000 }] });
    await rawClient().execute({
      sql: `INSERT INTO py_cost_split (employee_id, cost_centre, percent_basis_points, valid_from, valid_to, created_by, created_at)
            VALUES (?, 'CC-A', 6000, '2020-01-01', '9999-12-31', 'test', ?), (?, 'CC-B', 4000, '2020-01-01', '9999-12-31', 'test', ?)`,
      args: [employee, new Date().toISOString(), employee, new Date().toISOString()],
    });

    const period = await createPeriod(area, 2026, 7);
    const run = await runPayroll({ periodId: period, runBy: "test" });
    const posted = await postToLedger({}, form({ runId: run.runId, postingDate: "2026-07-31" }));
    expect(posted.error).toBeUndefined();

    const lines = await rawClient().execute({
      sql: `SELECT l.cost_center, SUM(l.debit_paise) AS amount
            FROM py_gl_posting_line l JOIN py_gl_posting p ON p.id = l.posting_id
            WHERE p.run_id = ? AND l.gl_account = '5010' GROUP BY l.cost_center`,
      args: [run.runId],
    });
    const byCentre = Object.fromEntries(lines.rows.map((l) => [String(l.cost_center), Number(l.amount)]));
    expect(Object.keys(byCentre).sort()).toEqual(["CC-A", "CC-B"]);
    const total = byCentre["CC-A"] + byCentre["CC-B"];
    expect(byCentre["CC-A"]).toBe(Math.round(total * 0.6));
    expect(byCentre["CC-B"]).toBe(total - byCentre["CC-A"]);
  });
});

describe("IT0011 statutory details", () => {
  it("saves UAN, ESI number and professional tax state, uppercasing the state", async () => {
    const id = await createBareEmployee("SD");
    const saved = await saveInfotypeSlice(
      {},
      form({ employeeId: id, infotype: "0011", validFrom: "2024-01-01", uan: "100123456789", esiNumber: "1234567890", professionalTaxState: "karnataka" }),
    );
    expect(saved).toEqual({ ok: true });

    const row = await rawClient().execute({
      sql: "SELECT uan, esi_number, professional_tax_state FROM pa_it0011_statutory_details WHERE employee_id = ?",
      args: [id],
    });
    expect(row.rows[0]?.uan).toBe("100123456789");
    expect(row.rows[0]?.professional_tax_state).toBe("KARNATAKA");
  });
});

describe("ECR", () => {
  it("writes eleven '#~#'-delimited fields per member", () => {
    const text = generateEcrText([
      {
        uan: "100123456789",
        memberName: "Arjun Mehta",
        grossWagesPaise: rupees(48_050),
        pfWagesPaise: rupees(15_000),
        epsWagesPaise: rupees(15_000),
        edliWagesPaise: rupees(15_000),
        employeePfPaise: rupees(1_800),
        epsPaise: 124_950,
        employerPfPaise: 55_050,
        ncpDays: 0,
        refundOfAdvancesPaise: 0,
      },
    ]);
    const fields = text.trim().split("#~#");
    expect(fields).toHaveLength(11);
    expect(fields[0]).toBe("100123456789");
    expect(fields[1]).toBe("Arjun Mehta");
    expect(fields[2]).toBe("48050");
    expect(fields[6]).toBe("1800");
  });
});
