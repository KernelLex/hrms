import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { eq } from "drizzle-orm";
import * as s from "../schema";

type Db = LibSQLDatabase<typeof s>;

/**
 * Statutory rates — PF, ESI, professional tax, the labour welfare fund, and
 * the income-tax constants tax.ts used to hardcode — plus one salary
 * structure and a CTC for the head office's first employee, so a payslip
 * shows employer contributions and a professional tax line without HR
 * setting anything up first.
 *
 * Figures are the commonly published Indian rates; exact validation against
 * the government's own tools is phase 25.
 */
export async function seedStatutory(db: Db): Promise<string[]> {
  const notes: string[] = [];
  const createdAt = new Date().toISOString();
  const OPEN = s.OPEN_ENDED;

  const existingPf = await db.select().from(s.pyPfRate).limit(1);
  if (existingPf.length === 0) {
    await db.insert(s.pyPfRate).values({
      validFrom: "2020-01-01",
      validTo: OPEN,
      employeeRateBasisPoints: 1200,
      employerRateBasisPoints: 1200,
      epsRateBasisPoints: 833,
      edliRateBasisPoints: 50,
      adminChargeBasisPoints: 50,
      wageCeilingPaise: 1_500_000, // ₹15,000
    });
  }

  const existingEsi = await db.select().from(s.pyEsiRate).limit(1);
  if (existingEsi.length === 0) {
    await db.insert(s.pyEsiRate).values({
      validFrom: "2020-01-01",
      validTo: OPEN,
      employeeRateBasisPoints: 75,
      employerRateBasisPoints: 325,
      wageCeilingPaise: 2_100_000, // ₹21,000
    });
  }

  const existingPt = await db.select().from(s.pyProfessionalTaxSlab).limit(1);
  if (existingPt.length === 0) {
    await db.insert(s.pyProfessionalTaxSlab).values([
      // Karnataka: a flat ₹200 a month above ₹25,000 gross, nil below it.
      { state: "KARNATAKA", validFrom: "2020-01-01", validTo: OPEN, fromPaise: 2_500_000, toPaise: null, amountPaise: 20_000, isFebruary: false },
      // Maharashtra: ₹200 a month above ₹10,000, ₹300 in February — 11×200 + 300 = ₹2,500, the annual cap.
      { state: "MAHARASHTRA", validFrom: "2020-01-01", validTo: OPEN, fromPaise: 1_000_000, toPaise: null, amountPaise: 20_000, isFebruary: false },
      { state: "MAHARASHTRA", validFrom: "2020-01-01", validTo: OPEN, fromPaise: 1_000_000, toPaise: null, amountPaise: 30_000, isFebruary: true },
    ]);
  }

  const existingLwf = await db.select().from(s.pyLwfRate).limit(1);
  if (existingLwf.length === 0) {
    await db.insert(s.pyLwfRate).values([
      { state: "KARNATAKA", validFrom: "2020-01-01", validTo: OPEN, frequency: "HalfYearly", employeeAmountPaise: 2_000, employerAmountPaise: 4_000, dueMonth: 12 },
      { state: "MAHARASHTRA", validFrom: "2020-01-01", validTo: OPEN, frequency: "HalfYearly", employeeAmountPaise: 2_500, employerAmountPaise: 7_500, dueMonth: 12 },
      { state: "MAHARASHTRA", validFrom: "2020-01-01", validTo: OPEN, frequency: "HalfYearly", employeeAmountPaise: 2_500, employerAmountPaise: 7_500, dueMonth: 6 },
    ]);
  }

  // The same constants engines/tax.ts held as literals, now data.
  const financialYears = new Set<string>(["2025-26"]);
  const today = new Date().toISOString().slice(0, 10);
  const currentYear = Number(today.slice(0, 4));
  const currentMonth = Number(today.slice(5, 7));
  const currentFyStart = currentMonth >= 4 ? currentYear : currentYear - 1;
  financialYears.add(`${currentFyStart}-${String((currentFyStart + 1) % 100).padStart(2, "0")}`);

  for (const fy of financialYears) {
    const already = await db.select().from(s.pyTaxConstant).where(eq(s.pyTaxConstant.financialYear, fy));
    if (already.length > 0) continue;
    await db.insert(s.pyTaxConstant).values([
      { financialYear: fy, regime: "New", standardDeductionPaise: 7_500_000, rebate87aLimitPaise: 120_000_000, rebate87aMaxPaise: 6_000_000, cessBasisPoints: 400 },
      { financialYear: fy, regime: "Old", standardDeductionPaise: 5_000_000, rebate87aLimitPaise: 50_000_000, rebate87aMaxPaise: 1_250_000, cessBasisPoints: 400 },
    ]);
  }

  // One structure — basic 40% of CTC, HRA and conveyance their usual share of
  // basic, special allowance balancing — assigned to Arjun, so a payslip
  // shows employer contributions without HR setting one up first.
  const existingStructure = await db.query.pySalaryStructure.findFirst({ where: eq(s.pySalaryStructure.code, "STANDARD") });
  if (!existingStructure) {
    await db.insert(s.pySalaryStructure).values({ code: "STANDARD", name: "Standard structure", isActive: true });
    await db.insert(s.pySalaryStructureComponent).values([
      { structureCode: "STANDARD", wageTypeCode: "BASIC", componentType: "PercentOfCTC", percentBasisPoints: 4000, fixedAmountPaise: null, sortOrder: 10 },
      { structureCode: "STANDARD", wageTypeCode: "SPECIAL", componentType: "Balancing", percentBasisPoints: null, fixedAmountPaise: null, sortOrder: 90 },
    ]);
  }

  const arjun = await db.query.paEmployee.findFirst({ where: eq(s.paEmployee.employeeNumber, "EMP1001") });
  let ctcNote = "";
  if (arjun) {
    const existingCtc = await db.query.pyEmployeeCtc.findFirst({ where: eq(s.pyEmployeeCtc.employeeId, arjun.id) });
    if (!existingCtc) {
      await db.insert(s.pyEmployeeCtc).values({
        employeeId: arjun.id,
        structureCode: "STANDARD",
        annualCtcPaise: 60_000_000, // ₹6,00,000
        validFrom: "2026-01-01",
        validTo: OPEN,
        seq: 1,
        createdBy: "seed",
        createdAt,
      });
      ctcNote = ", with a ₹6,00,000 CTC for Arjun on it";
    }
    const existingStatutory = await db.query.paStatutoryDetails.findFirst({ where: eq(s.paStatutoryDetails.employeeId, arjun.id) });
    if (!existingStatutory) {
      await db.insert(s.paStatutoryDetails).values({
        employeeId: arjun.id,
        uan: "100123456789",
        esiNumber: null,
        professionalTaxState: "KARNATAKA",
        // 5% on top of the statutory 12%, so a payslip shows what voluntary
        // provident fund looks like next to the compulsory line.
        vpfBasisPoints: 500,
        validFrom: "2020-01-01",
        validTo: OPEN,
        seq: 1,
        createdBy: "seed",
        createdAt,
      });
    }
  }

  notes.push("  PF, ESI, professional tax (Karnataka, Maharashtra) and labour welfare fund rates");
  notes.push("  Arjun on 5% voluntary PF, on top of the statutory 12%");
  notes.push("  income-tax constants as data, for every financial year the tax slabs cover");
  notes.push(`  1 salary structure (basic 40% of CTC, special allowance balancing)${ctcNote}`);
  return notes;
}
