import { describe, expect, it } from "vitest";
import { rawClient } from "@/lib/db";
import {
  hraExemption,
  section89Relief,
  compareRegimes,
  effectiveDeclarationAmounts,
} from "@/lib/engines/tax";
import { generate24QAnnexure1, generate24QAnnexure2 } from "@/lib/engines/tax-returns";
import { createPerson } from "./support/people";

/**
 * Tax completeness: the HRA three-way minimum, the regime comparison
 * against payroll's own computation, Section 89 relief as Form 10E works
 * it out, the 24Q file's layout, and a proof window gating TDS to what was
 * actually verified.
 */

const rupees = (n: number) => n * 100;

describe("HRA exemption", () => {
  it("is the least of the three, for a metro", () => {
    // Actual HRA 12,00,000; rent 15,00,000 - 10% of 6,00,000 basic = 14,40,000; 50% of basic = 3,00,000 — the smallest.
    const value = hraExemption({ actualHraPaise: rupees(12_000), rentPaise: rupees(15_000), basicPaise: rupees(6_000), isMetro: true });
    expect(value).toBe(rupees(3_000));
  });

  it("uses 40%, not 50%, outside a metro", () => {
    const value = hraExemption({ actualHraPaise: rupees(12_000), rentPaise: rupees(15_000), basicPaise: rupees(6_000), isMetro: false });
    expect(value).toBe(rupees(2_400)); // 40% of 6,000
  });

  it("is rent less 10% of basic, when that is the smallest", () => {
    const value = hraExemption({ actualHraPaise: rupees(50_000), rentPaise: rupees(10_000), basicPaise: rupees(40_000), isMetro: true });
    expect(value).toBe(rupees(6_000)); // 10,000 - 4,000
  });

  it("is never negative, when rent does not even cover 10% of basic", () => {
    const value = hraExemption({ actualHraPaise: rupees(10_000), rentPaise: rupees(1_000), basicPaise: rupees(40_000), isMetro: false });
    expect(value).toBe(0);
  });
});

describe("the regime comparison", () => {
  it("equals annualTaxFor's own computation under each regime", async () => {
    const opts = { grossSalaryPaise: rupees(12_00_000), financialYear: "2026-27", chapterViaPaise: rupees(1_50_000), section10ExemptPaise: rupees(1_00_000), otherIncomePaise: 0 };
    const compared = await compareRegimes(opts);
    expect(compared.old.totalTaxPaise).toBeGreaterThanOrEqual(0);
    expect(compared.new.totalTaxPaise).toBeGreaterThanOrEqual(0);
    // The new regime ignores chapter VI-A and HRA — the same rule computeAnnualTaxWith already applies.
    expect(compared.new.chapterViaPaise).toBe(0);
    expect(compared.new.section10ExemptPaise).toBe(0);
    expect(compared.old.chapterViaPaise).toBe(opts.chapterViaPaise);
    expect(compared.savingsPaise).toBe(Math.abs(compared.old.totalTaxPaise - compared.new.totalTaxPaise));
    expect(["Old", "New"]).toContain(compared.betterRegime);
  });
});

describe("section 89 relief", () => {
  it("is the extra tax arrears cost this year, less what they would have cost on time", () => {
    const relief = section89Relief({
      taxWithArrearsThisYearPaise: rupees(1_50_000),
      taxWithoutArrearsThisYearPaise: rupees(1_20_000), // arrears cost 30,000 extra this year
      taxWithArrearsThatYearPaise: rupees(80_000),
      taxWithoutArrearsThatYearPaise: rupees(70_000), // would have cost only 10,000 extra that year
    });
    expect(relief).toBe(rupees(20_000)); // 30,000 - 10,000
  });

  it("is never negative — relief never becomes an extra charge", () => {
    const relief = section89Relief({
      taxWithArrearsThisYearPaise: rupees(1_20_000),
      taxWithoutArrearsThisYearPaise: rupees(1_10_000), // 10,000 extra this year
      taxWithArrearsThatYearPaise: rupees(90_000),
      taxWithoutArrearsThatYearPaise: rupees(70_000), // would have cost 20,000 that year — more, not less
    });
    expect(relief).toBe(0);
  });
});

describe("the 24Q file", () => {
  it("writes Annexure I as caret-separated challan and deductee detail", () => {
    const text = generate24QAnnexure1([
      { bsrCode: "0510002", depositDate: "2026-07-07", challanSerial: "00012", employeePan: "ABCDE1234F", employeeName: "Arjun Mehta", paymentDate: "2026-06-30", amountPaidPaise: rupees(72_000), tdsDeductedPaise: rupees(5_000) },
    ]);
    expect(text).toBe("0510002^2026-07-07^00012^ABCDE1234F^Arjun Mehta^2026-06-30^72000.00^5000.00");
  });

  it("writes Annexure II as the full annual computation, one row per employee", () => {
    const text = generate24QAnnexure2([
      {
        employeePan: "ABCDE1234F",
        employeeName: "Arjun Mehta",
        grossSalaryPaise: rupees(8_64_000),
        section10ExemptPaise: rupees(50_000),
        standardDeductionPaise: rupees(75_000),
        chapterViaPaise: rupees(1_50_000),
        taxableIncomePaise: rupees(5_89_000),
        taxOnIncomePaise: rupees(20_000),
        rebate87aPaise: 0,
        cessPaise: rupees(800),
        totalTaxPaise: rupees(20_800),
        tdsDeductedPaise: rupees(20_800),
      },
    ]);
    expect(text).toBe("ABCDE1234F^Arjun Mehta^864000.00^50000.00^75000.00^150000.00^589000.00^20000.00^0.00^800.00^20800.00^20800.00");
  });
});

describe("a proof window", () => {
  it("leaves the declared figures alone while open, or before one is set", async () => {
    const employee = await createPerson();
    const raw = { section80CPaise: rupees(1_50_000), section80DPaise: rupees(25_000), hraExemptionPaise: rupees(1_00_000) };
    expect(await effectiveDeclarationAmounts(employee.employeeId, "2099-00", raw)).toEqual(raw); // no window at all for this year

    await rawClient().execute({
      sql: "INSERT INTO tds_proof_window (financial_year, opens_at, closes_at, created_by, created_at) VALUES ('2099-00', '2099-04-01', '2099-12-31', 'test', ?)",
      args: [new Date().toISOString()],
    });
    expect(await effectiveDeclarationAmounts(employee.employeeId, "2099-00", raw)).toEqual(raw); // window open (far in the future)
  });

  it("caps an unverified amount down to what was actually verified, once closed", async () => {
    const employee = await createPerson();
    const financialYear = "2020-21"; // long closed, whatever today's date is
    await rawClient().execute({
      sql: "INSERT INTO tds_proof_window (financial_year, opens_at, closes_at, created_by, created_at) VALUES (?, '2020-04-01', '2021-03-31', 'test', ?)",
      args: [financialYear, new Date().toISOString()],
    });
    await rawClient().execute({
      sql: "INSERT INTO tds_proof (employee_id, financial_year, section, amount_paise, status, submitted_at) VALUES (?, ?, '80C', ?, 'Verified', ?)",
      args: [employee.employeeId, financialYear, rupees(60_000), new Date().toISOString()],
    });
    // A second, unverified proof must not count.
    await rawClient().execute({
      sql: "INSERT INTO tds_proof (employee_id, financial_year, section, amount_paise, status, submitted_at) VALUES (?, ?, '80C', ?, 'Pending', ?)",
      args: [employee.employeeId, financialYear, rupees(90_000), new Date().toISOString()],
    });

    const raw = { section80CPaise: rupees(1_50_000), section80DPaise: rupees(25_000), hraExemptionPaise: rupees(1_00_000) };
    const effective = await effectiveDeclarationAmounts(employee.employeeId, financialYear, raw);
    expect(effective.section80CPaise).toBe(rupees(60_000)); // only the verified ₹60,000, not the declared ₹1,50,000 or the unverified ₹90,000
    expect(effective.section80DPaise).toBe(0); // nothing verified at all
    expect(effective.hraExemptionPaise).toBe(0);
  });

  it("never lets verified proof exceed what was actually declared", async () => {
    const employee = await createPerson();
    const financialYear = "2020-22";
    await rawClient().execute({
      sql: "INSERT INTO tds_proof_window (financial_year, opens_at, closes_at, created_by, created_at) VALUES (?, '2021-04-01', '2022-03-31', 'test', ?)",
      args: [financialYear, new Date().toISOString()],
    });
    // Verified proof of 2,00,000, but only 1,50,000 was ever declared.
    await rawClient().execute({
      sql: "INSERT INTO tds_proof (employee_id, financial_year, section, amount_paise, status, submitted_at) VALUES (?, ?, '80C', ?, 'Verified', ?)",
      args: [employee.employeeId, financialYear, rupees(2_00_000), new Date().toISOString()],
    });
    const effective = await effectiveDeclarationAmounts(employee.employeeId, financialYear, { section80CPaise: rupees(1_50_000), section80DPaise: 0, hraExemptionPaise: 0 });
    expect(effective.section80CPaise).toBe(rupees(1_50_000));
  });
});
