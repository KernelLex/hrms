import { describe, expect, it } from "vitest";
import { rawClient } from "@/lib/db";
import { computeAnnualTax } from "@/lib/engines/tax";
import { runPayroll, startRun, processRunBatch } from "@/lib/engines/payroll";
import { saveTimeSlice, SLICED_TABLES } from "@/lib/engines/timeslice";
import { deleteAdditionalPayment, postToLedger } from "@/app/actions/payroll";
import { form } from "./support/fixtures";
import {
  createArea,
  createPeriod,
  hireForPayroll,
  postPeriod,
  storedResult,
} from "./support/payroll-fixtures";

/**
 * Payroll across time: people who join or leave mid-month, pay that changes
 * mid-month, tax over a whole year, corrections to months already paid, and
 * payments made outside the monthly run.
 *
 * Every test works in a personnel area of its own, so its runs hold only the
 * people it hired. Working days below are for 2026, with the seeded holidays.
 */

const rupees = (n: number) => Math.round(n * 100);

async function runMonth(area: string, year: number, month: number, post = true) {
  const periodId = await createPeriod(area, year, month);
  const progress = await runPayroll({ periodId, runBy: "test" });
  if (post) await postPeriod(periodId);
  return { periodId, runId: progress.runId };
}

async function totalTds(employeeId: number): Promise<number> {
  const r = await rawClient().execute({
    sql: `SELECT COALESCE(SUM(l.amount_paise), 0) AS n
          FROM py_payroll_result_line l JOIN py_payroll_result r ON r.id = l.result_id
          WHERE r.employee_id = ? AND l.wage_type_code = 'TDS' AND r.status = 'Calculated'`,
    args: [employeeId],
  });
  return Number(r.rows[0].n);
}

describe("section 87A marginal relief", () => {
  it("caps tax just over ₹12 lakh at the income above the limit", async () => {
    // ₹12,96,000 less ₹75,000 standard = ₹12,21,000 taxable, ₹21,000 over the limit.
    const t = await computeAnnualTax({
      grossSalaryPaise: rupees(1_296_000),
      regime: "New",
      financialYear: "2026-27",
    });
    expect(t.taxableIncomePaise).toBe(rupees(1_221_000));
    expect(t.taxOnIncomePaise - t.rebate87aPaise).toBe(rupees(21_000));
    expect(t.totalTaxPaise).toBe(rupees(21_840)); // plus 4% cess
  });

  it("leaves income at the limit tax free and income well above it untouched", async () => {
    const at = await computeAnnualTax({ grossSalaryPaise: rupees(1_275_000), regime: "New", financialYear: "2026-27" });
    expect(at.totalTaxPaise).toBe(0);
    const above = await computeAnnualTax({ grossSalaryPaise: rupees(2_000_000), regime: "New", financialYear: "2026-27" });
    expect(above.rebate87aPaise).toBe(0);
  });
});

describe("mid-month changes", () => {
  it("pays a joiner for the working days after joining", async () => {
    const area = await createArea();
    const id = await hireForPayroll({ area, hireDate: "2026-06-15", pay: [{ from: "2026-06-15", amountRupees: 60_000 }] });
    const { runId } = await runMonth(area, 2026, 6);
    const r = (await storedResult(runId, id))!;
    // June 2026 has 22 working days; the 15th onwards holds 12 of them.
    expect(r.workingDays).toBe(22);
    expect(r.employedDays).toBe(12);
    expect(r.line("BASIC")).toBe(Math.round((rupees(60_000) * 12) / 22));
  });

  it("pays a leaver up to their last day, even once marked terminated", async () => {
    const area = await createArea();
    const id = await hireForPayroll({
      area,
      hireDate: "2024-01-01",
      terminationDate: "2026-06-10",
      pay: [{ from: "2024-01-01", amountRupees: 60_000 }],
    });
    const { runId } = await runMonth(area, 2026, 6);
    const r = await storedResult(runId, id);
    expect(r, "a leaver belongs to their last month's run").toBeDefined();
    expect(r!.employedDays).toBe(8); // 1 to 10 June
    expect(r!.line("BASIC")).toBe(Math.round((rupees(60_000) * 8) / 22));
  });

  it("pays each basic-pay rate for its own days when pay changes mid-month", async () => {
    const area = await createArea();
    const id = await hireForPayroll({
      area,
      hireDate: "2024-01-01",
      pay: [
        { from: "2024-01-01", to: "2026-06-15", amountRupees: 60_000 },
        { from: "2026-06-16", amountRupees: 66_000 },
      ],
    });
    const { runId } = await runMonth(area, 2026, 6);
    // 11 working days at each rate.
    expect((await storedResult(runId, id))!.line("BASIC")).toBe(rupees(30_000 + 33_000));
  });
});

describe("tax over a year", () => {
  it("deducts the year's tax evenly, not more each month", async () => {
    const area = await createArea();
    const id = await hireForPayroll({ area, hireDate: "2020-01-01", pay: [{ from: "2020-01-01", amountRupees: 100_000 }] });

    const monthly: number[] = [];
    for (let i = 0; i < 12; i += 1) {
      const month = ((3 + i) % 12) + 1;
      const year = month >= 4 ? 2026 : 2027;
      const { runId } = await runMonth(area, year, month);
      monthly.push((await storedResult(runId, id))!.line("TDS"));
    }

    // ₹1,50,000 a month with allowances: ₹18,00,000 a year.
    const annual = await computeAnnualTax({ grossSalaryPaise: rupees(1_800_000), regime: "New", financialYear: "2026-27" });
    const deducted = monthly.reduce((s, n) => s + n, 0);
    expect(Math.abs(deducted - annual.totalTaxPaise)).toBeLessThanOrEqual(12);
    for (const m of monthly) expect(Math.abs(m - annual.totalTaxPaise / 12)).toBeLessThanOrEqual(100);
  });

  it("taxes a mid-year joiner on what they actually earn", async () => {
    const area = await createArea();
    const id = await hireForPayroll({ area, hireDate: "2026-09-15", pay: [{ from: "2026-09-15", amountRupees: 150_000 }] });

    let taxable = 0;
    for (const [year, month] of [[2026, 9], [2026, 10], [2026, 11], [2026, 12], [2027, 1], [2027, 2], [2027, 3]]) {
      const { runId } = await runMonth(area, year, month);
      taxable += (await storedResult(runId, id))!.gross;
    }
    const owed = await computeAnnualTax({ grossSalaryPaise: taxable, regime: "New", financialYear: "2026-27" });
    expect(owed.totalTaxPaise).toBeGreaterThan(0);
    expect(Math.abs((await totalTds(id)) - owed.totalTaxPaise)).toBeLessThanOrEqual(100);
  });
});

describe("retro calculation", () => {
  it("pays arrears once for a raise backdated into months already paid", async () => {
    const area = await createArea();
    const id = await hireForPayroll({ area, hireDate: "2020-01-01", pay: [{ from: "2020-01-01", amountRupees: 50_000 }] });

    await runMonth(area, 2026, 4);
    const may = await runMonth(area, 2026, 5);
    const june = await runMonth(area, 2026, 6);

    // An increment approved in July, effective from 1 May.
    await saveTimeSlice({
      table: SLICED_TABLES.basicPay,
      employeeId: id,
      validFrom: "2026-05-01",
      data: { pay_scale_type: "Monthly salaried", pay_scale_area: null, pay_scale_group: "L1", amount_paise: rupees(55_000), currency: "INR" },
      createdBy: "test",
    });

    const july = await runMonth(area, 2026, 7);
    const r = (await storedResult(july.runId, id))!;
    const arrears = r.lines.filter((l) => l.code === "RETRO");
    // ₹5,000 more basic, with 40% HRA and 10% conveyance on it, for each month.
    expect(arrears).toEqual([
      expect.objectContaining({ amount: rupees(7_500), forPeriodId: may.periodId }),
      expect.objectContaining({ amount: rupees(7_500), forPeriodId: june.periodId }),
    ]);
    expect(r.line("BASIC")).toBe(rupees(55_000));
    // Provident fund is on the ₹15,000 ceiling either way, so no PF arrears.
    expect(r.lines.filter((l) => l.code === "PF" && l.forPeriodId !== null)).toHaveLength(0);

    const august = await runMonth(area, 2026, 8);
    expect((await storedResult(august.runId, id))!.lines.filter((l) => l.code === "RETRO")).toHaveLength(0);

    // A second correction to May, after its arrears were paid: one unpaid day
    // recorded in September. May must not pay its ₹7,500 of arrears again.
    await rawClient().execute({
      sql: `INSERT INTO pt_it2001_absence
              (employee_id, absence_type_code, start_date, end_date, payroll_days, calendar_days, is_half_day, created_by, created_at)
            VALUES (?, '0300', '2026-05-20', '2026-05-20', 1, 1, 0, 'test', ?)`,
      args: [id, new Date().toISOString()],
    });
    const september = await runMonth(area, 2026, 9);
    const again = (await storedResult(september.runId, id))!.lines.filter((l) => l.code === "RETRO");
    // May 2026 has 21 working days; 20 of them are now paid at ₹55,000.
    const basic = Math.round((rupees(55_000) * 20) / 21);
    const shouldHave = basic + Math.round(basic * 0.4) + Math.round(basic * 0.1);
    expect(again).toEqual([
      expect.objectContaining({
        forPeriodId: may.periodId,
        amount: shouldHave - rupees(75_000) - rupees(7_500),
      }),
    ]);
  });

  it("recovers pay for unpaid leave recorded after the month was paid", async () => {
    const area = await createArea();
    const id = await hireForPayroll({ area, hireDate: "2020-01-01", pay: [{ from: "2020-01-01", amountRupees: 44_000 }] });
    const june = await runMonth(area, 2026, 6);

    // Two unpaid days in June, recorded in July.
    await rawClient().execute({
      sql: `INSERT INTO pt_it2001_absence
              (employee_id, absence_type_code, start_date, end_date, payroll_days, calendar_days, is_half_day, created_by, created_at)
            VALUES (?, '0300', '2026-06-22', '2026-06-23', 2, 2, 0, 'test', ?)`,
      args: [id, new Date().toISOString()],
    });

    const july = await runMonth(area, 2026, 7);
    const retro = (await storedResult(july.runId, id))!.lines.filter((l) => l.code === "RETRO");
    // Two of June's 22 days of ₹44,000 basic, plus 50% in allowances on it.
    expect(retro).toEqual([
      expect.objectContaining({ amount: -rupees(6_000), forPeriodId: june.periodId }),
    ]);
  });
});

describe("off-cycle runs", () => {
  it("pays a bonus agreed after the month was posted, and taxes it in full", async () => {
    const area = await createArea();
    const id = await hireForPayroll({ area, hireDate: "2020-01-01", pay: [{ from: "2020-01-01", amountRupees: 100_000 }] });
    const april = await runMonth(area, 2026, 4);

    const bonus = await rawClient().execute({
      sql: `INSERT INTO py_it0015_additional_payment (employee_id, wage_type_code, amount_paise, payment_date, created_at)
            VALUES (?, 'BONUS', ?, '2026-04-25', ?) RETURNING id`,
      args: [id, rupees(50_000), new Date().toISOString()],
    });
    const bonusId = Number(bonus.rows[0].id);

    const off = await runPayroll({
      periodId: april.periodId,
      runBy: "test",
      runType: "Off-cycle",
      employeeIds: [id],
      reason: "Retention bonus",
      payDate: "2026-04-30",
    });
    const r = (await storedResult(off.runId, id))!;
    expect(r.status).toBe("Calculated");
    expect(r.line("BONUS")).toBe(rupees(50_000));
    expect(r.line("BASIC")).toBe(0);

    // The tax on a bonus is the extra tax the bonus causes, all of it now.
    const base = await computeAnnualTax({ grossSalaryPaise: rupees(1_800_000), regime: "New", financialYear: "2026-27" });
    const withBonus = await computeAnnualTax({ grossSalaryPaise: rupees(1_850_000), regime: "New", financialYear: "2026-27" });
    expect(Math.abs(r.line("TDS") - (withBonus.totalTaxPaise - base.totalTaxPaise))).toBeLessThanOrEqual(1);

    const paid = await rawClient().execute({
      sql: "SELECT paid_run_id FROM py_it0015_additional_payment WHERE id = ?",
      args: [bonusId],
    });
    expect(Number(paid.rows[0].paid_run_id)).toBe(off.runId);

    // Paid once: a second off-cycle run finds nothing owed.
    const again = await runPayroll({
      periodId: april.periodId,
      runBy: "test",
      runType: "Off-cycle",
      employeeIds: [id],
      reason: "Again",
      payDate: "2026-04-30",
    });
    expect((await storedResult(again.runId, id))!.status).toBe("Error");

    // And a paid payment stays on record.
    const deleted = await deleteAdditionalPayment({}, form({ id: bonusId }));
    expect(deleted.error).toBeTruthy();
  });

  it("refuses a regular run on a posted period", async () => {
    const area = await createArea();
    await hireForPayroll({ area, hireDate: "2020-01-01", pay: [{ from: "2020-01-01", amountRupees: 30_000 }] });
    const { periodId } = await runMonth(area, 2026, 4);
    await expect(startRun({ periodId, runBy: "test" })).rejects.toThrow(/posted/);
  });
});

describe("running in batches", () => {
  it("calculates a few people per call and finishes with totals that add up", async () => {
    const area = await createArea();
    const ids = [];
    for (const amount of [30_000, 40_000, 50_000]) {
      ids.push(await hireForPayroll({ area, hireDate: "2020-01-01", pay: [{ from: "2020-01-01", amountRupees: amount }] }));
    }
    const periodId = await createPeriod(area, 2026, 5);
    const { runId, planned } = await startRun({ periodId, runBy: "test" });
    expect(planned).toBe(3);

    const first = await processRunBatch(runId, 1);
    expect(first).toMatchObject({ planned: 3, done: 1, completed: false });
    const second = await processRunBatch(runId, 5);
    expect(second).toMatchObject({ done: 3, completed: true });

    const sums = await rawClient().execute({
      sql: `SELECT SUM(net_paise) AS net, SUM(gross_paise) AS gross, COUNT(*) AS n
            FROM py_payroll_result WHERE run_id = ?`,
      args: [runId],
    });
    const run = await rawClient().execute({
      sql: "SELECT gross_total_paise, net_total_paise, employee_count FROM py_payroll_run WHERE id = ?",
      args: [runId],
    });
    expect(Number(run.rows[0].employee_count)).toBe(Number(sums.rows[0].n));
    expect(Number(run.rows[0].gross_total_paise)).toBe(Number(sums.rows[0].gross));
    expect(Number(run.rows[0].net_total_paise)).toBe(Number(sums.rows[0].net));
  });

  it("replaces the previous regular run without leaving its results behind", async () => {
    const area = await createArea();
    await hireForPayroll({ area, hireDate: "2020-01-01", pay: [{ from: "2020-01-01", amountRupees: 30_000 }] });
    const periodId = await createPeriod(area, 2026, 5);
    const first = await runPayroll({ periodId, runBy: "test" });
    const second = await runPayroll({ periodId, runBy: "test" });

    const left = await rawClient().execute({
      sql: `SELECT
              (SELECT COUNT(*) FROM py_payroll_run WHERE period_id = ?1) AS runs,
              (SELECT COUNT(*) FROM py_payroll_result WHERE run_id = ?2) AS old_results,
              (SELECT COUNT(*) FROM py_payroll_result_line l
                 WHERE NOT EXISTS (SELECT 1 FROM py_payroll_result r WHERE r.id = l.result_id)) AS orphans`,
      args: [periodId, first.runId],
    });
    expect(left.rows[0]).toMatchObject({ runs: 1, old_results: 0, orphans: 0 });
    expect(second.completed).toBe(true);
  });
});

describe("ledger posting", () => {
  it("balances, and charges salary to each person's cost centre", async () => {
    const area = await createArea();
    await hireForPayroll({ area, hireDate: "2020-01-01", pay: [{ from: "2020-01-01", amountRupees: 80_000 }] });
    const { runId } = await runMonth(area, 2026, 5);

    const posted = await postToLedger({}, form({ runId, postingDate: "2026-05-31" }));
    expect(posted.error).toBeUndefined();

    const lines = await rawClient().execute({
      sql: `SELECT l.debit_paise, l.credit_paise, l.cost_center
            FROM py_gl_posting_line l JOIN py_gl_posting p ON p.id = l.posting_id
            WHERE p.run_id = ?`,
      args: [runId],
    });
    const debit = lines.rows.reduce((s, l) => s + Number(l.debit_paise), 0);
    const credit = lines.rows.reduce((s, l) => s + Number(l.credit_paise), 0);
    expect(debit).toBeGreaterThan(0);
    expect(debit).toBe(credit);
    const expenses = lines.rows.filter((l) => Number(l.debit_paise) > 0);
    expect(expenses.every((l) => l.cost_center === "CC-TEST")).toBe(true);
  });
});
